// Order lifecycle: create/append items, route to KDS stations, and drive
// kitchen ticket status transitions.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { printKitchenTickets, printRunnerSlip, printCupLabels } from './printing.js';
import { getMenuItemForOrder } from './catalog.js';

export function getOpenOrderForTable(table_id, branch_id = 'br1') {
  if (!table_id) return undefined;
  return db.prepare(`SELECT * FROM orders WHERE table_id=? AND branch_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`)
    .get(table_id, branch_id);
}

function recomputeTotals(order_id) {
  const items = db.prepare(`SELECT qty,unit_price FROM order_items WHERE order_id=? AND status!='cancelled'`).all(order_id);
  const subtotal = items.reduce((s, it) => s + it.qty * it.unit_price, 0);
  const order = db.prepare(`SELECT discount FROM orders WHERE id=?`).get(order_id);
  const discount = order?.discount || 0;
  const total = Math.max(0, subtotal - discount);
  db.prepare(`UPDATE orders SET subtotal=?, total=? WHERE id=?`).run(subtotal, total, order_id);
  return { subtotal, discount, total };
}

function setTableByOpenOrders(table_id, branch_id = 'br1') {
  if (!table_id) return;
  const open = getOpenOrderForTable(table_id, branch_id);
  db.prepare(`UPDATE tables SET status=? WHERE id=?`).run(open ? 'busy' : 'free', table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

// items: [{menu_item_id, qty, note, mods:[{group,name,price}]}] or [{sku_id, qty}]
export function createOrUpdateOrder({ branch_id = 'br1', table_id, channel = 'dine_in', source = 'staff_pos', require_confirm = false, items }) {
  if (!items?.length) throw new Error('Order trống');
  const needsStaffConfirm = source === 'customer_ipad' || require_confirm === true;

  let order = table_id ? getOpenOrderForTable(table_id, branch_id) : null;
  const isNew = !order;
  if (isNew) {
    const id = uid('o_');
    db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,created_at) VALUES (?,?,?,?,'open',?)`)
      .run(id, branch_id, table_id || null, channel, now());
    order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
  }

  const insItem = db.prepare(`INSERT INTO order_items
    (id,order_id,menu_item_id,sku_id,name,emoji,qty,unit_price,station,sla_minutes,note,mods_json,status,lot_id,promo_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const created = [];
  for (const line of items) {
    const qty = Math.max(1, parseInt(line.qty) || 1);
    const id = uid('oi_');
    if (line.sku_id) {
      const sku = db.prepare(`SELECT * FROM skus WHERE id=? AND active=1`).get(line.sku_id);
      if (!sku) throw new Error('SKU không tồn tại: ' + line.sku_id);
      if (sku.stock < qty) throw new Error(`Hết hàng: ${sku.name} (còn ${sku.stock})`);
      const lotId = line.lot_id || null;
      validateSkuLot(sku, qty, lotId, branch_id);
      insItem.run(id, order.id, null, sku.id, sku.name, sku.emoji, qty, sku.price, 'retail', 0, null, '[]',
        needsStaffConfirm ? 'pending_confirm' : 'served', lotId, line.promo ? JSON.stringify(line.promo) : null, now());
    } else {
      const mi = getMenuItemForOrder(line.menu_item_id);
      const mods = Array.isArray(line.mods) ? line.mods : [];
      const modSum = mods.reduce((s, m) => s + (m.price || 0), 0);
      insItem.run(id, order.id, mi.id, null, mi.name, mi.emoji, qty, mi.price + modSum, mi.station, mi.sla_minutes,
        line.note || null, JSON.stringify(mods), needsStaffConfirm ? 'pending_confirm' : 'new', null, null, now());
    }
    created.push(db.prepare(`SELECT * FROM order_items WHERE id=?`).get(id));
  }

  recomputeTotals(order.id);
  if (table_id) {
    db.prepare(`UPDATE tables SET status='busy' WHERE id=?`).run(table_id);
    emit('table:updated', getTableState(table_id), branch_id);
  }
  audit(needsStaffConfirm ? 'order.pending' : 'order.send', { order: order.id, items: created.length, source }, branch_id);

  const full = getOrder(order.id);
  const printable = created.filter(i => i.status === 'new' && i.station !== 'retail');
  if (printable.length) printKitchenTickets(full, printable, branch_id);
  printCupLabels(full, created, branch_id);
  emit('order:new', { order: full, newItems: created, isNew, pendingConfirm: needsStaffConfirm }, branch_id);
  if (needsStaffConfirm) emit('order:pending', { order: full, newItems: created }, branch_id);
  if (printable.length) emit('kds:refresh', { station: 'all' }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return full;
}

export function getOrder(order_id) {
  if (!order_id) return null;
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(order_id);
  if (!order) return null;
  order.items = db.prepare(`SELECT * FROM order_items WHERE order_id=? ORDER BY created_at`).all(order_id)
    .map(it => ({ ...it, mods: parseJson(it.mods_json, []), promo: parseJson(it.promo_json, null) }));
  if (order.table_id) {
    const t = db.prepare(`SELECT code,zone FROM tables WHERE id=?`).get(order.table_id);
    order.table_code = t?.code;
    order.zone = t?.zone;
  }
  return order;
}

export function listPendingConfirmations(branch_id = 'br1') {
  const rows = db.prepare(`
    SELECT oi.*, o.created_at AS order_created, o.table_id, o.channel, t.code AS table_code, t.zone AS zone
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.branch_id=? AND o.status='open' AND oi.status='pending_confirm'
    ORDER BY oi.created_at`).all(branch_id)
    .map(r => ({ ...r, mods: parseJson(r.mods_json, []), promo: parseJson(r.promo_json, null) }));
  const groups = new Map();
  for (const it of rows) {
    if (!groups.has(it.order_id)) {
      groups.set(it.order_id, {
        order_id: it.order_id,
        table_id: it.table_id,
        table_code: it.table_code || '—',
        zone: it.zone || '',
        channel: it.channel,
        order_created: it.order_created,
        created_at: it.created_at,
        items: [],
      });
    }
    const g = groups.get(it.order_id);
    g.items.push(it);
    if (new Date(it.created_at) < new Date(g.created_at)) g.created_at = it.created_at;
  }
  return [...groups.values()].map(g => ({
    ...g,
    item_count: g.items.reduce((s, i) => s + (Number(i.qty) || 0), 0),
    line_count: g.items.length,
    total: g.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0),
  }));
}

export function confirmPendingItems(order_id, item_ids = [], branch_id = 'br1') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status='open'`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const ids = new Set(Array.isArray(item_ids) && item_ids.length ? item_ids : []);
  const pending = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status='pending_confirm' ORDER BY created_at`).all(order_id)
    .filter(i => !ids.size || ids.has(i.id));
  if (!pending.length) throw new Error('Không có món chờ xác nhận');
  const upd = db.prepare(`UPDATE order_items SET status=? WHERE id=?`);
  for (const it of pending) upd.run(it.station === 'retail' ? 'served' : 'new', it.id);
  audit('order.confirm', { order: order_id, items: pending.length }, branch_id);
  const full = getOrder(order_id);
  const confirmed = db.prepare(`SELECT * FROM order_items WHERE id IN (${pending.map(() => '?').join(',')}) ORDER BY created_at`).all(...pending.map(i => i.id));
  const kitchenItems = confirmed.filter(i => i.status === 'new' && i.station !== 'retail');
  if (kitchenItems.length) printKitchenTickets(full, kitchenItems, branch_id);
  printCupLabels(full, confirmed, branch_id);
  emit('order:updated', full, branch_id);
  emit('order:pending', { order: full, confirmed: pending.map(i => i.id) }, branch_id);
  if (kitchenItems.length) {
    emit('order:new', { order: full, newItems: kitchenItems, isNew: false, confirmed: true }, branch_id);
    emit('kds:refresh', { station: 'all' }, branch_id);
  }
  emit('stats:dirty', {}, branch_id);
  return full;
}

export function rejectPendingItems(order_id, item_ids = [], reason = '', branch_id = 'br1') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status='open'`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('Cần nhập lý do từ chối');
  const ids = new Set(Array.isArray(item_ids) && item_ids.length ? item_ids : []);
  const pending = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status='pending_confirm' ORDER BY created_at`).all(order_id)
    .filter(i => !ids.size || ids.has(i.id));
  if (!pending.length) throw new Error('Không có món chờ xác nhận');
  const upd = db.prepare(`UPDATE order_items SET status='cancelled', reject_reason=? WHERE id=?`);
  for (const it of pending) upd.run(cleanReason, it.id);
  recomputeTotals(order_id);
  const activeLeft = db.prepare(`SELECT COUNT(*) n FROM order_items WHERE order_id=? AND status!='cancelled'`).get(order_id).n;
  if (!activeLeft) {
    db.prepare(`UPDATE orders SET status='void', subtotal=0, total=0 WHERE id=?`).run(order_id);
    if (order.table_id) setTableByOpenOrders(order.table_id, branch_id);
  }
  const full = getOrder(order_id);
  audit('order.reject', { order: order_id, items: pending.length, reason: cleanReason }, branch_id);
  emit('order:updated', full, branch_id);
  emit('order:pending', { order: full, rejected: pending.map(i => i.id), reason: cleanReason }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return full;
}

