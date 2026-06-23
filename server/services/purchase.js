// Purchase (Mua hàng): supplier purchase orders that post into the existing
// inventory receiving flow when goods arrive. Supplier is a partner from the
// shared Contacts directory; công nợ NCC = total - amount_paid.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { getCustomer } from './customers.js';
import { receiveSku, receiveStock } from './inventory.js';
import { createEntry as createDrawerEntry } from './cashDrawer.js';

const STATUSES = ['draft', 'confirmed', 'received', 'cancelled'];

function intval(v) { return Math.round(Number(v) || 0); }
function qtyNum(v) { return Math.max(0, Number(v) || 0); }
function str(v, max = 400) { return String(v ?? '').trim().slice(0, max); }
function itemType(v) { return v === 'sku' ? 'sku' : 'inventory'; }

function nextCode(branch_id) {
  const d = new Date();
  const ymd = d.toISOString().slice(2, 10).replaceAll('-', '');
  const prefix = `PO-${ymd}-`;
  const last = db.prepare(`SELECT code FROM purchase_orders WHERE branch_id=? AND code LIKE ? ORDER BY code DESC LIMIT 1`)
    .get(branch_id, prefix + '%');
  const seq = last ? (parseInt(String(last.code).slice(prefix.length)) || 0) + 1 : 1;
  return prefix + String(seq).padStart(3, '0');
}

function lineOut(l) {
  return {
    ...l,
    qty: qtyNum(l.qty),
    unit_cost: Number(l.unit_cost) || 0,
    received_qty: qtyNum(l.received_qty),
    line_total: intval(l.line_total),
    outstanding_qty: Math.max(0, qtyNum(l.qty) - qtyNum(l.received_qty)),
  };
}

function decoratePO(po) {
  if (!po) return null;
  const lines = db.prepare(`SELECT * FROM purchase_order_lines WHERE po_id=? ORDER BY rowid`).all(po.id).map(lineOut);
  const payments = db.prepare(`SELECT * FROM purchase_payments WHERE po_id=? ORDER BY created_at`).all(po.id)
    .map(p => ({ ...p, amount: intval(p.amount) }));
  const total = intval(po.total);
  const amount_paid = intval(po.amount_paid);
  const received_value = lines.reduce((s, l) => s + Math.round(l.received_qty * l.unit_cost), 0);
  return {
    ...po,
    subtotal: intval(po.subtotal),
    total,
    amount_paid,
    amount_due: Math.max(0, total - amount_paid),
    received_value,
    fully_received: lines.length > 0 && lines.every(l => l.outstanding_qty <= 0.0000001),
    lines,
    payments,
  };
}

export function listPurchaseOrders(branch_id = 'br1', filters = {}) {
  const params = [branch_id];
  let where = 'branch_id=?';
  if (filters.status && STATUSES.includes(filters.status)) { where += ' AND status=?'; params.push(filters.status); }
  if (filters.supplier_id) { where += ' AND supplier_id=?'; params.push(String(filters.supplier_id)); }
  const rows = db.prepare(`SELECT * FROM purchase_orders WHERE ${where} ORDER BY created_at DESC LIMIT 300`).all(...params);
  const term = String(filters.q || '').trim().toLowerCase();
  const out = rows.map(decoratePO);
  const filtered = term
    ? out.filter(po => [po.code, po.supplier_name, po.note].some(v => String(v || '').toLowerCase().includes(term)))
    : out;
  return {
    orders: filtered,
    summary: supplierDebtSummary(branch_id),
  };
}

