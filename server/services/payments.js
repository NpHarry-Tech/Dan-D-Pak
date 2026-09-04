// Payment Core: multi-method payment lines, close bill, trigger inventory deduction.
import crypto from 'node:crypto';
import {
  db, uid, now, audit, buildAuditEntry, insertAuditRow, auditPostCommit,
} from '../db.js';
import { cleanText, headerVal, safeEqual } from '../core/util.js';
import { publishRealtime as emit } from '../core/realtimeBus.js';
import { getOrder, getTableState, recomputeTotals, resolveStaffCall, capSoBillKhiThanhToan } from './orders.js';
import { deductForOrder } from './inventory.js';
import { enqueueReceiptPrint, processReceiptPrintOutbox, printConfigForJob } from './printing.js';
import { canonicalMethodKey, getIntegrations, getOperationsConfig, getPrintConfig } from './settings.js';
import { resolveQrProvider } from './qrProvider.js';
import { getActiveShift } from './shifts.js';
import { archiveOrder, archivePayment } from './archive.js';
import { getCustomer, recordPurchase } from './customers.js';
import { buildDiscountPlan } from './vouchers.js';
import * as einvoice from './einvoice.js';
import { receiptTaxBlock } from './tax.js';
import { logSystem } from './systemLogs.js';
import { money } from '../core/money.js';
import { saleTime } from '../core/businessClock.js';
import { isStoreOffline } from './sync.js';
import { enqueueSale as enqueueErpSale } from '../integrations/erp/outbox.js';
import { enqueuePaidPosOrder } from './haravanConnector.js';
import * as PaymentIntents from './paymentIntents.js';

// OUTBOX PATTERN (mission #12/#23): sau thanh toán ĐỦ + đã cấp bill_no, xếp hàng
// sự kiện bán hàng để worker đẩy sang Business Central. NGOÀI transaction, bọc
// try/catch — BC/ERP lỗi TUYỆT ĐỐI không được làm hỏng thanh toán đã thành công.
// No-op khi ERP tắt (enqueueErpSale tự kiểm cfg.enabled).
function enqueueErpSaleSafe(order_id, receipt, branch_id) {
  try { enqueueErpSale(getOrder(order_id), receipt, branch_id); }
  catch (e) {
    logSystem({
      level: 'warn', source: 'erp', eventType: 'erp_enqueue_failed',
      title: 'Không xếp được hàng đợi ERP (thanh toán vẫn OK)',
      message: e?.message || String(e), branchId: branch_id, orderId: order_id, action: 'erp:enqueue',
    });
  }
}

function enqueueHaravanSaleSafe(order_id, branch_id) {
  try { enqueuePaidPosOrder(order_id); }
  catch (e) { logSystem({ level: 'warn', source: 'haravan', eventType: 'haravan_enqueue_failed',
    title: 'Không xếp được hàng đợi Haravan (thanh toán vẫn thành công)', message: e?.message || String(e),
    branchId: branch_id, orderId: order_id, action: 'haravan:enqueue' }); }
}

// Đơn có gắn khách (iPad self-order check-in SĐT / thu ngân chọn khách) mà được
// đóng bill KHÔNG kèm customer trong body (webhook QR, khách tự xác nhận, thu
// ngân bấm thanh toán thường) thì vẫn phải tích điểm từ customer_json của đơn.
export function recordLoyaltyFromOrder(order) {
  try {
    const cust = JSON.parse(order?.customer_json || 'null');
    if (cust && (cust.id || cust.phone)) {
      recordPurchase(cust, order.total, order.branch_id || 'sala', order.id);
    }
  } catch { /* khách không hợp lệ → bỏ qua, không chặn thanh toán */ }
}

// 4 phương thức chuẩn sau khi gom (cash / bank / visa / voucher) + vài key
// đặc thù; mọi key cũ (internet_banking, qrcode, card, may_pos...) được
// canonicalMethodKey() quy về chuẩn trước khi kiểm tra & ghi payment line.
const METHODS = ['cash', 'bank', 'visa', 'voucher', 'momo', 'zalopay', 'online'];
const CUSTOMER_QR_METHODS = ['qr', 'qrcode', 'internet_banking', 'bank', 'momo', 'zalopay'];


// Chuẩn hoá metadata giao dịch thẻ (máy POS trả về) để lưu phục vụ đối soát.
const CARD_MODES = ['auto', 'manual', 'mock'];
function sanitizeCardMeta(card) {
  const c = card && typeof card === 'object' ? card : {};
  const mode = CARD_MODES.includes(c.mode) ? c.mode : null;
  return {
    txnId: c.txnId ? cleanText(c.txnId, 64) : null,
    rrn: c.rrn ? cleanText(c.rrn, 32) : null,
    approval: c.approval ? cleanText(c.approval, 32) : null,
    mask: c.mask ? cleanText(c.mask, 32) : null,
    scheme: c.scheme ? cleanText(c.scheme, 32) : null,
    terminal: c.terminal ? cleanText(c.terminal, 64) : null,
    mode,
  };
}

function assertOfflinePaymentEvidence(lines) {
  if (!isStoreOffline()) return;
  for (const line of Array.isArray(lines) ? lines : []) {
    if (line.method === 'cash' || line.method === 'voucher') continue;
    if (line.method === 'visa') {
      const card = sanitizeCardMeta(line.card);
      if (card.mode !== 'mock' && (card.txnId || card.rrn) && card.approval && card.terminal) continue;
    }
    const error = new Error(
      'Dang mat ket noi: chi duoc thu tien mat/voucher; the can ma giao dich tu may POS. Chuyen khoan phai cho ngan hang xac nhan khi co mang.',
    );
    error.code = 'OFFLINE_PAYMENT_UNVERIFIABLE';
    error.status = 409;
    throw error;
  }
}

function stripVietnamese(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function vietQrSafe(value = '', max = 23) {
  return stripVietnamese(value)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, max);
}

// Số hoá đơn (billNoForSeq trong orders.js) luôn có dạng chữ+số: "Dan{ddMMyy}{seq}".
// Phần CHỮ ("Dan") chỉ là quy ước đặt tên hoá đơn nội bộ — không liên quan gì tới
// "Tiền tố nội dung CK" (transferPrefix) cấu hình ở Kế toán, vốn để phân biệt giao
// dịch của CỬA HÀNG này trên sao kê ngân hàng dùng chung. Ghép thẳng cả hai (VD
// "TEST" + "DAN270726004") ra "TESTDAN270726004" — thừa chữ "DAN" không cần thiết
// và không đúng như người dùng cấu hình. Bỏ hẳn phần chữ đầu bill_no, chỉ lấy phần
// số ({ddMMyy}{seq}) ghép sau tiền tố — dùng CHUNG một hàm để QR hiển thị và hàm
// khớp webhook (findOpenOrderByContent) LUÔN tính ra cùng 1 giá trị.
function billNoDigits(order) {
  // MÃ ĐỐI SOÁT lấy từ `pay_ref` — cấp ngay lúc mở đơn nên luôn có sẵn khi
  // khách quét QR. `bill_no` chỉ có SAU khi thanh toán xong nên không dùng
  // được ở đây; giữ lại làm phương án cho đơn cũ trước khi tách đôi hai khái
  // niệm này (xem addColumnIfMissing('orders','pay_ref') ở db.js).
  const raw = String(order?.pay_ref || order?.bill_no || order?.id || Date.now());
  const digits = raw.replace(/^\D+/, '');
  return digits || vietQrSafe(raw, 23);
}

function paymentReferenceForOrder(order, ops, max = 23) {
  const prefix = vietQrSafe(ops.payment?.transferPrefix || 'DANBILL', 8) || 'DANBILL';
  const code = vietQrSafe(billNoDigits(order), Math.max(1, max - prefix.length));
  return `${prefix}${code}`.slice(0, max);
}

function vietQrOrderId(order) {
  return vietQrSafe(order.pay_ref || order.bill_no || order.id || Date.now(), 13)
    || `DAN${Date.now()}`.slice(0, 13);
}

function maskAccount(value = '') {
  const raw = String(value || '');
  if (raw.length <= 4) return raw ? '****' : '';
  return `${'*'.repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
}

function vietQrBaseUrl(cfg = {}) {
  const custom = cleanText(cfg.apiBase, 220).replace(/\/+$/, '');
  if (custom) return custom;
  return cfg.environment === 'production'
    ? 'https://api.vietqr.org/vqr/api'
    : 'https://dev.vietqr.org/vqr/api';
}

// img.vietqr.io/image/{bank}-{acc}-compact2.png chỉ chấp nhận SỐ TÀI KHOẢN THẬT
// dạng số — một số ngân hàng (BIDV...) bắt buộc dùng Tài khoản ảo (VA, dạng chữ+số
// như "96247MFSBR") để đối soát qua cổng như SePay, và img.vietqr.io từ chối VA này
// ("Tài khoản hưởng không hợp lệ"). vietqr.app/img chấp nhận cả VA lẫn số tài khoản
// thường — đổi sang endpoint này để QR luôn tạo được bất kể ngân hàng dùng VA hay không.
function publicVietQrImage({ bankCode, bankAccount, accountName, amount, reference }) {
  if (!bankCode || !bankAccount) return '';
  const query = new URLSearchParams({
    bank: bankCode,
    acc: bankAccount,
    template: '',
    showinfo: 'true',
    fullacc: 'true',
    holder: accountName || '',
  });
  const amt = Math.max(0, parseInt(amount) || 0);
  if (amt > 0) query.set('amount', String(amt));
  if (reference) query.set('des', reference);
  return `https://vietqr.app/img?${query.toString()}`;
}

function normalizeQrImage(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
  return '';
}

