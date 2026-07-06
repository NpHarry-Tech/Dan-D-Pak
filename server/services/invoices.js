// MISA e-invoice integration.
// Issues a VAT e-invoice for a paid bill. When the MISA integration is enabled
// with production credentials, it calls the REAL MISA meInvoice API (see misa.js)
// and stores the number/lookup code MISA returns. Otherwise it falls back to a
// local mock number of the same shape so the demo/sandbox keeps working.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getOrder } from './orders.js';
import { getIntegrations, getPrintConfig } from './settings.js';
import * as Misa from './misa.js';
import { archiveInvoice, archiveOrder } from './archive.js';

// Số HĐ (Thuế): số thứ tự liên tục 8 chữ số theo từng ký hiệu hóa đơn (vd 00000001).
// "Số Bill nội bộ" Dan{ddMMyy}{seq} nằm trên đơn (orders.bill_no), khác với số HĐ thuế.
function nextInvoiceNo(branch_id) {
  const n = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE branch_id=?`).get(branch_id).c + 1;
  return String(n).padStart(8, '0');
}

// Mã của cơ quan thuế (dạng GUID) — chỉ là mã tra cứu nội bộ khi chạy mock.
function taxAuthorityCode() {
  const hex = () => Math.floor(Math.random() * 16).toString(16).toUpperCase();
  const block = (n) => Array.from({ length: n }, hex).join('');
  return `${block(8)}-${block(4)}-${block(4)}-${block(4)}-${block(12)}`;
}

// customer: { name, tax_code, address, email }
export async function issue(order_id, customer = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn không tồn tại');
  if (order.status !== 'paid') throw new Error('Chỉ xuất hóa đơn cho bill đã thanh toán');
  const existing = db.prepare(`SELECT * FROM invoices WHERE order_id=? AND status!='cancelled'`).get(order_id);
  if (existing) throw new Error('Bill này đã có hóa đơn ' + existing.invoice_no);

  // Try the real MISA meInvoice API when it's enabled in production with credentials.
  const misaCfg = getIntegrations(branch_id).channels?.misa || {};
  let provider = 'local', remote = null;
  if (Misa.isLive(misaCfg)) {
    try {
      remote = await Misa.issueInvoice(order, customer, order.items || [], misaCfg);
      provider = 'misa';
    } catch (e) {
      // Surface the real MISA error instead of silently faking a number.
      throw new Error('MISA: ' + e.message);
    }
  }

  const id = uid('inv_');
  const invoice_no = remote?.invoice_no || nextInvoiceNo(branch_id);
  const lookup_code = remote?.lookup_code || taxAuthorityCode();
  db.prepare(`INSERT INTO invoices (id,branch_id,order_id,invoice_no,lookup_code,status,customer_json,total,issued_at)
    VALUES (?,?,?,?,?,'issued',?,?,?)`).run(id, branch_id, order_id, invoice_no, lookup_code,
    JSON.stringify({ ...customer, _provider: provider }), order.total, now());
  db.prepare(`UPDATE orders SET invoice_id=? WHERE id=?`).run(id, order_id);
  audit('invoice.issue', { order: order_id, invoice_no, provider }, branch_id);
  const inv = { ...get(id), provider, lookup_url: remote?.lookup_url || get(id).lookup_url };
  archiveInvoice(inv);
  archiveOrder(getOrder(order_id));
  emit('invoice:issued', inv, branch_id);
  return inv;
}

// Khách tự phục vụ chọn xuất hóa đơn VAT hoặc bán cho người tiêu dùng sau thanh toán QR (iPad).
// decision: 'issue' → phát hành hóa đơn theo thông tin khách nhập (MST/SĐT/email);
//           'decline' → bán cho người tiêu dùng. Cả hai đều lưu orders.invoice_choice + ghi nhật ký để báo cáo.
export async function customerRequest(order_id, { decision = 'issue', customer = {} } = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn không tồn tại');
  if (order.status !== 'paid') throw new Error('Chỉ xuất hóa đơn cho bill đã thanh toán');

  if (decision === 'decline') {
    db.prepare(`UPDATE orders SET invoice_choice='declined' WHERE id=?`).run(order_id);
    audit('invoice.customer_declined', { order: order_id, bill_no: order.bill_no || null }, branch_id);
    archiveOrder(getOrder(order_id));
    emit('invoice:choice', { order_id, choice: 'declined' }, branch_id);
    return { ok: true, choice: 'declined' };
  }

  const phone = String(customer.phone || '').trim();
  const email = String(customer.email || '').trim();
  if (!phone || !email) throw new Error('Vui lòng nhập số điện thoại và email để nhận hóa đơn');
  const inv = await issue(order_id, {
    name: customer.name || customer.company || '',
    company: customer.company || customer.name || '',
    tax_code: String(customer.tax_code || '').replace(/\s+/g, ''),
    address: customer.address || '',
    phone,
    email,
    _source: 'customer_self_service',
  }, branch_id);
  db.prepare(`UPDATE orders SET invoice_choice='issued' WHERE id=?`).run(order_id);
  emit('invoice:choice', { order_id, choice: 'issued', invoice_no: inv.invoice_no }, branch_id);
  return { ok: true, choice: 'issued', invoice: inv };
}

export function get(id) {
  const i = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id);
  if (!i) return null;
  const ein = getPrintConfig(i.branch_id).einvoice || {};
  return { ...i, customer: JSON.parse(i.customer_json || '{}'),
    symbol: ein.series || '', tax_code_seller: ein.taxCode || '',
    lookup_url: `https://tracuu.example.vn/?code=${i.lookup_code}` };
}

export function byOrder(order_id) {
  const i = db.prepare(`SELECT id FROM invoices WHERE order_id=? AND status!='cancelled' ORDER BY issued_at DESC LIMIT 1`).get(order_id);
  return i ? get(i.id) : null;
}

export function list(branch_id = 'br1', limit = 50) {
  return db.prepare(`SELECT i.*, o.table_id FROM invoices i JOIN orders o ON o.id=i.order_id
    WHERE i.branch_id=? ORDER BY i.issued_at DESC LIMIT ?`).all(branch_id, limit)
    .map(i => ({ ...i, customer: JSON.parse(i.customer_json || '{}') }));
}

// Adjustment/replacement per regulation: do not delete, mark cancelled + audit.
export function cancel(id, reason, branch_id = 'br1') {
  const inv = get(id);
  if (!inv) throw new Error('Hóa đơn không tồn tại');
  db.prepare(`UPDATE invoices SET status='cancelled' WHERE id=?`).run(id);
  db.prepare(`UPDATE orders SET invoice_id=NULL WHERE id=?`).run(inv.order_id);
  audit('invoice.cancel', { invoice_no: inv.invoice_no, reason }, branch_id);
  archiveInvoice({ ...inv, status: 'cancelled', cancel_reason: reason, cancelled_at: now() });
  archiveOrder(getOrder(inv.order_id));
  emit('invoice:cancelled', { id }, branch_id);
  return { ok: true };
}