// Outstanding payable per supplier across all non-cancelled POs.
export function supplierDebtSummary(branch_id = 'br1') {
  const rows = db.prepare(`
    SELECT supplier_id, supplier_name,
      COALESCE(SUM(total),0) total, COALESCE(SUM(amount_paid),0) paid, COUNT(*) orders
    FROM purchase_orders
    WHERE branch_id=? AND status!='cancelled'
    GROUP BY supplier_id, supplier_name
    HAVING (total - paid) > 0
    ORDER BY (total - paid) DESC`).all(branch_id);
  const suppliers = rows.map(r => ({
    supplier_id: r.supplier_id,
    supplier_name: r.supplier_name,
    orders: r.orders,
    total: intval(r.total),
    paid: intval(r.paid),
    due: Math.max(0, intval(r.total) - intval(r.paid)),
  }));
  return { suppliers, total_due: suppliers.reduce((s, x) => s + x.due, 0) };
}

export function getPurchaseOrder(id, branch_id = 'br1') {
  return decoratePO(db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(id, branch_id));
}

function resolveSupplier(supplier_id, branch_id) {
  if (!supplier_id) return { id: null, name: '' };
  const p = getCustomer(supplier_id, branch_id);
  if (!p) throw new Error('Nhà cung cấp không tồn tại trong danh bạ Liên hệ');
  if (!p.is_supplier) throw new Error('Liên hệ này chưa được đánh dấu là Nhà cung cấp');
  return { id: p.id, name: p.company || p.name };
}

function buildLines(rawLines = []) {
  const lines = [];
  for (const r of rawLines) {
    const item_id = str(r.item_id, 80);
    const qty = qtyNum(r.qty);
    if (!item_id || qty <= 0) continue;
    const unit_cost = Number(r.unit_cost) || 0;
    lines.push({
      item_type: itemType(r.item_type),
      item_id,
      name: str(r.name, 200),
      unit: str(r.unit, 40),
      qty,
      unit_cost,
      line_total: Math.round(qty * unit_cost),
    });
  }
  return lines;
}

// Create or update a DRAFT purchase order. Confirmed/received POs are locked.
export function savePurchaseOrder(body = {}, branch_id = 'br1', user = {}) {
  const supplier = resolveSupplier(str(body.supplier_id, 80), branch_id);
  const supplierName = supplier.name || str(body.supplier_name_manual, 200) || 'Không có NCC';
  const lines = buildLines(body.lines);
  if (!lines.length) throw new Error('Cần ít nhất một dòng hàng');
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const fields = {
    supplier_id: supplier.id,
    supplier_name: supplierName,
    warehouse_id: str(body.warehouse_id, 80) || null,
    order_date: str(body.order_date, 30) || now(),
    expected_date: str(body.expected_date, 30) || null,
    note: str(body.note, 800),
    subtotal,
    total: subtotal,
  };

  const existing = body.id ? db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(body.id, branch_id) : null;
  if (existing) {
    if (existing.status !== 'draft') throw new Error('Chỉ sửa được đơn ở trạng thái nháp');
    db.prepare(`UPDATE purchase_orders SET supplier_id=?,supplier_name=?,warehouse_id=?,order_date=?,expected_date=?,note=?,subtotal=?,total=?,updated_at=? WHERE id=? AND branch_id=?`)
      .run(fields.supplier_id, fields.supplier_name, fields.warehouse_id, fields.order_date, fields.expected_date, fields.note, fields.subtotal, fields.total, now(), existing.id, branch_id);
    db.prepare(`DELETE FROM purchase_order_lines WHERE po_id=?`).run(existing.id);
    insertLines(existing.id, lines);
    audit('purchase.update', { id: existing.id, total: fields.total }, branch_id, user?.username || user?.name);
    emit('purchase:updated', { id: existing.id }, branch_id);
    return getPurchaseOrder(existing.id, branch_id);
  }

  const id = uid('po_');
  const code = nextCode(branch_id);
  db.prepare(`INSERT INTO purchase_orders (id,branch_id,code,supplier_id,supplier_name,warehouse_id,status,order_date,expected_date,note,subtotal,total,amount_paid,created_at,updated_at)
    VALUES (?,?,?,?,?,?, 'draft', ?,?,?,?,?,0,?,?)`)
    .run(id, branch_id, code, fields.supplier_id, fields.supplier_name, fields.warehouse_id, fields.order_date, fields.expected_date, fields.note, fields.subtotal, fields.total, now(), now());
  insertLines(id, lines);
  audit('purchase.create', { id, code, supplier: fields.supplier_name, total: fields.total }, branch_id, user?.username || user?.name);
  emit('purchase:updated', { id, created: true }, branch_id);
  return getPurchaseOrder(id, branch_id);
}

