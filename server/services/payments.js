// Payment Core: multi-method payment lines, close bill, trigger inventory deduction.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getOrder, getTableState, resolveStaffCall } from './orders.js';
import { deductForOrder } from './inventory.js';
import { printReceipt } from './printing.js';
import { getOperationsConfig, getPrintConfig } from './settings.js';
import { getActiveShift } from './shifts.js';

const METHODS = ['cash', 'card', 'qr', 'voucher', 'bank_transfer', 'internet_banking', 'qrcode', 'momo', 'zalopay', 'visa', 'pos_card', 'online'];

// lines: [{method, amount, reference}]
export function payOrder(order_id, lines, { discount } = {}, branch_id = 'br1') {
  const order = getOrder(order_id);
  if (!order) throw new Error('Order không tồn tại');
  if (order.status !== 'open') throw new Error('Order đã đóng');

  if (typeof discount === 'number') {
    db.prepare(`UPDATE orders SET discount=?, total=MAX(0,subtotal-?) WHERE id=?`).run(discount, discount, order_id);
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
  const receipt = buildReceipt(order_id, pid, lines, paid);
  receipt.print_config = getPrintConfig(branch_id);
  printReceipt(receipt, branch_id);
  emit('payment:done', { order_id, receipt }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return receipt;
}

export function requestPayment(table_id, branch_id = 'br1') {
  db.prepare(`UPDATE tables SET status='paying' WHERE id=? AND status='busy'`).run(table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

function buildReceipt(order_id, payment_id, lines, paid) {
  const order = getOrder(order_id);
  const branch = db.prepare(`SELECT name FROM branches WHERE id=?`).get(order.branch_id);
  const change = Math.max(0, paid - order.total);
  return {
    payment_id, order_id, branch: branch?.name, table_code: order.table_code,
    items: order.items.filter(i => i.status !== 'cancelled'),
    subtotal: order.subtotal, discount: order.discount, total: order.total,
    voucher_id: order.voucher_id, voucher_code: order.voucher_code,
    lines, paid, change, paid_at: order.paid_at, number: order_id.slice(-6).toUpperCase(),
  };
}
