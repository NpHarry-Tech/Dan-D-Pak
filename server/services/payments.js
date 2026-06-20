// Payment Core: multi-method payment lines, close bill, trigger inventory deduction.
import crypto from 'node:crypto';
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getOrder, getTableState, resolveStaffCall } from './orders.js';
import { deductForOrder } from './inventory.js';
import { printReceipt } from './printing.js';
import { getIntegrations, getOperationsConfig, getPrintConfig } from './settings.js';
import { getActiveShift } from './shifts.js';
import { archiveOrder, archivePayment } from './archive.js';

const METHODS = ['cash', 'card', 'qr', 'voucher', 'bank_transfer', 'internet_banking', 'qrcode', 'momo', 'zalopay', 'visa', 'pos_card', 'online'];
const CUSTOMER_QR_METHODS = ['qr', 'qrcode', 'internet_banking', 'momo', 'zalopay'];

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
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

function paymentReferenceForOrder(order, ops, max = 23) {
  const prefix = vietQrSafe(ops.payment?.transferPrefix || 'DANBILL', 8) || 'DANBILL';
  const code = vietQrSafe(order.bill_no || order.id || Date.now(), Math.max(1, max - prefix.length));
  return `${prefix}${code}`.slice(0, max);
}

function vietQrOrderId(order) {
  return vietQrSafe(order.bill_no || order.id || Date.now(), 13) || `DAN${Date.now()}`.slice(0, 13);
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

function publicVietQrImage({ bankCode, bankAccount, accountName, amount, reference }) {
  if (!bankCode || !bankAccount) return '';
  const query = new URLSearchParams({
    amount: String(Math.max(0, parseInt(amount) || 0)),
    addInfo: reference,
    accountName: accountName || '',
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(bankAccount)}-compact2.png?${query.toString()}`;
}

function normalizeQrImage(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
  return '';
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
  if (!phone) throw new Error('Thiếu số điện thoại nhận hóa đơn');
  return {
    invoice_request: true,
    invoice_type: 'company',
    invoice_customer_name: name,
    invoice_company: company,
    tax_code,
    company,
    name,
    address: cleanText(input.address, 260),
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
    invoice_request: true,
    invoice_type: 'company',
    invoice_customer_name: invoiceCustomer.invoice_customer_name,
    invoice_company: invoiceCustomer.invoice_company,
    invoice_note: invoiceCustomer.note || '',
    invoice_requested_at: invoiceCustomer.requested_at,
  };
}

// lines: [{method, amount, reference}]
export function payOrder(order_id, lines, { discount, cashier, customer, invoice_customer } = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Order không tồn tại');
  if (order.status !== 'open') throw new Error('Order đã đóng');

  if (typeof discount === 'number') {
    db.prepare(`UPDATE orders SET discount=?, total=MAX(0,subtotal-?) WHERE id=?`).run(discount, discount, order_id);
  }
  const invoiceCustomer = normalizeInvoiceCustomer(invoice_customer);
  const customerSnapshot = mergeInvoiceCustomer(customer, invoiceCustomer);
  if (customerSnapshot) {
    if (invoiceCustomer) {
      db.prepare(`UPDATE orders SET customer_json=?, invoice_choice='requested' WHERE id=?`).run(JSON.stringify(customerSnapshot), order_id);
      audit('invoice.company_requested', { order: order_id, tax_code: invoiceCustomer.tax_code, email: invoiceCustomer.email, phone: invoiceCustomer.phone }, branch_id, cashier || 'system');
    } else {
      db.prepare(`UPDATE orders SET customer_json=? WHERE id=?`).run(JSON.stringify(customerSnapshot), order_id);
    }
  }
  const fresh = getOrder(order_id);
  const pending = fresh.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Còn ${pending.length} dòng món đang chờ nhân viên xác nhận`);

  const ops = getOperationsConfig(branch_id);
  const shift = getActiveShift(branch_id);
  if (ops.shifts.requireOpenShift !== false && !shift) throw new Error('Can mo ca lam viec truoc khi thanh toan.');

  const paid = lines.reduce((s, l) => s + (parseInt(l.amount) || 0), 0);
  if (paid < fresh.total) throw new Error(`Chưa đủ tiền: cần ${fresh.total}, nhận ${paid}`);
  for (const l of lines) if (!METHODS.includes(l.method)) throw new Error('Phương thức không hợp lệ: ' + l.method);

  const pid = uid('pay_');
  db.prepare(`INSERT INTO payments (id,order_id,shift_id,total,created_at) VALUES (?,?,?,?,?)`).run(pid, order_id, shift?.id || null, fresh.total, now());
  const insLine = db.prepare(`INSERT INTO payment_lines (id,payment_id,method,amount,reference) VALUES (?,?,?,?,?)`);
  for (const l of lines) insLine.run(uid('pl_'), pid, l.method, parseInt(l.amount) || 0, l.reference || null);

  db.prepare(`UPDATE orders SET status='paid', paid_at=? WHERE id=?`).run(now(), order_id);
  // Mark all remaining active items served on close
  db.prepare(`UPDATE order_items SET status='served', served_at=? WHERE order_id=? AND status NOT IN ('served','cancelled')`)
    .run(now(), order_id);

  deductForOrder(fresh, branch_id);

  if (order.table_id) {
    const stillOpen = db.prepare(`SELECT 1 FROM orders WHERE table_id=? AND branch_id=? AND status='open' LIMIT 1`)
      .get(order.table_id, branch_id);
    db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(stillOpen ? 'busy' : 'free', order.table_id);
    resolveStaffCall(order.table_id, branch_id);
    emit('table:updated', getTableState(order.table_id), branch_id);
  }
  audit('payment.done', { order: order_id, total: fresh.total, lines: lines.length, shift_id: shift?.id || null }, branch_id);
  const receipt = buildReceipt(order_id, pid, lines, paid, { cashier });
  receipt.print_config = getPrintConfig(branch_id);
  receipt.branch_id = branch_id;
  archiveOrder(getOrder(order_id));
  archivePayment(receipt);
  printReceipt(receipt, branch_id);
  emit('payment:done', { order_id, receipt }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return receipt;
}

export function requestPayment(table_id, branch_id = 'br1') {
  db.prepare(`UPDATE tables SET status='paying' WHERE id=? AND status='busy'`).run(table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

export async function generateCustomerPaymentQr(order_id, { method = 'qrcode' } = {}, branch_id = 'br1') {
  const chosen = CUSTOMER_QR_METHODS.includes(method) ? method : 'qrcode';
  const order = getOrder(order_id);
  if (!order) throw new Error('Order khong ton tai');
  if (order.branch_id && branch_id && order.branch_id !== branch_id) throw new Error('Order khong thuoc chi nhanh hien tai');
  if (order.status !== 'open') throw new Error('Order da dong');
  const pending = order.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Con ${pending.length} dong mon dang cho nhan vien xac nhan`);

  const ops = getOperationsConfig(branch_id);
  const methodCfg = (ops.payment?.methods || []).find(m => m.key === chosen);
  if (methodCfg && methodCfg.enabled === false) throw new Error('Phuong thuc thanh toan nay dang tat trong Cai dat');

  const integrations = getIntegrations(branch_id);
  const vietqr = integrations.channels?.vietqr || {};
  const provider = String(ops.payment?.qrProvider || 'vietqr_public').toLowerCase();
  const amount = Math.max(0, parseInt(order.total) || 0);
  if (!amount) throw new Error('Bill hien tai khong co so tien can thanh toan.');

  const bankCode = cleanText(vietqr.bankCode || ops.payment?.bankCode, 40).toUpperCase();
  const bankAccount = cleanText(vietqr.bankAccount || ops.payment?.bankAccount, 80);
  const userBankName = stripVietnamese(cleanText(vietqr.userBankName || ops.payment?.accountName, 160)).toUpperCase();
  if (!bankCode || !bankAccount || !userBankName) throw new Error('Chua cau hinh day du ngan hang nhan QR trong Settings.');

  const reference = paymentReferenceForOrder(order, ops);
  const orderId = vietQrOrderId(order);
  const fallbackImageUrl = publicVietQrImage({
    bankCode,
    bankAccount,
    accountName: userBankName,
    amount,
    reference,
  });
  const base = {
    ok: true,
    amount,
    method: chosen,
    reference,
    orderId,
    bankCode,
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
      const orderCode = payosOrderCode(order);
      const link = await createPayosPaymentLink(payos, {
        orderCode,
        amount,
        description: reference,
        returnUrl: cleanText(payos.returnUrl, 220),
        cancelUrl: cleanText(payos.cancelUrl, 220),
      });
      // Map orderCode -> bill để webhook payOS đối chiếu nhanh (ngoài việc khớp theo nội dung).
      recordBankTx({ provider: 'payos', externalId: `link:${orderCode}`, branch_id, amount, content: reference, reference, order_id: order.id, status: 'pending', raw: { orderCode } });
      const imageUrl = normalizeQrImage(link?.qrCode) || fallbackImageUrl;
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
    const imageUrl = normalizeQrImage(data.qrImage || data.image || data.qr || data.qrCode) || fallbackImageUrl;
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

export function customerQrPay(order_id, { method = 'qrcode', reference = '' } = {}, branch_id = 'br1') {
  const chosen = CUSTOMER_QR_METHODS.includes(method) ? method : 'qrcode';
  const order = getOrder(order_id);
  if (!order) throw new Error('Order khong ton tai');
  if (order.status !== 'open') throw new Error('Order da dong');
  const pending = order.items.filter(i => i.status === 'pending_confirm');
  if (pending.length) throw new Error(`Con ${pending.length} dong mon dang cho nhan vien xac nhan`);
  const ops = getOperationsConfig(branch_id);
  const cfg = (ops.payment?.methods || []).find(m => m.key === chosen);
  if (cfg && cfg.enabled === false) throw new Error('Phuong thuc thanh toan nay dang tat trong Cai dat');
  const ref = String(reference || paymentReferenceForOrder(order, ops)).slice(0, 120);
  return payOrder(order_id, [{ method: chosen, amount: order.total, reference: ref }], { cashier: 'Khach tu thanh toan QR' }, branch_id);
}

// ===========================================================================
// Auto-confirm gateway
//   Đường B: SePay / Casso đọc biến động số dư ngân hàng → webhook về đây.
//   Đường A: payOS tạo link thanh toán → webhook xác nhận về đây.
// Cả hai cùng đi qua processIncomingCredit() để khớp bill theo nội dung chuyển
// khoản (mã DANBILL...) rồi tự đóng bill bằng payOrder(). Idempotency bằng bảng
// bank_transactions (unique provider+external_id).
// ===========================================================================

const AUTO_PAY_METHOD = { sepay: 'bank_transfer', casso: 'bank_transfer', payos: 'qrcode' };

// payOS orderCode phải là số nguyên dương, duy nhất cho mỗi link.
function payosOrderCode() {
  return Number(String(Date.now()).slice(-12));
}

function recordBankTx({ provider, externalId, branch_id, amount, content, accountNumber, reference, order_id, status, raw }) {
  const id = uid('btx_');
  try {
    const r = db.prepare(`INSERT OR IGNORE INTO bank_transactions
      (id,provider,external_id,branch_id,amount,content,account_number,reference,order_id,status,raw_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, provider, externalId || id, branch_id || null, parseInt(amount) || 0,
        cleanText(content, 400), cleanText(accountNumber, 60), cleanText(reference, 120),
        order_id || null, status, JSON.stringify(raw || {}).slice(0, 4000), now());
    return { id, inserted: r.changes > 0 };
  } catch {
    return { id, inserted: false };
  }
}

// Tìm bill đang mở mà mã đối soát (DANBILL...) xuất hiện trong nội dung chuyển khoản.
function findOpenOrderByContent(content) {
  const needle = vietQrSafe(content, 250);
  if (!needle) return null;
  const rows = db.prepare(`SELECT id, branch_id FROM orders WHERE status='open' ORDER BY created_at DESC LIMIT 500`).all();
  for (const row of rows) {
    const order = getOrder(row.id);
    if (!order) continue;
    const ops = getOperationsConfig(order.branch_id || 'br1');
    const ref = paymentReferenceForOrder(order, ops);
    if (ref && needle.includes(ref)) return order;
  }
  return null;
}

// Lõi auto-confirm: nhận 1 giao dịch tiền-về đã chuẩn hoá, khớp bill và tự đóng.
function processIncomingCredit(provider, { externalId, amount, content, accountNumber, raw } = {}) {
  const amt = parseInt(amount) || 0;
  if (externalId) {
    const dup = db.prepare(`SELECT id, status FROM bank_transactions WHERE provider=? AND external_id=? AND status IN ('paid','unmatched','underpaid','error','duplicate')`).get(provider, String(externalId));
    if (dup) return { ok: true, status: 'duplicate', tx_id: dup.id };
  }
  const order = findOpenOrderByContent(content);
  if (!order) {
    recordBankTx({ provider, externalId, amount: amt, content, accountNumber, status: 'unmatched', raw });
    return { ok: true, status: 'unmatched', message: 'Khong khop bill nao dang mo. Da ghi nhan de doi soat thu cong.' };
  }
  const ops = getOperationsConfig(order.branch_id || 'br1');
  const reference = paymentReferenceForOrder(order, ops);
  if (amt < (parseInt(order.total) || 0)) {
    recordBankTx({ provider, externalId, branch_id: order.branch_id, amount: amt, content, accountNumber, reference, order_id: order.id, status: 'underpaid', raw });
    return { ok: true, status: 'underpaid', message: `So tien ${amt} chua du ${order.total} cho bill ${order.bill_no || order.id}.` };
  }
  const method = AUTO_PAY_METHOD[provider] || 'bank_transfer';
  try {
    payOrder(order.id, [{ method, amount: order.total, reference: `${provider}:${externalId || ''}`.slice(0, 120) }], { cashier: `Auto ${provider.toUpperCase()}` }, order.branch_id || 'br1');
  } catch (e) {
    recordBankTx({ provider, externalId, branch_id: order.branch_id, amount: amt, content, accountNumber, reference, order_id: order.id, status: 'error', raw: { ...(raw || {}), error: e.message } });
    return { ok: true, status: 'error', message: e.message };
  }
  recordBankTx({ provider, externalId, branch_id: order.branch_id, amount: amt, content, accountNumber, reference, order_id: order.id, status: 'paid', raw });
  audit('payment.auto_confirmed', { provider, order: order.id, amount: amt, reference }, order.branch_id || 'br1', `auto:${provider}`);
  emit('payment:auto', { order_id: order.id, provider, amount: amt, bill_no: order.bill_no || null }, order.branch_id || 'br1');
  return { ok: true, status: 'paid', order_id: order.id, bill_no: order.bill_no || null, amount: parseInt(order.total) || 0 };
}

function headerVal(headers = {}, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return String(headers[k] || '');
  return '';
}

// --- Đường B: SePay -------------------------------------------------------
// SePay POST: { id, accountNumber, content, transferType:'in'|'out', transferAmount, referenceCode, ... }
// Xác thực: header  Authorization: Apikey <apiKey>
export function handleSepayWebhook(body = {}, headers = {}, branch_id = 'br1') {
  const cfg = getIntegrations(branch_id).channels?.sepay || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  if (cleanText(cfg.apiKey)) {
    const provided = headerVal(headers, 'authorization').replace(/^apikey\s+/i, '').trim();
    if (provided !== cleanText(cfg.apiKey)) { const e = new Error('Sai API key SePay'); e.status = 401; throw e; }
  }
  const transferType = String(body?.transferType || body?.transfer_type || '').toLowerCase();
  if (transferType && transferType !== 'in') return { ok: true, status: 'ignored', reason: 'not_credit' };
  const acc = String(body?.accountNumber || body?.account_number || '');
  if (cleanText(cfg.accountNumber) && acc && acc !== cleanText(cfg.accountNumber)) return { ok: true, status: 'ignored', reason: 'account_mismatch' };
  return processIncomingCredit('sepay', {
    externalId: String(body?.id || body?.referenceCode || body?.reference_code || ''),
    amount: body?.transferAmount ?? body?.transfer_amount ?? body?.amount,
    content: body?.content || body?.description || '',
    accountNumber: acc,
    raw: body,
  });
}

// --- Đường B: Casso -------------------------------------------------------
// Casso POST: { error, data:[ { id, tid, description, amount, subAccId, ... } ] } (amount > 0 = tiền vào)
// Xác thực: header  secure-token: <webhookSecret>
export function handleCassoWebhook(body = {}, headers = {}, branch_id = 'br1') {
  const cfg = getIntegrations(branch_id).channels?.casso || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  if (cleanText(cfg.webhookSecret)) {
    const token = headerVal(headers, 'secure-token') || headerVal(headers, 'x-casso-signature');
    if (token !== cleanText(cfg.webhookSecret)) { const e = new Error('Sai secure-token Casso'); e.status = 401; throw e; }
  }
  const list = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
  const results = [];
  for (const t of list) {
    const amount = parseInt(t?.amount) || 0;
    if (amount <= 0) continue; // chỉ xử lý tiền vào
    const acc = String(t?.subAccId || t?.bank_sub_acc_id || t?.accountNumber || '');
    if (cleanText(cfg.accountNumber) && acc && acc !== cleanText(cfg.accountNumber)) continue;
    results.push(processIncomingCredit('casso', {
      externalId: String(t?.id || t?.tid || t?.reference || ''),
      amount,
      content: t?.description || t?.content || '',
      accountNumber: acc,
      raw: t,
    }));
  }
  return { ok: true, processed: results.length, results };
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

export function handlePayosWebhook(body = {}, headers = {}, branch_id = 'br1') {
  const cfg = getIntegrations(branch_id).channels?.payos || {};
  if (!cfg.enabled) return { ok: true, status: 'disabled' };
  // payOS gửi ping xác thực khi đăng ký webhook (data rỗng) — cứ ACK 200.
  if (!body || !body.data || (typeof body.data === 'object' && !Object.keys(body.data).length)) return { ok: true, status: 'ack' };
  if (!cleanText(cfg.checksumKey)) { const e = new Error('payOS chua cau hinh Checksum Key'); e.status = 400; throw e; }
  if (!payosVerifySignature(body, cleanText(cfg.checksumKey))) { const e = new Error('Sai chu ky payOS'); e.status = 401; throw e; }
  const d = body.data || {};
  const success = body.success === true || String(body.code) === '00' || String(d.code) === '00';
  if (!success) return { ok: true, status: 'ignored', reason: 'not_successful' };
  return processIncomingCredit('payos', {
    externalId: String(d.reference || d.paymentLinkId || d.orderCode || ''),
    amount: d.amount,
    content: d.description || '',
    accountNumber: d.accountNumber || '',
    raw: body,
  });
}

// Tạo link thanh toán payOS (v2). Trả về { checkoutUrl, qrCode, paymentLinkId, ... }.
export async function createPayosPaymentLink(cfg = {}, { orderCode, amount, description, returnUrl, cancelUrl } = {}) {
  const base = (cleanText(cfg.apiBase, 220) || 'https://api-merchant.payos.vn').replace(/\/+$/, '');
  const ret = cleanText(returnUrl, 220) || cleanText(cfg.returnUrl, 220) || 'https://dan-d-pak.onrender.com/pay/success';
  const cancel = cleanText(cancelUrl, 220) || cleanText(cfg.cancelUrl, 220) || 'https://dan-d-pak.onrender.com/pay/cancel';
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

// Đối soát: danh sách giao dịch webhook gần đây (cho UI + audit).
export function listBankTransactions(branch_id = 'br1', { limit = 50 } = {}) {
  const rows = db.prepare(`SELECT id,provider,external_id,amount,content,reference,order_id,status,created_at
    FROM bank_transactions WHERE (branch_id=? OR branch_id IS NULL) ORDER BY created_at DESC LIMIT ?`)
    .all(branch_id, Math.max(1, Math.min(200, parseInt(limit) || 50)));
  return { transactions: rows };
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

function buildReceipt(order_id, payment_id, lines, paid, { cashier = '' } = {}) {
  const order = getOrder(order_id);
  const branch = db.prepare(`SELECT name FROM branches WHERE id=?`).get(order.branch_id);
  const printCfg = getPrintConfig(order.branch_id);
  const cfg = printCfg.einvoice || {};
  const billCfg = printCfg.bill || {};
  const change = Math.max(0, paid - order.total);
  return {
    payment_id, order_id, branch: branch?.name, table_code: order.table_code,
    items: order.items.filter(i => i.status !== 'cancelled'),
    subtotal: order.subtotal, discount: order.discount, total: order.total,
    tax: {
      price_includes_vat: cfg.priceIncludesVat !== '0',
      vat_rate: cfg.defaultVatRate || '8',
      standard_vat_rate: cfg.standardVatRate || '10',
      legal_basis: cfg.legalBasis || '',
      unit_policy: cfg.unitPolicy || 'required',
      seller_tax_code: cfg.taxCode || billCfg.taxCode || '',
      seller_company: cfg.company || billCfg.storeName || '',
      seller_address: cfg.address || billCfg.address || '',
      seller_phone: cfg.phone || billCfg.phone || '',
      seller_email: cfg.email || billCfg.email || '',
      invoice_series: cfg.series || 'C26TMB',
    },
    voucher_id: order.voucher_id, voucher_code: order.voucher_code,
    customer: (() => { try { return order.customer_json ? JSON.parse(order.customer_json) : null; } catch { return null; } })(),
    invoice_choice: order.invoice_choice || '',
    invoice_id: order.invoice_id || null,
    lines, paid, change, paid_at: order.paid_at, number: order.bill_no || order_id.slice(-6).toUpperCase(),
    bill_no: order.bill_no || order_id.slice(-6).toUpperCase(),
    cashier,
  };
}