// payOS / VietQR API trả về chuỗi QR EMV (không phải ảnh). Render thành ảnh QR
// quét được (chuỗi EMV chuẩn napas/VietQR nên app ngân hàng quét bình thường).
function emvQrImage(value) {
  const raw = String(value || '').trim();
  if (raw.length < 20 || /^(data:image\/|https?:\/\/)/i.test(raw)) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(raw)}`;
}

async function fetchJson(url, options = {}) {
  if (typeof fetch !== 'function') throw new Error('Runtime Node hiện tại chưa hỗ trợ fetch để gọi VietQR API.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw: text }; }
    if (!res.ok) {
      const message = data?.message || data?.error || data?.raw || `HTTP ${res.status}`;
      throw new Error(String(message).slice(0, 220));
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function getVietQrToken(cfg = {}) {
  const username = cleanText(cfg.username, 160);
  const password = cleanText(cfg.password, 260);
  if (!username || !password) throw new Error('Thiếu username/password VietQR API.');
  const tokenUrl = `${vietQrBaseUrl(cfg)}/token_generate`;
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  const data = await fetchJson(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
  });
  const accessToken = data?.access_token || data?.data?.access_token || data?.token || data?.data?.token;
  if (!accessToken) throw new Error(data?.message || 'VietQR không trả về access_token.');
  return accessToken;
}

async function generateViaVietQrApi(cfg, payload) {
  const token = await getVietQrToken(cfg);
  return fetchJson(`${vietQrBaseUrl(cfg)}/qr/generate-customer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function testVietQrConnection(cfg = {}) {
  if (!cfg.enabled) {
    return { channel: 'vietqr', ok: false, mode: 'disabled', message: 'VietQR đang tắt. Bật kết nối trước khi kiểm tra.' };
  }
  const missingBank = ['bankCode', 'bankAccount', 'userBankName'].filter(k => !cleanText(cfg[k]));
  const missingAuth = ['username', 'password'].filter(k => !cleanText(cfg[k]));
  if (missingBank.length || missingAuth.length) {
    return {
      channel: 'vietqr',
      ok: false,
      mode: 'partial',
      message: `VietQR còn thiếu: ${[...missingBank, ...missingAuth].join(', ')}.`,
      generateUrl: `${vietQrBaseUrl(cfg)}/qr/generate-customer`,
    };
  }
  await getVietQrToken(cfg);
  return {
    channel: 'vietqr',
    ok: true,
    mode: cfg.environment === 'production' ? 'production' : 'sandbox',
    generateUrl: `${vietQrBaseUrl(cfg)}/qr/generate-customer`,
    message: 'Đã lấy token VietQR thành công. Có thể dùng kết nối này để sinh QR riêng cho từng bill.',
  };
}

function normalizeInvoiceCustomer(input) {
  if (!input || typeof input !== 'object' || !input.invoice_request) return null;
  const tax_code = cleanText(input.tax_code, 16).replace(/\D/g, '');
  const company = cleanText(input.company, 180);
  const name = cleanText(input.name, 140) || company;
  const email = cleanText(input.email, 120);
  const phone = cleanText(input.phone, 40);
  if (!/^\d{10}(\d{3})?$/.test(tax_code)) throw new Error('MST công ty phải gồm 10 hoặc 13 chữ số');
  if (!name) throw new Error('Thiếu tên khách hàng xuất hóa đơn');
  if (!email) throw new Error('Thiếu email nhận hóa đơn');
  return {
    invoice_request: true,
    invoice_type: 'company',
    invoice_customer_name: name,
    invoice_company: company,
    tax_code,
    company,
    name,
    address: cleanText(input.address, 260),
    address_detail: cleanText(input.address_detail, 180),
    address_ward: cleanText(input.address_ward, 120),
    address_province: cleanText(input.address_province, 120),
    ward_code: cleanText(input.ward_code, 20),
    province_code: cleanText(input.province_code, 20),
    email,
    phone,
    note: cleanText(input.note, 280),
    requested_at: now(),
  };
}

function mergeInvoiceCustomer(customer, invoiceCustomer) {
  const base = customer && typeof customer === 'object' ? customer : {};
  if (!invoiceCustomer) return Object.keys(base).length ? base : null;
  return {
    ...base,
    name: invoiceCustomer.name || invoiceCustomer.company || base.name || '',
    phone: invoiceCustomer.phone || base.phone || '',
    email: invoiceCustomer.email || base.email || '',
    tax_code: invoiceCustomer.tax_code,
    company: invoiceCustomer.company || invoiceCustomer.name || base.company || '',
    address: invoiceCustomer.address || base.address || '',
    address_detail: invoiceCustomer.address_detail || base.address_detail || '',
    address_ward: invoiceCustomer.address_ward || base.address_ward || '',
    address_province: invoiceCustomer.address_province || base.address_province || '',
    ward_code: invoiceCustomer.ward_code || base.ward_code || '',
    province_code: invoiceCustomer.province_code || base.province_code || '',
    invoice_request: true,
    invoice_type: 'company',
    invoice_customer_name: invoiceCustomer.invoice_customer_name,
    invoice_company: invoiceCustomer.invoice_company,
    invoice_note: invoiceCustomer.note || '',
    invoice_requested_at: invoiceCustomer.requested_at,
  };
}

/// Kế hoạch giảm giá cho ĐƠN F&B ĐANG MỞ — dựng `lines` từ chính đơn rồi chạy CHUNG
/// engine với Retail (`buildDiscountPlan`). Nhờ vậy hàng RETAIL bán trong đơn F&B được
/// hưởng CTKM theo sản phẩm y hệt bên Retail, còn MÓN F&B (không có sku_id) thì KHÔNG
/// bao giờ dính CTKM sản phẩm (vd "mua 5 tặng 1") — chỉ nhận voucher đơn / ưu đãi khách
/// / giảm tay áp cho cả bill.
/// [line_vouchers]: { <order_item_id>: <voucher_id> } — chọn CTKM cho từng dòng retail.
export function buildOrderDiscountPlan(order_id, {
  voucher_id = null,
  line_vouchers = null,
  manual_discount = 0,
  customer = null,
  branch_id = 'sala',
} = {}) {
  const order = getOrder(order_id);
  if (!order) throw new Error('Order không tồn tại');
  const lv = line_vouchers && typeof line_vouchers === 'object' ? line_vouchers : {};
  const lines = (order.items || [])
    .filter(i => i.status !== 'cancelled')
    .map(i => ({
      item_id: i.id,
      sku_id: i.sku_id || null,
      qty: Number(i.qty) || 0,
      price: Number(i.unit_price) || 0,
      lot_id: i.lot_id || null,
      voucher_id: lv[i.id] || null,
      name: i.name,
    }));
  // Khách: ưu tiên request, nếu không thì lấy khách đã gắn vào đơn (iPad check-in…).
  let cust = customer;
  if (!cust && order.customer_json) {
    try { cust = JSON.parse(order.customer_json); } catch { /* JSON hỏng → bỏ */ }
  }
  if (cust?.id) cust = getCustomer(cust.id, branch_id) || cust;
  const plan = buildDiscountPlan(lines, { voucher_id, customer: cust, manual_discount, branch_id });
  return { ...plan, lines, customer: cust };
}

export function paidForOrder(order_id) {
  return Number(db.prepare(`
    SELECT COALESCE(SUM(pl.amount),0) paid
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
    WHERE p.order_id=?`).get(order_id)?.paid) || 0;
}