function insertLines(po_id, lines) {
  const ins = db.prepare(`INSERT INTO purchase_order_lines (id,po_id,item_type,item_id,name,unit,qty,unit_cost,received_qty,line_total)
    VALUES (?,?,?,?,?,?,?,?,0,?)`);
  for (const l of lines) ins.run(uid('pol_'), po_id, l.item_type, l.item_id, l.name, l.unit, l.qty, l.unit_cost, l.line_total);
}

export function confirmPurchaseOrder(id, branch_id = 'br1', user = {}) {
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!po) throw new Error('Đơn mua không tồn tại');
  if (po.status !== 'draft') throw new Error('Chỉ xác nhận được đơn ở trạng thái nháp');
  db.prepare(`UPDATE purchase_orders SET status='confirmed', updated_at=? WHERE id=?`).run(now(), id);
  audit('purchase.confirm', { id, code: po.code }, branch_id, user?.username || user?.name);
  emit('purchase:updated', { id }, branch_id);
  return getPurchaseOrder(id, branch_id);
}

// Receive goods (full or partial). Each received line flows through the existing
// inventory receiving functions → updates stock, lots and stock_movements.
export function receivePurchaseOrder(id, body = {}, branch_id = 'br1', user = {}) {
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!po) throw new Error('Đơn mua không tồn tại');
  if (!['confirmed', 'received'].includes(po.status)) throw new Error('Cần xác nhận đơn trước khi nhận hàng');
  const warehouse_id = str(body.warehouse_id, 80) || po.warehouse_id || null;
  if (!warehouse_id) throw new Error('Cần chọn kho nhận hàng');

  const lines = db.prepare(`SELECT * FROM purchase_order_lines WHERE po_id=?`).all(id);
  const byId = new Map(lines.map(l => [l.id, l]));
  // body.receipts: [{ line_id, qty, lot_no?, expiry_date? }]
  const receipts = Array.isArray(body.receipts) ? body.receipts : [];
  if (!receipts.length) throw new Error('Không có dòng hàng nào để nhận');

  const touched = [];
  for (const r of receipts) {
    const line = byId.get(str(r.line_id, 80));
    if (!line) continue;
    const outstanding = Math.max(0, qtyNum(line.qty) - qtyNum(line.received_qty));
    const recvQty = Math.min(outstanding, qtyNum(r.qty));
    if (recvQty <= 0) continue;
    const opts = {
      ref: po.code,
      supplier: po.supplier_name || null,
      unit_cost: Number(line.unit_cost) || 0,
      warehouse_id,
      lot_no: str(r.lot_no, 80) || undefined,
      expiry_date: str(r.expiry_date, 30) || undefined,
    };
    if (line.item_type === 'sku') receiveSku(line.item_id, recvQty, branch_id, opts);
    else receiveStock(line.item_id, recvQty, branch_id, opts);
    db.prepare(`UPDATE purchase_order_lines SET received_qty=received_qty+? WHERE id=?`).run(recvQty, line.id);
    touched.push({ line_id: line.id, name: line.name, qty: recvQty });
  }
  if (!touched.length) throw new Error('Số lượng nhận không hợp lệ (đã nhận đủ hoặc bằng 0)');

  const after = db.prepare(`SELECT qty, received_qty FROM purchase_order_lines WHERE po_id=?`).all(id);
  const fully = after.every(l => qtyNum(l.received_qty) + 0.0000001 >= qtyNum(l.qty));
  db.prepare(`UPDATE purchase_orders SET status=?, warehouse_id=?, updated_at=? WHERE id=?`)
    .run(fully ? 'received' : 'confirmed', warehouse_id, now(), id);
  audit('purchase.receive', { id, code: po.code, lines: touched, fully }, branch_id, user?.username || user?.name);
  emit('purchase:updated', { id }, branch_id);
  emit('inventory:updated', { source: 'purchase', po: id }, branch_id);
  return getPurchaseOrder(id, branch_id);
}

