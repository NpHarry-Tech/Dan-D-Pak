// MISA e-invoice integration (mock issuance — same shape as a real MISA call).
// Issues a VAT e-invoice for a paid bill, returns invoice number + lookup code.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getOrder } from './orders.js';

function nextInvoiceNo(branch_id) {
  const n = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE branch_id=?`).get(branch_id).c + 1;
  const yy = new Date().getFullYear().toString().slice(-2);
  return `C${yy}MAA-${String(n).padStart(7, '0')}`;
}

// customer: { name, tax_code, address, email }
export function issue(order_id, customer = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Đơn không tồn tại');
  if (order.status !== 'paid') throw new Error('Chỉ xuất hóa đơn cho bill đã thanh toán');
  const existing = db.prepare(`SELECT * FROM invoices WHERE order_id=? AND status!='cancelled'`).get(order_id);
  if (existing) throw new Error('Bill này đã có hóa đơn ' + existing.invoice_no);

  const id = uid('inv_');
  const invoice_no = nextInvoiceNo(branch_id);
  const lookup_code = (uid('') + uid('')).replace(/[^a-z0-9]/g, '').slice(0, 12).toUpperCase();
  db.prepare(`INSERT INTO invoices (id,branch_id,order_id,invoice_no,lookup_code,status,customer_json,total,issued_at)
    VALUES (?,?,?,?,?,'issued',?,?,?)`).run(id, branch_id, order_id, invoice_no, lookup_code,
    JSON.stringify(customer), order.total, now());
  db.prepare(`UPDATE orders SET invoice_id=? WHERE id=?`).run(id, order_id);
  audit('invoice.issue', { order: order_id, invoice_no }, branch_id);
  const inv = get(id);
  emit('invoice:issued', inv, branch_id);
  return inv;
}

export function get(id) {
  const i = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id);
  if (!i) return null;
  return { ...i, customer: JSON.parse(i.customer_json || '{}'),
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
  emit('invoice:cancelled', { id }, branch_id);
  return { ok: true };
}