export function moveTable(from_table_id, to_table_id, branch_id = 'br1') {
  if (from_table_id === to_table_id) throw new Error('Bàn chuyển phải khác bàn hiện tại');
  const order = getOpenOrderForTable(from_table_id, branch_id);
  if (!order) throw new Error('Bàn hiện tại chưa có bill để chuyển');
  const targetOrder = getOpenOrderForTable(to_table_id, branch_id);
  if (targetOrder) throw new Error('Bàn đích đang có bill. Hãy dùng Gộp bàn.');
  const source = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(from_table_id, branch_id);
  const target = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(to_table_id, branch_id);
  if (!source) throw new Error('Bàn nguồn không tồn tại');
  if (!target) throw new Error('Bàn đích không tồn tại');
  db.prepare(`UPDATE orders SET table_id=? WHERE id=?`).run(to_table_id, order.id);
  setTableByOpenOrders(from_table_id, branch_id);
  setTableByOpenOrders(to_table_id, branch_id);
  audit('table.move', { order: order.id, from: from_table_id, to: to_table_id, from_code: source.code, to_code: target.code }, branch_id);
  emit('order:updated', getOrder(order.id), branch_id);
  return getOrder(order.id);
}

export function mergeTables(source_table_id, target_table_id, branch_id = 'br1') {
  if (source_table_id === target_table_id) throw new Error('Không thể gộp cùng một bàn');
  const source = getOpenOrderForTable(source_table_id, branch_id);
  if (!source) throw new Error('Bàn nguồn chưa có bill');
  let target = getOpenOrderForTable(target_table_id, branch_id);
  const sourceTable = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(source_table_id, branch_id);
  const targetTable = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(target_table_id, branch_id);
  if (!sourceTable) throw new Error('Bàn nguồn không tồn tại');
  if (!targetTable) throw new Error('Bàn đích không tồn tại');
  if (!target) return moveTable(source_table_id, target_table_id, branch_id);
  db.prepare(`UPDATE order_items SET order_id=? WHERE order_id=? AND status!='cancelled'`).run(target.id, source.id);
  db.prepare(`UPDATE orders SET status='void', subtotal=0,total=0 WHERE id=?`).run(source.id);
  recomputeTotals(target.id);
  setTableByOpenOrders(source_table_id, branch_id);
  setTableByOpenOrders(target_table_id, branch_id);
  audit('table.merge', {
    source_order: source.id,
    target_order: target.id,
    from: source_table_id,
    to: target_table_id,
    from_code: sourceTable.code,
    to_code: targetTable.code,
  }, branch_id);
  emit('order:updated', getOrder(target.id), branch_id);
  return getOrder(target.id);
}