export function recordPurchasePayment(id, body = {}, branch_id = 'br1', user = {}) {
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!po) throw new Error('Đơn mua không tồn tại');
  if (po.status === 'cancelled') throw new Error('Đơn đã hủy, không ghi nhận thanh toán');
  const amount = intval(body.amount);
  if (amount <= 0) throw new Error('Số tiền thanh toán phải lớn hơn 0');
  const due = Math.max(0, intval(po.total) - intval(po.amount_paid));
  if (amount > due) throw new Error('Số tiền thanh toán lớn hơn công nợ còn lại');

  const source = body.source === 'drawer' ? 'drawer' : 'direct';
  let method = str(body.method, 30) || 'cash';
  let drawer_entry_id = null;
  if (source === 'drawer') {
    // Pay supplier from the open shift's cash drawer → one linked cash-out entry,
    // so the drawer balance stays correct and the cash-out is noted as "chi từ két".
    const entry = createDrawerEntry('expense', {
      amount,
      occurred_at: now(),
      counterparty: po.supplier_name || 'Nhà cung cấp',
      reason: `Trả NCC đơn ${po.code}`,
      product: 'Trả nhà cung cấp',
      note: str(body.note, 400),
      actor_name: user?.name || user?.username,
    }, user, branch_id);
    drawer_entry_id = entry.id;
    method = 'cash';
  }

  db.prepare(`INSERT INTO purchase_payments (id,branch_id,po_id,supplier_id,amount,method,note,actor_name,source,drawer_entry_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid('pp_'), branch_id, id, po.supplier_id, amount, method, str(body.note, 400), str(user?.name || user?.username, 120), source, drawer_entry_id, now());
  db.prepare(`UPDATE purchase_orders SET amount_paid=amount_paid+?, updated_at=? WHERE id=?`).run(amount, now(), id);
  audit('purchase.pay', { id, code: po.code, amount, method, source, drawer_entry_id }, branch_id, user?.username || user?.name);
  emit('purchase:updated', { id }, branch_id);
  if (drawer_entry_id) emit('shift:updated', { source: 'purchase' }, branch_id);
  return getPurchaseOrder(id, branch_id);
}

export function cancelPurchaseOrder(id, branch_id = 'br1', user = {}) {
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!po) throw new Error('Đơn mua không tồn tại');
  if (po.status === 'received') throw new Error('Đơn đã nhận hàng, không thể hủy');
  const received = db.prepare(`SELECT COALESCE(SUM(received_qty),0) q FROM purchase_order_lines WHERE po_id=?`).get(id)?.q || 0;
  if (received > 0) throw new Error('Đơn đã nhận một phần, không thể hủy');
  db.prepare(`UPDATE purchase_orders SET status='cancelled', updated_at=? WHERE id=?`).run(now(), id);
  audit('purchase.cancel', { id, code: po.code }, branch_id, user?.username || user?.name);
  emit('purchase:updated', { id }, branch_id);
  return getPurchaseOrder(id, branch_id);
}

export function deletePurchaseOrder(id, branch_id = 'br1', user = {}) {
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!po) throw new Error('Đơn mua không tồn tại');
  if (po.status !== 'draft') throw new Error('Chỉ xóa được đơn ở trạng thái nháp');
  db.prepare(`DELETE FROM purchase_order_lines WHERE po_id=?`).run(id);
  db.prepare(`DELETE FROM purchase_orders WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('purchase.delete', { id, code: po.code }, branch_id, user?.username || user?.name);
  emit('purchase:updated', { id, deleted: true }, branch_id);
  return { ok: true };
}