// Preserve the original payment as evidence and add an equal negative entry.
// Callers own the transaction so order/inventory changes are committed with it.
export function reverseOrderPayments(order_id, reason = '', actor = 'system') {
  const order = db.prepare(`SELECT id,status,branch_id,bill_no FROM orders WHERE id=?`).get(order_id);
  if (!order) throw new Error('Bill không tồn tại.');
  if (order.status !== 'paid') throw new Error('Chỉ có thể đảo thanh toán cho bill đã thanh toán.');

  const key = `refund:${order_id}`;
  const existing = db.prepare(`SELECT id FROM payments WHERE order_id=? AND idempotency_key=? LIMIT 1`)
    .get(order_id, key);
  if (existing) return { payment_id: existing.id, amount: 0, idempotent: true };

  const lines = db.prepare(`
    SELECT pl.method, SUM(pl.amount) amount
    FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
    WHERE p.order_id=?
    GROUP BY pl.method
    HAVING SUM(pl.amount) > 0`).all(order_id);
  const amount = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  if (amount <= 0) return { payment_id: null, amount: 0, idempotent: false };

  const latest = db.prepare(`SELECT shift_id FROM payments WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`)
    .get(order_id);
  const paymentId = uid('pay_ref_');
  const reference = `Xóa bill ${order.bill_no || order_id}: ${String(reason || '').trim()}`.slice(0, 250);
  db.prepare(`INSERT INTO payments
    (id,order_id,shift_id,idempotency_key,cashier,total,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(paymentId, order_id, latest?.shift_id || null, key, actor || 'system', -amount, now());
  const insertLine = db.prepare(`INSERT INTO payment_lines
    (id,payment_id,method,amount,tendered_amount,reference) VALUES (?,?,?,?,?,?)`);
  for (const line of lines) {
    const reversed = -Number(line.amount || 0);
    insertLine.run(uid('pl_ref_'), paymentId, line.method, reversed, reversed, reference);
  }
  return { payment_id: paymentId, amount, idempotent: false };
}

// lines: [{method, amount, reference}]
function settlePaymentLines(lines, total) {
  const settled = (Array.isArray(lines) ? lines : []).map(line => {
    let tendered_amount;
    try { tendered_amount = money(line?.amount); }
    catch { throw new Error('Số tiền thanh toán không hợp lệ'); }
    if (tendered_amount <= 0) throw new Error('Số tiền thanh toán phải lớn hơn 0');
    const method = canonicalMethodKey(line.method);
    if (!METHODS.includes(method)) throw new Error('Phương thức không hợp lệ: ' + method);
    return { ...line, method, amount: tendered_amount, tendered_amount };
  });
  const paid = settled.reduce((sum, line) => sum + line.tendered_amount, 0);
  const fullySettled = paid >= total;
  total = Math.min(total, paid);
  let change = paid - total;
  const cashTendered = settled.filter(line => line.method === 'cash').reduce((sum, line) => sum + line.tendered_amount, 0);
  if (change > cashTendered) throw new Error('Số tiền thanh toán không tiền mặt vượt quá số còn nợ');
  if (change > cashTendered) throw new Error('Số tiền dư chỉ có thể trả lại từ khoản thanh toán tiền mặt');
  for (let index = settled.length - 1; index >= 0 && change > 0; index--) {
    const line = settled[index];
    if (line.method !== 'cash') continue;
    const returned = Math.min(change, line.amount);
    line.amount -= returned;
    change -= returned;
  }
  const applied = settled.reduce((sum, line) => sum + line.amount, 0);
  return { lines: settled, paid, applied, fullySettled };
}

function paymentEventPayload(payload = {}) {
  return {
    ...payload,
    event_id: uid('evt_'),
    event_version: 1,
  };
}

function attachPaymentPostCommit(result, audits, events, callbacks) {
  if (audits.length || events.length || callbacks.length) {
    result._payment_post_commit = {
      audits: [...audits],
      events: [...events],
      callbacks: [...callbacks],
    };
  }
  return result;
}

function flushPaymentPostCommit(result) {
  const pending = result?._payment_post_commit;
  if (!pending) return result;
  delete result._payment_post_commit;
  for (const entry of pending.audits || []) auditPostCommit(entry);
  for (const item of pending.events || []) emit(item.event, item.payload, item.branch_id);
  for (const callback of pending.callbacks || []) {
    try { callback(); }
    catch (error) {
      logSystem({
        level: 'error', source: 'payment', eventType: 'post_commit_callback_failed',
        title: 'Thanh toán đã thành công nhưng tác vụ sau commit thất bại',
        message: error?.message || String(error), action: 'payment_post_commit',
      });
    }
  }
  return result;
}

export function payOrder(order_id, lines, options = {}, branch_id = 'sala') {
  const {
    discount,
    cashier,
    customer,
    invoice_customer,
    skipTransaction = false,
    discount_breakdown = null,
    voucher = null,
    promotions = null,
    idempotency_key = null,
    device_id = '',
    note = '',
    external_settlement = false,
    skip_channel_outbound = false,
    payment_intent_id = null,
    confirmation_source = null,
    confirmed_by = null,
    provider = null,
    provider_transaction_id = null,
  } = options;

  const postCommitAudits = [];
  const postCommitEvents = [];
  const postCommitCallbacks = [];
  const stageAudit = (action, detail, actor) => {
    const entry = buildAuditEntry(action, detail, branch_id, actor);
    if (!entry) return;
    insertAuditRow(entry);
    postCommitAudits.push(entry);
  };
  const stageEvent = (event, payload) => {
    postCommitEvents.push({
      event,
      payload: paymentEventPayload(payload),
      branch_id,
    });
  };
  const finishPostCommit = (result) => {
    attachPaymentPostCommit(result, postCommitAudits, postCommitEvents, postCommitCallbacks);
    if (!skipTransaction) flushPaymentPostCommit(result);
    return result;
  };

  let inTx = false;
  if (!skipTransaction) {
    db.prepare('BEGIN IMMEDIATE').run();
    inTx = true;
  }

  try {
    const paymentKey = String(idempotency_key || '').trim();
    if (paymentKey.length > 128) throw new Error('Idempotency-Key must not exceed 128 characters');
    if (paymentKey) {
      const replay = db.prepare(`SELECT * FROM payments WHERE idempotency_key=?`).get(paymentKey);
      if (replay) {
        if (replay.order_id !== order_id) {
          throw Object.assign(new Error('Idempotency-Key was already used for another order'), { status: 409 });
        }
        const replayOrder = getOrder(order_id);
        const paidTotal = paidForOrder(order_id);
        if (inTx) {
          db.prepare('COMMIT').run();
          inTx = false;
        }
        return finishPostCommit({
          order_id,
          bill_no: replayOrder?.bill_no || '',
          payment_id: replay.id,
          total: Number(replayOrder?.total) || 0,
          paid_total: paidTotal,
          remaining_due: Math.max(0, (Number(replayOrder?.total) || 0) - paidTotal),
          fully_settled: replayOrder?.status === 'paid',
          status: replayOrder?.status || '',
          idempotent_replay: true,
        });
      }
    }
    const order = getOrder(order_id);
    const wasPartiallyPaid = order?.status === 'partially_paid';
    if (wasPartiallyPaid) order.status = 'open';
    if (!order) throw new Error('Order không tồn tại');
    if (order.status !== 'open') {
      throw Object.assign(new Error('Order đã đóng'), {
        status: 409,
        code: 'ORDER_ALREADY_PAID',
      });
    }
    // Voucher/promo metadata belongs to the same unit of work as payment.
    if (voucher) {
      db.prepare(`UPDATE orders SET voucher_id=?, voucher_code=? WHERE id=? AND branch_id=?`)
        .run(voucher.id || null, voucher.code || null, order_id, branch_id);
    }
    for (const promo of Array.isArray(promotions) ? promotions : []) {
      const itemId = promo?.item_id || promo?.order_item_id || null;
      if (!itemId) continue;
      db.prepare(`UPDATE order_items SET promo_json=? WHERE id=? AND order_id=?`)
        .run(JSON.stringify(promo), itemId, order_id);
    }
    db.prepare(`UPDATE orders SET note=? WHERE id=? AND branch_id=?`)
      .run(String(note || '').trim().slice(0, 500) || null, order_id, branch_id);

    if (order.status === 'open' && !wasPartiallyPaid && typeof discount === 'number') {
      db.prepare(`UPDATE orders SET discount=? WHERE id=?`).run(discount, order_id);
    }
    recomputeTotals(order_id);
    const invoiceCustomer = normalizeInvoiceCustomer(invoice_customer);
    const customerSnapshot = mergeInvoiceCustomer(customer, invoiceCustomer);
    if (customerSnapshot) {
      if (invoiceCustomer) {
        db.prepare(`UPDATE orders SET customer_json=?, invoice_choice='requested' WHERE id=?`).run(JSON.stringify(customerSnapshot), order_id);
        stageAudit('invoice.company_requested', {
          order: order_id,
          tax_code: invoiceCustomer.tax_code,
          email: invoiceCustomer.email,
          phone: invoiceCustomer.phone,
        }, cashier || 'system');
      } else {
        db.prepare(`UPDATE orders SET customer_json=? WHERE id=?`).run(JSON.stringify(customerSnapshot), order_id);
      }
    }
    const fresh = getOrder(order_id);
    const pending = fresh.items.filter(i => i.status === 'pending_confirm');
    if (pending.length) throw new Error(`Còn ${pending.length} dòng món đang chờ nhân viên xác nhận`);

    const ops = getOperationsConfig(branch_id);
    const shift = getActiveShift(branch_id);
    // Orders already paid by a trusted external commerce channel can arrive while
    // the physical store has no open cashier shift. They still use the canonical
    // payment/inventory/invoice transaction, but are not attributed to a cash shift.
    if (ops.shifts.requireOpenShift !== false && !shift && !external_settlement) throw new Error('Can mo ca lam viec truoc khi thanh toan.');

    const paidBefore = paidForOrder(order_id);
    const remainingDue = fresh.total - paidBefore;
    const activeTransferIntent = PaymentIntents.activeIntentForOrder(order_id, branch_id);
    if (activeTransferIntent && !payment_intent_id) {
      throw Object.assign(new Error('Đơn đang chờ thanh toán bằng QR trên một thiết bị khác. Hãy mở đúng QR hoặc hủy/tạo lại PaymentIntent trước khi đổi phương thức.'),
        { status: 409, code: 'PAYMENT_INTENT_TAKEOVER_REQUIRED', payment_intent_id: activeTransferIntent.id });
    }
    // ĐƠN 0Đ (giảm 100% / hàng tặng): tổng = 0 và CHƯA thu gì → chốt ĐÃ THANH TOÁN
    // luôn, KHÔNG cần thu tiền. Phải tách khỏi nhánh "remainingDue<=0 = đã settled":
    // trước đây đơn 0đ rơi vào đó và báo "đã thanh toán rồi" nên KHÔNG chốt được
    // (sự cố giảm 100% 07/08/2026).
    const freeOrder = fresh.total <= 0 && paidBefore <= 0;
    if (!freeOrder && remainingDue <= 0) {
      // Đơn đã được đóng bởi một luồng khác (webhook SePay/Casso/payOS tự đối soát,
      // hoặc thiết bị khác vừa xác nhận) trong lúc thu ngân còn đang thao tác trên
      // dialog thanh toán — KHÔNG phải lỗi thao tác, chỉ là race giữa 2 nguồn đóng
      // bill. status/code riêng để caller (processIncomingCredit, client) phân biệt
      // được với lỗi thật, thay vì hiện nguyên văn tiếng Anh cho thu ngân.
      const e = new Error('Hóa đơn này vừa được xác nhận thanh toán rồi (có thể do chuyển khoản tự động hoặc thiết bị khác) — không cần thu thêm.');
      e.status = 409;
      e.code = 'ALREADY_SETTLED';
      throw e;
    }
    // Đơn 0đ: không gọi settlePaymentLines (nó bắt mỗi dòng > 0) — chốt với 0 đồng.
    const payment = freeOrder
      ? { lines: [], paid: 0, applied: 0, fullySettled: true }
      : settlePaymentLines(lines, remainingDue);
    assertOfflinePaymentEvidence(payment.lines);

    let paymentIntent = null;
    if (payment_intent_id) {
      paymentIntent = PaymentIntents.assertCanFinalize(payment_intent_id, order_id, branch_id, remainingDue);
      if (paymentIntent.idempotent) {
        const canonical = getOrder(order_id);
        if (inTx) {
          db.prepare('COMMIT').run();
          inTx = false;
        }
        return finishPostCommit({
          ...buildReceipt(order_id, paymentIntent.payment_id, [], canonical.total, { cashier }),
          idempotent_replay: true,
          fully_settled: true,
          payment_intent_id: paymentIntent.id,
        });
      }
      PaymentIntents.markIntent(paymentIntent.id, 'FINALIZING', { provider, provider_transaction_id,
        confirmation_source, confirmed_by });
    }

    const pid = uid('pay_');
    db.prepare(`INSERT INTO payments (id,order_id,shift_id,idempotency_key,cashier,total,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(pid, order_id, shift?.id || null, paymentKey || null, cashier || null, payment.applied, now());
    const insLine = db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,tendered_amount,reference,card_txn_id,card_rrn,card_approval,card_mask,card_scheme,card_terminal,card_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let intentPaymentLineId = null;
    for (const l of payment.lines) {
      const c = sanitizeCardMeta(l.card);
      const paymentLineId = uid('pl_');
      insLine.run(paymentLineId, pid, l.method, l.amount, l.tendered_amount, l.reference || null,
        c.txnId, c.rrn, c.approval, c.mask, c.scheme, c.terminal, c.mode);
      if (paymentIntent && !intentPaymentLineId && ['bank', 'bank_transfer', 'qrcode'].includes(l.method)) intentPaymentLineId = paymentLineId;
    }

    const paidTotal = paidBefore + payment.applied;
    const fullySettled = payment.fullySettled || paidTotal >= fresh.total;
    const upd = db.prepare(`UPDATE orders SET status=?, paid_at=? WHERE id=? AND status IN ('open','partially_paid')`)
      .run(fullySettled ? 'paid' : 'partially_paid', fullySettled ? now() : null, order_id);
    if (upd.changes === 0) {
      throw Object.assign(
        new Error('Hóa đơn đã được thanh toán hoặc không còn ở trạng thái mở.'),
        { status: 409, code: 'ORDER_ALREADY_PAID' },
      );
    }

    // SỐ HOÁ ĐƠN CẤP TẠI ĐÂY — đúng lúc doanh thu phát sinh, không sớm hơn.
    // Trả một phần thì chưa cấp: đơn vẫn đang mở, huỷ giữa chừng thì không được
    // tiêu số nào.
    if (fullySettled) capSoBillKhiThanhToan(order_id, fresh.branch_id || branch_id);

    if (paymentIntent) {
      if (!fullySettled || !intentPaymentLineId) {
        throw Object.assign(new Error('PaymentIntent chỉ được hoàn tất bằng một dòng chuyển khoản thanh toán đủ.'),
          { status: 409, code: 'PAYMENT_INTENT_FINALIZE_INCOMPLETE' });
      }
      const canonicalBill = db.prepare(`SELECT bill_no FROM orders WHERE id=?`).get(order_id)?.bill_no || null;
      PaymentIntents.markIntent(paymentIntent.id, 'SUCCEEDED', {
        provider, provider_transaction_id, confirmation_source: confirmation_source || 'MANUAL', confirmed_by,
        payment_id: pid, payment_line_id: intentPaymentLineId, bill_no: canonicalBill,
      });
    }

    if (!fullySettled) {
      stageAudit('payment.partial', {
        order: order_id, payment_id: pid, amount: payment.applied,
        paid_total: paidTotal, remaining_due: fresh.total - paidTotal,
        shift_id: shift?.id || null,
      }, cashier || 'system');
      stageEvent('payment:partial', {
        order_id, payment_id: pid, paid_total: paidTotal,
        remaining_due: fresh.total - paidTotal,
      });
      stageEvent('stats:dirty', {});
      if (inTx) {
        db.prepare('COMMIT').run();
        inTx = false;
      }
      return finishPostCommit({
        order_id,
        bill_no: fresh.bill_no || '',
        payment_id: pid,
        total: fresh.total,
        paid: payment.paid,
        applied: payment.applied,
        paid_total: paidTotal,
        remaining_due: fresh.total - paidTotal,
        fully_settled: false,
        status: 'partially_paid',
      });
    }

    // Mark all remaining active items served on close
    db.prepare(`UPDATE order_items SET status='served', served_at=? WHERE order_id=? AND status NOT IN ('served','cancelled')`)
      .run(now(), order_id);

    deductForOrder(fresh, branch_id, { audit: stageAudit, event: stageEvent });

    if (order.table_id) {
      const stillOpen = db.prepare(`SELECT 1 FROM orders WHERE table_id=? AND branch_id=? AND status IN ('open','partially_paid') LIMIT 1`)
        .get(order.table_id, branch_id);
      db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(stillOpen ? 'busy' : 'free', order.table_id);
      resolveStaffCall(order.table_id, branch_id, stageEvent);
      stageEvent('table:updated', getTableState(order.table_id));
    }
    stageAudit('payment.done', {
      order: order_id,
      total: fresh.total,
      lines: payment.lines.length,
      shift_id: shift?.id || null,
    }, cashier || 'system');
    const receiptLines = db.prepare(`
      SELECT pl.method,pl.tendered_amount amount
      FROM payment_lines pl JOIN payments p ON p.id=pl.payment_id
      WHERE p.order_id=? ORDER BY p.created_at,pl.rowid`).all(order_id);
    const tenderedTotal = receiptLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const receipt = buildReceipt(order_id, pid, receiptLines, tenderedTotal, { cashier, discount_breakdown, voucher, promotions });
    receipt.fully_settled = true;
    receipt.paid_total = fresh.total;
    receipt.remaining_due = 0;
    receipt.print_config = printConfigForJob(getPrintConfig(branch_id));
    receipt.branch_id = branch_id;

    // Canonical, immutable sale record. Downstream consumers are migrated to
    // this payload incrementally; writing it in the payment transaction means
    // there is never a paid bill without its authoritative snapshot.
    const snapshotJson = JSON.stringify(receipt);
    const pricingHash = crypto.createHash('sha256').update(snapshotJson).digest('hex');
    const canonicalSaleTime = saleTime(receipt.paid_at);
    db.prepare(`INSERT INTO sale_snapshots
      (id,order_id,payment_id,branch_id,pricing_hash,snapshot_json,paid_at,business_timezone,business_date,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(uid('sale_'), order_id, pid, branch_id, pricingHash, snapshotJson,
        canonicalSaleTime.occurred_at_utc, canonicalSaleTime.business_timezone,
        canonicalSaleTime.business_date, now());
    const receiptPrintOutboxId = enqueueReceiptPrint(receipt, branch_id, { deviceId: device_id });

    // Persist the paid bill and its e-invoice snapshot in the same transaction.
    // This only queues provider work; no MISA/network call happens here.
    let atomicCustomerMode = options.customer_mode || 'WALK_IN';
    let atomicBuyerInfo = options.buyer_info || {};
    if (!options.customer_mode) {
      if (invoiceCustomer && invoiceCustomer.tax_code) {
        atomicCustomerMode = 'COMPANY_TAX_INFO';
        atomicBuyerInfo = invoiceCustomer;
      } else {
        // FALLBACK: KHÁCH đã gắn vào đơn (chọn ở POS) — trước đây mọi bill không
        // nhập form VAT đều bị ép "Bán cho người tiêu dùng" dù đã chọn đúng khách,
        // nên "Người mua" trên HĐ/bill/reprint đều sai. Nay lấy đúng người mua:
        //   • MST + email + tên hợp lệ → hóa đơn CÔNG TY (COMPANY_TAX_INFO).
        //   • chỉ có tên               → người mua CÁ NHÂN (hiện đúng tên, không
        //                                throw vì thiếu email).
        // (COMPANY_TAX_INFO throw nếu thiếu email/MST → phải chọn mode an toàn.)
        let orderCust = {};
        try { orderCust = JSON.parse(fresh.customer_json || '{}') || {}; } catch { /* JSON hỏng → bỏ */ }
        const taxCode = String(orderCust.tax_code || '').replace(/\D/g, '');
        const ten = String(orderCust.name || orderCust.company || '').trim();
        const email = String(orderCust.email || '').trim();
        if (/^\d{10}(\d{3})?$/.test(taxCode) && email && (orderCust.company || ten)) {
          atomicCustomerMode = 'COMPANY_TAX_INFO';
          atomicBuyerInfo = {
            company: orderCust.company || ten, name: ten, tax_code: taxCode,
            address: orderCust.address || '', email, phone: orderCust.phone || '',
          };
        } else if (ten && ten !== 'Bán cho người tiêu dùng') {
          atomicCustomerMode = 'BUYER_PROVIDED_INFO';
          atomicBuyerInfo = {
            name: ten, email, phone: orderCust.phone || '', address: orderCust.address || '',
          };
        }
      }
    }
    // Tạo bản ghi HĐĐT KHÔNG được phép chặn thu tiền: buyer_info lệch (vd thiếu
    // email cho mode công ty) chỉ được hạ về placeholder consumer, không throw.
    try {
      einvoice.createInvoiceRequest(order_id, atomicCustomerMode, atomicBuyerInfo,
        branch_id, cashier || 'system', {
          deferSideEffect: callback => postCommitCallbacks.push(callback),
          stageAudit,
        });
    } catch (buyerErr) {
      if (atomicCustomerMode === 'WALK_IN') throw buyerErr;
      einvoice.createInvoiceRequest(order_id, 'WALK_IN', {}, branch_id, cashier || 'system', {
        deferSideEffect: callback => postCommitCallbacks.push(callback),
        stageAudit,
      });
    }

    if (inTx) {
      db.prepare('COMMIT').run();
      inTx = false;
    }

    if (skipTransaction) {
      // Retail.checkout owns the outer transaction and must commit it before
      // filesystem, printer or realtime side effects are attempted.
      receipt._receipt_print_outbox_id = receiptPrintOutboxId;
      receipt._side_effects_deferred = true;
      return finishPostCommit(receipt);
    }

    finishPostCommit(receipt);

    // Payment đã commit là sự thật tài chính và không được đảo ngược vì printer,
    // filesystem archive hay realtime transport. Sale snapshot trong DB là nguồn
    // bền để reconciliation/replay các side effect này.
    try {
      archiveOrder(getOrder(order_id));
      archivePayment(receipt);
    } catch (e) {
      logSystem({
        level: 'error', source: 'archive', eventType: 'sale_archive_failed',
        title: 'Thanh toán đã thành công nhưng chưa lưu được bản archive',
        message: e.message, branchId: branch_id, orderId: order_id,
        action: 'archive_paid_sale', exceptionType: e.name, stackTrace: e.stack,
      });
    }
    try {
      const printResult = processReceiptPrintOutbox({ id: receiptPrintOutboxId });
      // Cho client biết bill ĐÃ GỬI máy in hay còn CHỜ (không im lặng mất bill):
      // 'sent' = đã đưa vào tuyến in/agent; 'pending' = chưa có tuyến in, worker
      // sẽ thử lại — UI phải cảnh báo + cho in lại. Payment KHÔNG phụ thuộc điều này.
      receipt.print_status = printResult.print_status;
      receipt.print_job_ids = printResult.job_ids;
      if (printResult.failed) {
        receipt.print_error = 'Chưa có tuyến máy in hóa đơn khả dụng; lệnh đang chờ thử lại.';
        throw new Error(receipt.print_error);
      }
    } catch (e) {
      if (!receipt.print_status) receipt.print_status = 'pending';
      logSystem({
        level: 'error', source: 'printer', eventType: 'receipt_enqueue_failed',
        title: 'Thanh toán đã thành công nhưng chưa tạo được lệnh in hóa đơn',
        message: e.message, branchId: branch_id, orderId: order_id,
        action: 'enqueue_paid_receipt', exceptionType: e.name, stackTrace: e.stack,
      });
    }
    try {
      emit('payment:done', paymentEventPayload({ order_id, receipt }), branch_id);
      emit('stats:dirty', paymentEventPayload({}), branch_id);
    } catch (e) {
      logSystem({
        level: 'error', source: 'realtime', eventType: 'payment_emit_failed',
        title: 'Thanh toán đã thành công nhưng realtime chưa phát được',
        message: e.message, branchId: branch_id, orderId: order_id,
        action: 'emit_payment_done', exceptionType: e.name, stackTrace: e.stack,
      });
    }
    enqueueErpSaleSafe(order_id, receipt, branch_id);
    if (!skip_channel_outbound) enqueueHaravanSaleSafe(order_id, branch_id);

    return receipt;
  } catch (err) {
    if (inTx) {
      db.prepare('ROLLBACK').run();
    }
    throw err;
  }
}

export function finalizeDeferredPaymentSideEffects(receipt, branch_id = 'sala') {
  flushPaymentPostCommit(receipt);
  if (!receipt?._side_effects_deferred) return receipt;
  const order_id = receipt.order_id;
  const outboxId = receipt._receipt_print_outbox_id;
  try { archiveOrder(getOrder(order_id)); archivePayment(receipt); }
  catch (e) { logSystem({ level: 'error', source: 'archive', eventType: 'sale_archive_failed',
    title: 'Thanh toán đã thành công nhưng chưa lưu được bản archive', message: e.message,
    branchId: branch_id, orderId: order_id, action: 'archive_paid_sale' }); }
  try {
    const r = processReceiptPrintOutbox({ id: outboxId });
    receipt.print_status = r.print_status;
    receipt.print_job_ids = r.job_ids;
    if (r.failed) {
      receipt.print_error = 'Chưa có tuyến máy in hóa đơn khả dụng; lệnh đang chờ thử lại.';
      throw new Error(receipt.print_error);
    }
  } catch (e) {
    if (!receipt.print_status) receipt.print_status = 'pending';
    logSystem({ level: 'error', source: 'printer', eventType: 'receipt_enqueue_failed',
      title: 'Thanh toán đã thành công nhưng chưa tạo được lệnh in hóa đơn', message: e.message,
      branchId: branch_id, orderId: order_id, action: 'enqueue_paid_receipt' }); }
  try {
    emit('payment:done', paymentEventPayload({ order_id, receipt }), branch_id);
    emit('stats:dirty', paymentEventPayload({}), branch_id);
  }
  catch (e) { logSystem({ level: 'error', source: 'realtime', eventType: 'payment_emit_failed',
    title: 'Thanh toán đã thành công nhưng realtime chưa phát được', message: e.message,
    branchId: branch_id, orderId: order_id, action: 'emit_payment_done' }); }
  enqueueErpSaleSafe(order_id, receipt, branch_id);
  enqueueHaravanSaleSafe(order_id, branch_id);
  delete receipt._receipt_print_outbox_id;
  delete receipt._side_effects_deferred;
  return receipt;
}

export function requestPayment(table_id, branch_id = 'sala') {
  db.prepare(`UPDATE tables SET status='paying' WHERE id=? AND status='busy'`).run(table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

export async function generateCustomerPaymentQr(order_id, { method = 'qrcode', client_request_id = null } = {}, branch_id = 'sala') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Order khong ton tai');
  if (order.branch_id && branch_id && order.branch_id !== branch_id) throw new Error('Order khong thuoc chi nhanh hien tai');
  if (!['open', 'partially_paid'].includes(order.status)) throw new Error('Order da dong');
  const pending = order.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Con ${pending.length} dong mon dang cho nhan vien xac nhan`);
  const amountW = Math.max(0, money(order.total) - paidForOrder(order_id));
  if (!amountW) throw new Error('Bill hien tai khong co so tien can thanh toan.');
  let intent = PaymentIntents.activeIntentForOrder(order.id, branch_id);
  if (!intent || intent.state !== 'AWAITING_FUNDS' || Number(intent.amount) !== amountW) {
    intent = PaymentIntents.createPaymentIntent({
      branch_id,
      order_id: order.id,
      amount: amountW,
      method,
      client_request_id,
      snapshot: { total: money(order.total), remaining_due: amountW, customer: order.customer_json || null },
    });
  }
  const qr = await buildPaymentQr({ amount: amountW, reference: intent.transfer_reference, orderId: intent.id, method, orderRefId: order.id, branch_id });
  return { ...qr, payment_intent_id: intent.id, payment_intent_state: intent.state, expires_at: intent.expires_at,
    bill_no: null, bill_status: 'NOT_CREATED' };
}

// Retail/standalone: chưa tạo order khi hiển thị QR → client gửi amount + reference.
export async function buildStandalonePaymentQr({ amount, reference, method = 'qrcode' } = {}, branch_id = 'sala') {
  const amt = Math.max(0, money(amount));
  if (!amt) throw new Error('Thieu so tien tao QR');
  const ref = vietQrSafe(reference || '', 23) || `DANBILL${vietQrSafe(String(Date.now()), 13)}`;
  return buildPaymentQr({ amount: amt, reference: ref, orderId: ref, method, orderRefId: null, branch_id });
}

// Lõi dùng chung cho iPad/POS/Retail: chọn nguồn QR theo Settings → Thanh toán (qrProvider:
// vietqr_public | vietqr_api | payos) và trả về QR + thông tin nhận tiền thật.
async function buildPaymentQr({ amount, reference, orderId, method = 'qrcode', orderRefId = null, branch_id = 'sala' }) {
  const chosen = CUSTOMER_QR_METHODS.includes(method) ? method : 'qrcode';
  const ops = getOperationsConfig(branch_id);
  const methodCfg = (ops.payment?.methods || []).find(m => m.key === chosen);
  if (methodCfg && methodCfg.enabled === false) throw new Error('Phuong thuc thanh toan nay dang tat trong Cai dat');

  const integrations = getIntegrations(branch_id);
  const vietqr = integrations.channels?.vietqr || {};

  // ĐƯỜNG NHẬN CHUYỂN KHOẢN do một chỗ duy nhất quyết (services/qrProvider.js),
  // không để mỗi màn tự đoán. Cửa hàng tắt SePay + tắt QR ngân hàng thì QR TĨNH
  // tự lên thay ở MỌI màn — vì mọi màn đều đi qua đúng hàm này.
  const duong = resolveQrProvider(branch_id);
  const provider = duong.provider || String(ops.payment?.qrProvider || 'vietqr_public').toLowerCase();

  // QR TĨNH: trả thẳng ảnh cửa hàng đã tải lên. KHÔNG đòi thông tin ngân hàng —
  // ảnh đã mang sẵn số tài khoản trong đó rồi. Và đánh dấu rõ là KHÔNG tự đối
  // soát, để màn khách nói đúng sự thật thay vì hứa hẹn tiền về là tự đóng bill.
  if (provider === 'static') {
    if (!duong.staticQrUrl) {
      throw new Error('Chua tai anh QR tinh len trong Cai dat > Thanh toan.');
    }
    return {
      ok: true,
      amount,
      method: CUSTOMER_QR_METHODS.includes(method) ? method : 'qrcode',
      reference,
      orderId,
      provider: 'static',
      providerLabel: 'QR tĩnh (đối soát tay)',
      imageUrl: duong.staticQrUrl,
      fallbackImageUrl: duong.staticQrUrl,
      note: duong.staticQrNote,
      manualReconcile: true,
      bankName: cleanText(ops.payment?.bankName, 80) || '',
    };
  }

  const bankCode = cleanText(vietqr.bankCode || ops.payment?.bankCode, 40).toUpperCase();
  const bankAccount = cleanText(vietqr.bankAccount || ops.payment?.bankAccount, 80);
  const userBankName = stripVietnamese(cleanText(vietqr.userBankName || ops.payment?.accountName, 160)).toUpperCase();
  if (!bankCode || !bankAccount || !userBankName) throw new Error('Chua cau hinh day du ngan hang nhan QR trong Settings.');

  const fallbackImageUrl = publicVietQrImage({ bankCode, bankAccount, accountName: userBankName, amount, reference });
  const base = {
    ok: true,
    amount,
    method: chosen,
    reference,
    orderId,
    bankCode,
    bankName: cleanText(ops.payment?.bankName, 80) || bankCode,
    bankAccount,
    bankAccountMasked: maskAccount(bankAccount),
    userBankName,
    imageUrl: fallbackImageUrl,
    fallbackImageUrl,
  };

  if (provider === 'payos') {
    const payos = integrations.channels?.payos || {};
    const ready = payos.enabled && cleanText(payos.clientId) && cleanText(payos.apiKey) && cleanText(payos.checksumKey);
    if (!ready) {
      return {
        ...base,
        provider: 'vietqr_public',
        providerLabel: 'VietQR public image',
        warning: payos.enabled ? 'payOS chưa đủ Client ID / API Key / Checksum Key, đang dùng QR public tạm thời.' : 'payOS chưa bật trong Liên kết, đang dùng QR public tạm thời.',
      };
    }
    try {
      const orderCode = payosOrderCode();
      const link = await createPayosPaymentLink(payos, {
        orderCode,
        amount,
        description: reference,
        returnUrl: cleanText(payos.returnUrl, 220),
        cancelUrl: cleanText(payos.cancelUrl, 220),
      });
      // Map orderCode -> bill để webhook payOS đối chiếu nhanh (ngoài việc khớp theo nội dung).
      recordBankTx({ provider: 'payos', externalId: `link:${orderCode}`, branch_id, amount, content: reference, reference, order_id: orderRefId, status: 'pending', raw: { orderCode } });
      const imageUrl = normalizeQrImage(link?.qrCode) || emvQrImage(link?.qrCode) || fallbackImageUrl;
      return {
        ...base,
        provider: 'payos',
        providerLabel: 'payOS',
        imageUrl,
        qrCode: link?.qrCode || '',
        qrLink: link?.checkoutUrl || link?.checkout_url || '',
        orderCode,
        paymentLinkId: link?.paymentLinkId || link?.id || '',
      };
    } catch (e) {
      return {
        ...base,
        provider: 'vietqr_public',
        providerLabel: 'VietQR public image',
        warning: `Không tạo được link payOS (${e.message}). Đang dùng QR public tạm thời.`,
      };
    }
  }

  if (provider !== 'vietqr_api') {
    return { ...base, provider: 'vietqr_public', providerLabel: 'VietQR public image' };
  }

  const missingAuth = ['username', 'password'].filter(k => !cleanText(vietqr[k]));
  if (!vietqr.enabled || missingAuth.length) {
    return {
      ...base,
      provider: 'vietqr_public',
      providerLabel: 'VietQR public image',
      warning: vietqr.enabled
        ? `VietQR API còn thiếu ${missingAuth.join(', ')}, đang dùng QR public tạm thời.`
        : 'VietQR API chưa bật trong Liên kết, đang dùng QR public tạm thời.',
    };
  }

  const payload = {
    bankCode,
    bankAccount,
    userBankName,
    content: reference,
    qrType: 0,
    amount,
    orderId,
    transType: 'C',
  };
  if (cleanText(vietqr.terminalCode, 60)) payload.terminalCode = cleanText(vietqr.terminalCode, 60);
  if (cleanText(vietqr.subTerminalCode, 60)) payload.subTerminalCode = cleanText(vietqr.subTerminalCode, 60);
  if (cleanText(vietqr.serviceCode, 60)) payload.serviceCode = cleanText(vietqr.serviceCode, 60);
  if (cleanText(vietqr.note, 180)) payload.note = cleanText(vietqr.note, 180);

  try {
    const response = await generateViaVietQrApi(vietqr, payload);
    const data = response?.data || response || {};
    const imageUrl = normalizeQrImage(data.qrImage || data.image || data.qr || data.qrCode) || emvQrImage(data.qrCode || data.qr_code) || fallbackImageUrl;
    return {
      ...base,
      provider: 'vietqr_api',
      providerLabel: 'VietQR API',
      imageUrl,
      qrCode: data.qrCode || data.qr_code || '',
      qrLink: data.qrLink || data.qr_link || data.link || '',
      transactionRefId: data.transactionRefId || data.transaction_ref_id || '',
      rawCode: response?.code || data?.code || '',
    };
  } catch (e) {
    return {
      ...base,
      provider: 'vietqr_public',
      providerLabel: 'VietQR public image',
      warning: `Không gọi được VietQR API (${e.message}). Đang dùng QR public tạm thời.`,
    };
  }
}

export function customerQrPay(order_id, { method = 'qrcode', reference = '' } = {}, branch_id = 'sala') {
  const chosen = CUSTOMER_QR_METHODS.includes(method) ? method : 'qrcode';
  const order = getOrder(order_id);
  if (!order) throw new Error('Order khong ton tai');
  if (!['open', 'partially_paid'].includes(order.status)) throw new Error('Order da dong');
  const pending = order.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Con ${pending.length} dong mon dang cho nhan vien xac nhan`);
  const ops = getOperationsConfig(branch_id);
  const cfg = (ops.payment?.methods || []).find(m => m.key === chosen);
  if (cfg && cfg.enabled === false) throw new Error('Phuong thuc thanh toan nay dang tat trong Cai dat');
  const ref = String(reference || paymentReferenceForOrder(order, ops)).slice(0, 120);

  // BẢO MẬT: KHÔNG đóng bill chỉ vì khách bấm "đã chuyển khoản" — đó là tiền chưa
  // được xác minh, ai cũng có thể gọi endpoint này để đóng bill miễn phí. Mặc định,
  // thao tác này chỉ TẠO YÊU CẦU để thu ngân xác nhận (hoặc để webhook ngân hàng
  // SePay/payOS tự đóng khi tiền thật về). Cửa hàng chấp nhận rủi ro có thể bật
  // operations_config.payment.allowCustomerSelfConfirm = true để giữ hành vi cũ.
  const allowSelfConfirm = ops.payment?.allowCustomerSelfConfirm === true;
  if (!allowSelfConfirm) {
    if (order.table_id) {
      db.prepare(`UPDATE tables SET status='paying' WHERE id=? AND status!='free'`).run(order.table_id);
      emit('table:updated', getTableState(order.table_id), branch_id);
    }
    const remainingDue = Math.max(0, money(order.total) - paidForOrder(order_id));
    audit('payment.customer_claimed', { order: order_id, method: chosen, reference: ref, amount: remainingDue }, branch_id, 'Khach bao da CK');
    emit('payment:customer_claimed', { order_id, table_id: order.table_id || null, table_code: order.table_code || null, amount: remainingDue, method: chosen, reference: ref }, branch_id);
    return { ok: true, status: 'awaiting_staff', order_id, amount: remainingDue, reference: ref,
      message: 'Đã ghi nhận. Thu ngân sẽ xác nhận thanh toán trong giây lát.' };
  }
  const remainingDue = Math.max(0, money(order.total) - paidForOrder(order_id));
  const receipt = payOrder(order_id, [{ method: chosen, amount: remainingDue, reference: ref }], { cashier: 'Khach tu thanh toan QR' }, branch_id);
  if (receipt.fully_settled !== false) recordLoyaltyFromOrder(order);
  return { ...receipt, status: receipt.status };
}

// ===========================================================================
// Auto-confirm gateway
//   Đường B: SePay / Casso đọc biến động số dư ngân hàng → webhook về đây.
//   Đường A: payOS tạo link thanh toán → webhook xác nhận về đây.
// Cả hai cùng đi qua processIncomingCredit() để khớp bill theo nội dung chuyển
// khoản (mã DANBILL...) rồi tự đóng bill bằng payOrder(). Idempotency bằng bảng
// bank_transactions (unique provider+external_id).
// ===========================================================================

const AUTO_PAY_METHOD = { sepay: 'bank', casso: 'bank', payos: 'bank', vietqr: 'bank' };

// payOS orderCode phải là số nguyên dương, duy nhất cho mỗi link.
function payosOrderCode() {
  return Number(String(Date.now()).slice(-12));
}

function recordBankTx({ provider, externalId, branch_id, amount, content, accountNumber, reference, order_id,
  payment_intent_id = null, payment_account_id = null, status, raw }) {
  const id = uid('btx_');
  try {
    // UPSERT thay vì INSERT OR IGNORE: một external_id có thể được xử lý lại (SePay
    // gửi lại, hoặc merchant tự bấm "Gửi lại" ở Lịch sử gửi) sau khi lần đầu ghi
    // 'unmatched'/'error' — trước đây IGNORE khiến hàng cũ kẹt mãi ở 'unmatched'
    // dù lần retry sau đó đã khớp và đóng bill thành công, gây hiểu lầm "hên xui".
    // processIncomingCredit() đã chặn KHÔNG gọi tới đây nữa nếu externalId từng
    // ở trạng thái paid/underpaid/already_paid, nên UPDATE ở đây luôn an toàn.
    const normalizedContent = PaymentIntents.providerSafe(content, 120);
    const canonicalMatchStatus = ({ paid: 'MATCHED', underpaid: 'MATCHED', already_paid: 'REVIEWED',
      unmatched: 'UNMATCHED', ignored: 'IGNORED' })[status] || 'UNMATCHED';
    const r = db.prepare(`INSERT INTO bank_transactions
      (id,provider,external_id,branch_id,tenant_id,payment_account_id,amount,currency,content,content_normalized,
       account_number,reference,order_id,matched_payment_intent_id,status,match_status,match_method,raw_json,created_at,occurred_at)
      VALUES (?,?,?,?,?,?,?,'VND',?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider,external_id) DO UPDATE SET
        amount=excluded.amount, content=excluded.content, account_number=excluded.account_number,
        reference=excluded.reference, order_id=excluded.order_id, status=excluded.status,
        payment_account_id=excluded.payment_account_id,matched_payment_intent_id=excluded.matched_payment_intent_id,
        content_normalized=excluded.content_normalized,match_status=excluded.match_status,match_method=excluded.match_method,
        raw_json=excluded.raw_json, created_at=excluded.created_at,occurred_at=excluded.occurred_at`)
      .run(id, provider, externalId || id, branch_id || null, PaymentIntents.tenantId(), payment_account_id,
        money(amount), cleanText(content, 400), normalizedContent, cleanText(accountNumber, 60), cleanText(reference, 120),
        order_id || null, payment_intent_id, status, canonicalMatchStatus,
        payment_intent_id ? 'EXACT_REFERENCE_ACCOUNT_AMOUNT' : null,
        JSON.stringify(raw || {}).slice(0, 4000), now(), now());
    return { id, inserted: r.changes > 0 };
  } catch (error) {
    // Không được nuốt lỗi ghi sổ ngân hàng: payment có thể đã đóng bill nhưng
    // màn đối soát vẫn để `unmatched`, đúng sự cố production đã quan sát.
    error.message = `Không ghi được bank_transactions (${provider}/${externalId || id}): ${error.message}`;
    throw error;
  }
}

// Tìm bill đang mở mà mã đối soát (DANBILL...) xuất hiện trong nội dung chuyển khoản.
// FIX: Thay vì N+1 query (load 500 orders rồi getOrder() mỗi cái), query trực tiếp bill_no.
function findOpenOrderByContent(content) {
  const needle = vietQrSafe(content, 250);
  if (!needle) return null;
  // Lấy bill_no của tất cả đơn đang mở (chỉ 2 cột, không load items)
  const rows = db.prepare(`SELECT id, branch_id, pay_ref, bill_no, voucher_code FROM orders WHERE status IN ('open','partially_paid') ORDER BY created_at DESC LIMIT 500`).all();
  for (const row of rows) {
    // Tính reference từ bill_no thay vì load toàn bộ order + items — PHẢI dùng
    // đúng cùng công thức với paymentReferenceForOrder() (billNoDigits + prefix),
    // nếu không QR hiển thị 1 kiểu mà chỗ khớp webhook lại chờ 1 kiểu khác, không
    // bao giờ khớp được dù nội dung chuyển khoản đúng y hệt QR.
    const ops = getOperationsConfig(row.branch_id || 'sala');
    const prefix = vietQrSafe(ops.payment?.transferPrefix || 'DANBILL', 8) || 'DANBILL';
    const code = vietQrSafe(billNoDigits(row), Math.max(1, 23 - prefix.length));
    const ref = `${prefix}${code}`.slice(0, 23);
    if (ref && needle.includes(ref)) {
      // Chỉ gọi getOrder() khi đã khớp — thay vì 500 lần
      return getOrder(row.id);
    }
  }
  return null;
}

// Lõi auto-confirm: nhận 1 giao dịch tiền-về đã chuẩn hoá, khớp bill và tự đóng.
function processIncomingCredit(provider, { externalId, amount, content, accountNumber, raw } = {}, branch_id = 'sala') {
  const amt = money(amount);
  if (externalId) {
    // CHỈ chặn khi tiền ĐÃ THỰC SỰ được áp vào 1 đơn (paid/underpaid/already_paid) —
    // trước đây chặn luôn cả 'unmatched'/'error' khiến 1 giao dịch từng không khớp
    // được (VD do đơn chưa kịp tạo lúc khách chuyển quá nhanh) bị KHOÁ VĨNH VIỄN,
    // dù SePay gửi lại (hoặc merchant tự bấm gửi lại ở "Lịch sử gửi") sau khi đơn đã
    // sẵn sàng — đúng cảm giác "hên xui" đã gặp. Chưa áp tiền lần nào thì retry vẫn
    // phải được thử khớp lại bình thường.
    const dup = db.prepare(`SELECT id, status FROM bank_transactions WHERE provider=? AND external_id=? AND status IN ('paid','underpaid','already_paid')`).get(provider, String(externalId));
    if (dup) return { ok: true, status: 'duplicate', tx_id: dup.id };
  }
  const matched = PaymentIntents.findExactWaitingIntent({ accountNumber, reference: content, amount: amt });
  if (matched.status === 'LATE') {
    const late = matched.intent;
    PaymentIntents.markIntent(late.id, 'LATE_RECEIVED', { provider, provider_transaction_id: externalId || null,
      confirmation_source: 'WEBHOOK' });
    recordBankTx({ provider, externalId, branch_id: late.branch_id, payment_account_id: late.payment_account_id,
      payment_intent_id: late.id, amount: amt, content, accountNumber, reference: late.transfer_reference,
      order_id: late.order_id, status: 'late_received', raw });
    return { ok: true, status: 'late_received', message: 'Tiền về cho QR đã hết hiệu lực/hủy. Đã giữ để đối soát, không tự đóng đơn.' };
  }
  if (matched.status !== 'MATCHED') {
    let paymentAccountId = null;
    try { paymentAccountId = PaymentIntents.paymentAccountIdentity(branch_id).id; } catch {}
    recordBankTx({ provider, externalId, branch_id, payment_account_id: paymentAccountId,
      amount: amt, content, accountNumber, status: 'unmatched', raw });
    return { ok: true, status: 'unmatched', reason: matched.status.toLowerCase(), message: 'Giao dich khong khop chinh xac PaymentIntent dang cho (tai khoan + ma + so tien). Da ghi nhan de doi soat thu cong.' };
  }
  const intent = matched.intent;
  const order = getOrder(intent.order_id);
  const reference = intent.transfer_reference;
  if (!order || !['open', 'partially_paid'].includes(order.status)) {
    PaymentIntents.markIntent(intent.id, 'UNKNOWN', { provider, provider_transaction_id: externalId || null });
    recordBankTx({ provider, externalId, branch_id: intent.branch_id, payment_account_id: intent.payment_account_id,
      payment_intent_id: intent.id, amount: amt, content, accountNumber, reference, order_id: intent.order_id, status: 'already_paid', raw });
    return { ok: true, status: 'already_paid', message: 'PaymentIntent hop le nhung don khong con o trang thai co the thanh toan.' };
  }
  const remainingDue = Math.max(0, money(order.total) - paidForOrder(order.id));
  const method = AUTO_PAY_METHOD[provider] || 'bank';
  let receipt;
  try {
    receipt = payOrder(order.id, [{ method, amount: Math.min(amt, remainingDue), reference: `${provider}:${externalId || ''}`.slice(0, 120) }], {
      cashier: `Auto ${provider.toUpperCase()}`,
      idempotency_key: externalId ? `${provider}:${externalId}` : null,
      // Webhook chạy trên VPS nên không có x-device-id. Thiết bị đã mở QR được
      // lưu trên order lúc tạo draft; dùng lại để bill tự in đúng máy local đó.
      device_id: String(order.linked_pos_device || '').trim(),
      payment_intent_id: intent.id,
      confirmation_source: 'WEBHOOK',
      confirmed_by: provider,
      provider,
      provider_transaction_id: externalId || null,
    }, order.branch_id || 'sala');
  } catch (e) {
    // ALREADY_SETTLED = tiền về đúng bill nhưng bill đã đóng trước đó (thu ngân xác
    // nhận tay / thiết bị khác) → đây là tiền THỪA cần đối soát tay (hoàn khách),
    // khác hẳn 'error' (webhook/DB lỗi thật) — tách status để không lẫn vào nhau.
    const status = e.code === 'ALREADY_SETTLED' ? 'already_paid' : 'error';
    if (status !== 'already_paid') PaymentIntents.markIntent(intent.id, 'FAILED', { provider, provider_transaction_id: externalId || null });
    recordBankTx({ provider, externalId, branch_id: order.branch_id, payment_account_id: intent.payment_account_id,
      payment_intent_id: intent.id, amount: amt, content, accountNumber, reference, order_id: order.id, status, raw: { ...(raw || {}), error: e.message } });
    return { ok: true, status, message: e.message };
  }
  const txStatus = receipt.fully_settled === false ? 'underpaid' : 'paid';
  recordBankTx({ provider, externalId, branch_id: order.branch_id, payment_account_id: intent.payment_account_id,
    payment_intent_id: intent.id, amount: amt, content, accountNumber, reference, order_id: order.id, status: txStatus, raw });
  if (receipt.fully_settled !== false) recordLoyaltyFromOrder(order);
  emit('payment:auto', { order_id: order.id, provider, amount: amt, bill_no: order.bill_no || null }, order.branch_id || 'sala');
  // receipt.status chỉ có ở nhánh trả góp (payOrder không set field này khi
  // đóng đủ, chỉ set fully_settled) — dùng txStatus vừa tính ở trên cho đúng,
  // tránh trả 'undefined' cho caller (khiến báo cáo/webhook-test hiện sai).
  return { ok: true, status: txStatus, order_id: order.id, bill_no: order.bill_no || null, amount: Math.min(amt, remainingDue), remaining_due: receipt.remaining_due };
}


// --- Đường B: SePay -------------------------------------------------------
// SePay POST: { id, accountNumber, content, transferType:'in'|'out', transferAmount, referenceCode, ... }
// Xác thực: header  Authorization: Apikey <apiKey>
export function handleSepayWebhook(body = {}, headers = {}, branch_id = 'sala') {
  const cfg = getIntegrations(branch_id).channels?.sepay || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  // BẢO MẬT (fail-closed): webhook này TỰ ĐÓNG BILL khi có "tiền về" nên bắt buộc xác thực.
  // Bật SePay mà CHƯA đặt API key → TỪ CHỐI. Trước đây bỏ qua kiểm tra khi thiếu key →
  // kẻ tấn công POST giả "tiền vào" khớp nội dung bill (mã DANBILL nhìn thấy trên QR) để
  // đóng bill mà không trả tiền.
  if (!cleanText(cfg.apiKey)) {
    audit('payment.webhook.rejected', { provider: 'sepay', reason: 'no_api_key' }, branch_id, 'webhook:sepay');
    const e = new Error('SePay đang bật nhưng chưa cấu hình API key để xác thực webhook — từ chối.'); e.status = 401; throw e;
  }
  const provided = headerVal(headers, 'authorization').replace(/^apikey\s+/i, '').trim();
  if (!safeEqual(provided, cleanText(cfg.apiKey))) { audit('payment.webhook.rejected', { provider: 'sepay', reason: 'bad_api_key' }, branch_id, 'webhook:sepay'); const e = new Error('Sai API key SePay'); e.status = 401; throw e; }
  const transferType = String(body?.transferType || body?.transfer_type || '').toLowerCase();
  if (transferType && transferType !== 'in') return { ok: true, status: 'ignored', reason: 'not_credit' };
  const acc = String(body?.accountNumber || body?.account_number || '');
  if (cleanText(cfg.accountNumber) && acc && acc !== cleanText(cfg.accountNumber)) return { ok: true, status: 'ignored', reason: 'account_mismatch' };
  return processIncomingCredit('sepay', {
    externalId: String(body?.id || body?.referenceCode || body?.reference_code || ''),
    amount: body?.transferAmount ?? body?.transfer_amount ?? body?.amount,
    content: body?.content || body?.description || '',
    accountNumber: acc || getOperationsConfig(branch_id).payment?.bankAccount || '',
    raw: body,
  }, branch_id);
}

// --- Đường B: Casso -------------------------------------------------------
// Casso POST: { error, data:[ { id, tid, description, amount, subAccId, ... } ] } (amount > 0 = tiền vào)
// Xác thực: header  secure-token: <webhookSecret>
export function handleCassoWebhook(body = {}, headers = {}, branch_id = 'sala') {
  const cfg = getIntegrations(branch_id).channels?.casso || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  // BẢO MẬT (fail-closed): bắt buộc secure-token. Bật Casso mà chưa đặt secret → từ chối.
  if (!cleanText(cfg.webhookSecret)) {
    audit('payment.webhook.rejected', { provider: 'casso', reason: 'no_secure_token' }, branch_id, 'webhook:casso');
    const e = new Error('Casso đang bật nhưng chưa cấu hình secure-token để xác thực webhook — từ chối.'); e.status = 401; throw e;
  }
  const token = headerVal(headers, 'secure-token') || headerVal(headers, 'x-casso-signature');
  if (!safeEqual(token, cleanText(cfg.webhookSecret))) { audit('payment.webhook.rejected', { provider: 'casso', reason: 'bad_secure_token' }, branch_id, 'webhook:casso'); const e = new Error('Sai secure-token Casso'); e.status = 401; throw e; }
  const list = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
  const results = [];
  for (const t of list) {
    const amount = money(t?.amount);
    if (amount <= 0) continue; // chỉ xử lý tiền vào
    const acc = String(t?.subAccId || t?.bank_sub_acc_id || t?.accountNumber || '');
    if (cleanText(cfg.accountNumber) && acc && acc !== cleanText(cfg.accountNumber)) continue;
    results.push(processIncomingCredit('casso', {
      externalId: String(t?.id || t?.tid || t?.reference || ''),
      amount,
      content: t?.description || t?.content || '',
      accountNumber: acc || getOperationsConfig(branch_id).payment?.bankAccount || '',
      raw: t,
    }, branch_id));
  }
  return { ok: true, processed: results.length, results };
}

// --- VietQR transaction-sync (callback đối soát của chính VietQR API) -------
// Nhiều gói VietQR (api.vietqr.org) tự POST giao dịch về URL đăng ký khi khách
// trả tiền. transType 'C' = tiền vào. Xác thực bằng Basic Auth = username/password
// VietQR đã cấu hình (nếu VietQR gửi kèm).
export function handleVietqrWebhook(body = {}, headers = {}, branch_id = 'sala') {
  const cfg = getIntegrations(branch_id).channels?.vietqr || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  // BẢO MẬT (fail-closed): webhook tự đóng bill → bắt buộc Basic Auth khớp username/password
  // VietQR. Bật VietQR mà chưa cấu hình username/password → từ chối. Trước đây nếu request
  // KHÔNG gửi header Basic thì bỏ qua kiểm tra hoàn toàn → giả "tiền về" đóng bill được.
  if (!cleanText(cfg.username) || !cleanText(cfg.password)) {
    audit('payment.webhook.rejected', { provider: 'vietqr', reason: 'no_basic_auth_configured' }, branch_id, 'webhook:vietqr');
    const e = new Error('VietQR đang bật nhưng chưa cấu hình username/password để xác thực webhook — từ chối.'); e.status = 401; throw e;
  }
  const auth = headerVal(headers, 'authorization');
  let decoded = '';
  try { decoded = Buffer.from(auth.replace(/^basic\s+/i, '').trim(), 'base64').toString('utf8'); } catch { decoded = ''; }
  if (!/^basic\s+/i.test(auth) || !safeEqual(decoded, `${cleanText(cfg.username)}:${cleanText(cfg.password)}`)) {
    audit('payment.webhook.rejected', { provider: 'vietqr', reason: 'bad_basic_auth' }, branch_id, 'webhook:vietqr');
    const e = new Error('Sai Basic Auth VietQR'); e.status = 401; throw e;
  }
  const transType = String(body?.transType || body?.transtype || body?.type || '').toUpperCase();
  if (transType && transType !== 'C') return { ok: true, status: 'ignored', reason: 'not_credit' };
  const acc = String(body?.bankAccount || body?.accountNumber || body?.account || '');
  if (cleanText(cfg.bankAccount) && acc && acc !== cleanText(cfg.bankAccount)) return { ok: true, status: 'ignored', reason: 'account_mismatch' };
  return processIncomingCredit('vietqr', {
    externalId: String(body?.transactionid || body?.transactionId || body?.referenceNumber || body?.referencenumber || body?.ftCode || body?.transactionRefId || ''),
    amount: body?.amount ?? body?.transferAmount ?? body?.transAmount,
    content: body?.content || body?.description || body?.addInfo || '',
    accountNumber: acc || getOperationsConfig(branch_id).payment?.bankAccount || '',
    raw: body,
  }, branch_id);
}

// --- Đường A: payOS -------------------------------------------------------
function payosVerifySignature(body = {}, checksumKey = '') {
  const data = body?.data;
  const signature = body?.signature;
  if (!data || !signature || !checksumKey) return false;
  const sorted = Object.keys(data).sort().map((k) => {
    let v = data[k];
    if (v === null || v === undefined) v = '';
    else if (typeof v === 'object') v = JSON.stringify(v);
    return `${k}=${v}`;
  }).join('&');
  const expected = crypto.createHmac('sha256', checksumKey).update(sorted).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); }
  catch { return false; }
}

export function handlePayosWebhook(body = {}, headers = {}, branch_id = 'sala') {
  const cfg = getIntegrations(branch_id).channels?.payos || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  // payOS gửi ping xác thực khi đăng ký webhook (data rỗng) — cứ ACK 200.
  if (!body || !body.data || (typeof body.data === 'object' && !Object.keys(body.data).length)) return { ok: true, status: 'ack' };
  if (!cleanText(cfg.checksumKey)) { const e = new Error('payOS chua cau hinh Checksum Key'); e.status = 400; throw e; }
  if (!payosVerifySignature(body, cleanText(cfg.checksumKey))) { audit('payment.webhook.rejected', { provider: 'payos', reason: 'bad_signature' }, branch_id, 'webhook:payos'); const e = new Error('Sai chu ky payOS'); e.status = 401; throw e; }
  const d = body.data || {};
  const success = body.success === true || String(body.code) === '00' || String(d.code) === '00';
  if (!success) return { ok: true, status: 'ignored', reason: 'not_successful' };
  return processIncomingCredit('payos', {
    externalId: String(d.reference || d.paymentLinkId || d.orderCode || ''),
    amount: d.amount,
    content: d.description || '',
    accountNumber: d.accountNumber || getOperationsConfig(branch_id).payment?.bankAccount || '',
    raw: body,
  }, branch_id);
}

// Tạo link thanh toán payOS (v2). Trả về { checkoutUrl, qrCode, paymentLinkId, ... }.
export async function createPayosPaymentLink(cfg = {}, { orderCode, amount, description, returnUrl, cancelUrl } = {}) {
  const base = (cleanText(cfg.apiBase, 220) || 'https://api-merchant.payos.vn').replace(/\/+$/, '');
  // Fallback theo APP_URL của server đang chạy — KHÔNG hardcode domain bên thứ ba
  // (domain onrender.com cũ đã xóa; nếu hardcode, người khác chiếm lại subdomain
  // là nhận được redirect thanh toán của khách).
  const appUrl = (cleanText(process.env.APP_URL, 220) || 'http://localhost:3000').replace(/\/+$/, '');
  const ret = cleanText(returnUrl, 220) || cleanText(cfg.returnUrl, 220) || `${appUrl}/pay/success`;
  const cancel = cleanText(cancelUrl, 220) || cleanText(cfg.cancelUrl, 220) || `${appUrl}/pay/cancel`;
  const desc = cleanText(description, 25);
  const signData = `amount=${amount}&cancelUrl=${cancel}&description=${desc}&orderCode=${orderCode}&returnUrl=${ret}`;
  const signature = crypto.createHmac('sha256', cleanText(cfg.checksumKey)).update(signData).digest('hex');
  const res = await fetchJson(`${base}/v2/payment-requests`, {
    method: 'POST',
    headers: { 'x-client-id': cleanText(cfg.clientId), 'x-api-key': cleanText(cfg.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderCode, amount, description: desc, returnUrl: ret, cancelUrl: cancel, signature }),
  });
  return res?.data || res;
}

// Hỏi trạng thái 1 đơn payOS (chiều ĐI RA → chạy được cả ở localhost, không cần webhook).
// Dùng cho auto-detect: màn thanh toán poll endpoint này tới khi status='PAID'.
export async function getPayosPaymentStatus(orderCode, branch_id = 'sala') {
  const cfg = getIntegrations(branch_id).channels?.payos || {};
  if (!cfg.enabled || !cleanText(cfg.clientId) || !cleanText(cfg.apiKey)) {
    return { ok: false, status: 'not_configured', paid: false };
  }
  const base = (cleanText(cfg.apiBase, 220) || 'https://api-merchant.payos.vn').replace(/\/+$/, '');
  try {
    const res = await fetchJson(`${base}/v2/payment-requests/${encodeURIComponent(orderCode)}`, {
      method: 'GET',
      headers: { 'x-client-id': cleanText(cfg.clientId), 'x-api-key': cleanText(cfg.apiKey) },
    });
    const d = res?.data || res || {};
    const status = String(d.status || '').toUpperCase();
    return { ok: true, status, paid: status === 'PAID', amountPaid: money(d.amountPaid), orderCode: d.orderCode || orderCode };
  } catch (e) {
    return { ok: false, status: 'error', paid: false, message: String(e.message || '').slice(0, 160) };
  }
}

// Đối soát: danh sách giao dịch webhook gần đây (cho UI + audit).
// Hỗ trợ lọc cho màn xác nhận thủ công: ?status=unmatched,underpaid&minutes=240
// (khách quét QR CŨ → tiền về nhưng 'unmatched' → thu ngân đối chiếu tại đây).
export function listBankTransactions(branch_id = 'sala', { limit = 50, status = '', minutes = 0 } = {}) {
  const rows = db.prepare(`SELECT id,provider,external_id,amount,content,reference,order_id,status,created_at
    FROM bank_transactions WHERE (branch_id=? OR branch_id IS NULL) ORDER BY created_at DESC LIMIT ?`)
    .all(branch_id, Math.max(1, Math.min(200, parseInt(limit) || 50)));
  const statuses = String(status || '').split(',').map(s => s.trim()).filter(Boolean);
  const mins = Math.max(0, parseInt(minutes) || 0);
  const cutoff = mins > 0 ? Date.now() - mins * 60_000 : 0;
  const filtered = rows.filter(r => {
    if (statuses.length && !statuses.includes(r.status)) return false;
    if (cutoff) {
      const t = Date.parse(r.created_at);
      if (Number.isFinite(t) && t < cutoff) return false;
    }
    return true;
  });
  return { transactions: filtered };
}

export function testBankWebhook(provider, cfg = {}, webhookUrl = '') {
  if (!cfg.enabled) return { channel: provider, ok: false, mode: 'disabled', webhookUrl, message: `${provider.toUpperCase()} đang tắt. Bật kết nối trước khi kiểm tra.` };
  if (provider === 'sepay') {
    const ok = !!cleanText(cfg.apiKey);
    return { channel: provider, ok, mode: ok ? 'ready' : 'partial', webhookUrl,
      message: ok
        ? 'Đã có API Key. Dán Webhook URL ở trên vào SePay → Tích hợp Webhooks (Authorization: Apikey ...). Khi có tiền chuyển khoản khớp nội dung bill, hệ thống tự đóng bill.'
        : 'Thiếu API Key SePay (SePay Dashboard → Cấu hình → API Key / Webhook).' };
  }
  if (provider === 'casso') {
    const ok = !!cleanText(cfg.webhookSecret);
    return { channel: provider, ok, mode: ok ? 'ready' : 'partial', webhookUrl,
      message: ok
        ? 'Đã có secure-token. Dán Webhook URL ở trên vào Casso → Webhook và đặt cùng secure-token. Khi có tiền về khớp nội dung bill, hệ thống tự đóng bill.'
        : 'Thiếu secure-token Casso (Casso → Cấu hình Webhook).' };
  }
  return { channel: provider, ok: false, mode: 'unknown', webhookUrl, message: 'Provider không hỗ trợ.' };
}

function buildReceipt(order_id, payment_id, lines, paid, { cashier = '', discount_breakdown = null, voucher = null, promotions = null } = {}) {
  const order = getOrder(order_id);
  const branch = db.prepare(`SELECT name FROM branches WHERE id=?`).get(order.branch_id);
  const printCfg = getPrintConfig(order.branch_id);
  const change = Math.max(0, paid - order.total);
  const orderVoucher = voucher || lookupVoucher(order.voucher_id, order.branch_id);
  return {
    payment_id, order_id, branch: branch?.name, table_code: order.table_code,
    items: order.items.filter(i => i.status !== 'cancelled'),
    subtotal: order.subtotal, goods_amount: order.goods_amount, vat_amount: order.vat_amount, discount: order.discount, total: order.total,
    tax: receiptTaxBlock(printCfg),
    voucher_id: order.voucher_id, voucher_code: order.voucher_code,
    voucher: orderVoucher,
    promotions: Array.isArray(promotions) ? promotions : order.items.map(i => i.promo).filter(Boolean),
    discount_breakdown,
    customer: (() => { try { return order.customer_json ? JSON.parse(order.customer_json) : null; } catch { return null; } })(),
    invoice_choice: order.invoice_choice || '',
    invoice_id: order.invoice_id || null,
    lines, paid, change, paid_at: order.paid_at, created_at: order.created_at, number: order.bill_no || order_id.slice(-6).toUpperCase(),
    bill_no: order.bill_no || order_id.slice(-6).toUpperCase(),
    cashier,
    // GHI CHÚ đơn phải theo bill ra máy in. Thiếu field này thì bill in chỉ có
    // chữ "Ghi chú:" trống dù thu ngân đã gõ nội dung (orders.note đã lưu).
    note: order.note || '',
    linked_pos_device: order.linked_pos_device || null,
    linked_printer_id: order.linked_printer_id || null,
  };
}

function lookupVoucher(id, branch_id = 'sala') {
  if (!id) return null;
  const v = db.prepare(`SELECT id,code,name,type,value,scope FROM vouchers WHERE id=? AND branch_id=?`).get(id, branch_id);
  return v || null;
}

// ===========================================================================
// Đối soát thủ công (manual confirm)
// Khi webhook không khớp (khách quét QR CŨ sau khi client đã reload QR mới,
// hệ thống chậm, sai nội dung CK...), giao dịch tiền-về vẫn được ghi trong
// bank_transactions với status 'unmatched'/'underpaid'. Thu ngân mở danh sách
// này để đối chiếu số tiền/nội dung rồi gắn vào bill đang thanh toán; nếu
// không có cả webhook (mất mạng) thì xác nhận tay bằng PIN của CHÍNH MÌNH +
// lý do — route /orders/:id/pay và /retail/checkout xử lý PIN + audit.
// ===========================================================================

// Gắn 1 giao dịch chưa khớp vào bill vừa thanh toán (đóng vòng đối soát).
export function markBankTxClaimed(txId, order_id, byUser = '', branch_id = 'sala') {
  if (!txId) return { ok: false };
  const r = db.prepare(`UPDATE bank_transactions SET status='claimed', order_id=? WHERE id=? AND status IN ('unmatched','underpaid')`)
    .run(order_id || null, String(txId));
  if (r.changes > 0) {
    audit('payment.bank_tx_claimed', { tx: String(txId), order: order_id || null, by: byUser }, branch_id, byUser || 'system');
  }
  return { ok: r.changes > 0 };
}