export function splitOrderItems(order_id, item_ids = [], branch_id = 'br1') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status='open'`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const ids = [...new Set(Array.isArray(item_ids) ? item_ids : [])];
  if (!ids.length) throw new Error('Chọn ít nhất một dòng để tách bill');
  const active = db.prepare(`SELECT id FROM order_items WHERE order_id=? AND status!='cancelled'`).all(order_id).map(r => r.id);
  const selected = ids.filter(id => active.includes(id));
  if (!selected.length) throw new Error('Không tìm thấy dòng hợp lệ để tách');
  if (selected.length >= active.length) throw new Error('Không cần tách nếu chọn toàn bộ bill');
  const newId = uid('o_');
  db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,created_at) VALUES (?,?,?,?,'open',?)`)
    .run(newId, branch_id, order.table_id || null, order.channel || 'dine_in', now());
  const upd = db.prepare(`UPDATE order_items SET order_id=? WHERE id=? AND order_id=?`);
  for (const id of selected) upd.run(newId, id, order_id);
  recomputeTotals(order_id);
  recomputeTotals(newId);
  if (order.table_id) setTableByOpenOrders(order.table_id, branch_id);
  const table = order.table_id ? db.prepare(`SELECT code FROM tables WHERE id=?`).get(order.table_id) : null;
  audit('bill.split', { source_order: order_id, split_order: newId, table: order.table_id, table_code: table?.code, items: selected.length }, branch_id);
  emit('order:updated', getOrder(order_id), branch_id);
  emit('order:updated', getOrder(newId), branch_id);
  return { source: getOrder(order_id), split: getOrder(newId) };
}

function validateSkuLot(sku, qty, lot_id, branch_id) {
  if (!lot_id) return;
  const lot = db.prepare(`SELECT * FROM stock_lots WHERE id=? AND branch_id=? AND item_type='sku' AND item_id=?`)
    .get(lot_id, branch_id, sku.id);
  if (!lot) throw new Error('Lot không tồn tại cho ' + sku.name);
  if (lot.qty_on_hand + 0.000001 < qty) {
    throw new Error(`Lot ${lot.lot_no} của ${sku.name} không đủ tồn (còn ${lot.qty_on_hand})`);
  }
}

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export function getTableState(table_id) {
  if (!table_id) return null;
  const t = db.prepare(`SELECT * FROM tables WHERE id=?`).get(table_id);
  if (!t) return null;
  const order = getOpenOrderForTable(table_id, t.branch_id);
  const call = db.prepare(`SELECT * FROM staff_calls WHERE table_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`).get(table_id);
  return {
    ...t,
    amount: order?.total || 0,
    order_id: order?.id || null,
    call: call?.reason || null,
    status: call ? 'calling' : t.status,
  };
}

export function listTables(branch_id = 'br1') {
  return db.prepare(`SELECT id FROM tables WHERE branch_id=? ORDER BY code`).all(branch_id)
    .map(r => getTableState(r.id));
}

export function getStationTickets(station, branch_id = 'br1') {
  const where = station === 'all' ? "AND oi.station!='retail'" : 'AND oi.station=?';
  const params = station === 'all' ? [branch_id] : [branch_id, station];
  const rows = db.prepare(`
    SELECT oi.*, o.created_at AS order_created, t.code AS table_code
    FROM order_items oi
    JOIN orders o ON o.id=oi.order_id
    LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.branch_id=? AND oi.status IN ('new','accepted','preparing','ready') ${where}
    ORDER BY oi.created_at`).all(...params);
  return rows.map(r => ({ ...r, mods: JSON.parse(r.mods_json || '[]') }));
}

export function setItemStatus(item_id, status, branch_id = 'br1') {
  const valid = ['new', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];
  if (!valid.includes(status)) throw new Error('Trạng thái không hợp lệ');
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
  if (!item) throw new Error('Item không tồn tại');
  const ts = now();
  const set = { accepted: 'accepted_at', ready: 'ready_at', served: 'served_at' }[status];
  if (set) db.prepare(`UPDATE order_items SET status=?, ${set}=? WHERE id=?`).run(status, ts, item_id);
  else db.prepare(`UPDATE order_items SET status=? WHERE id=?`).run(status, item_id);

  audit('item.status', { item: item_id, status }, branch_id);
  const order = getOrder(item.order_id);
  // When a dish becomes ready, auto-print a per-dish runner slip (with table no.).
  if (status === 'ready') printRunnerSlip(item, order, branch_id);
  emit('order:item', { order_id: item.order_id, item_id, status, order }, branch_id);
  emit('kds:refresh', { station: item.station }, branch_id);
  return db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
}

export function cancelItem(item_id, reason, branch_id = 'br1') {
  setItemStatus(item_id, 'cancelled', branch_id);
  const item = db.prepare(`SELECT order_id FROM order_items WHERE id=?`).get(item_id);
  recomputeTotals(item.order_id);
  audit('item.cancel', { item: item_id, reason }, branch_id);
  emit('order:updated', getOrder(item.order_id), branch_id);
  return getOrder(item.order_id);
}

export function createStaffCall(table_id, reason, branch_id = 'br1') {
  const id = uid('sc_');
  db.prepare(`INSERT INTO staff_calls (id,branch_id,table_id,reason,status,created_at) VALUES (?,?,?,?,'open',?)`)
    .run(id, branch_id, table_id, reason, now());
  audit('staff.call', { table: table_id, reason }, branch_id);
  emit('staff:call', { id, table_id, reason }, branch_id);
  emit('table:updated', getTableState(table_id), branch_id);
  return { id };
}

export function resolveStaffCall(table_id, branch_id = 'br1') {
  db.prepare(`UPDATE staff_calls SET status='done' WHERE table_id=? AND status='open'`).run(table_id);
  emit('table:updated', getTableState(table_id), branch_id);
}

export function listStaffCalls(branch_id = 'br1') {
  return db.prepare(`SELECT sc.*, t.code AS table_code FROM staff_calls sc
    JOIN tables t ON t.id=sc.table_id WHERE sc.branch_id=? AND sc.status='open' ORDER BY sc.created_at`).all(branch_id);
}
