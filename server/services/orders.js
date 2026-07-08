// Order lifecycle: create/append items, route to KDS stations, and drive
// kitchen ticket status transitions.
import { db, uid, now, audit } from '../db.js';
import { emit } from '../realtime.js';
import { printKitchenTickets, printRunnerSlip, printCupLabels } from './printing.js';
import { getMenuItemForOrder } from './catalog.js';
import { getOperationsConfig } from './settings.js';
import { getActiveShift } from './shifts.js';
import { archiveOrder } from './archive.js';

// Số Bill nội bộ: Dan{ddMMyy}{seq} — seq là số thứ tự đơn trong NGÀY (reset mỗi
// ngày vận hành: ca sáng → ca tối đều trong 1 ngày dương lịch). VD Dan210626001.
function todayDdMMyy() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return pad(d.getDate()) + pad(d.getMonth() + 1) + String(d.getFullYear()).slice(-2);
}
function billNoForSeq(seq) {
  return `Dan${todayDdMMyy()}${String(seq).padStart(3, '0')}`;
}
// seq kế tiếp = MAX(seq đã có TRONG NGÀY) + 1. Tách đúng phần seq SAU tiền tố ngày
// (Dan{ddMMyy}) — KHÔNG dùng \d+$ vì sẽ nuốt luôn 6 chữ số ngày. Dùng MAX (không COUNT)
// để chịu được khoảng trống do xóa, và để retry-chống-trùng tăng dần khi đụng UNIQUE.
function nextBillSeq(branch_id = 'br1') {
  const ddMMyy = todayDdMMyy();
  const d = new Date();
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(24, 0, 0, 0);
  const rows = db.prepare(`SELECT bill_no FROM orders WHERE branch_id=? AND bill_no LIKE ? AND created_at>=? AND created_at<?`)
    .all(branch_id, `Dan${ddMMyy}%`, start.toISOString(), end.toISOString());
  const re = new RegExp(`^Dan${ddMMyy}(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.bill_no || '');
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return max + 1;
}
// Tạo 1 order mở với bill_no duy nhất. Chịu được race/đa-server: nếu chỉ mục UNIQUE
// (branch_id,bill_no) bị đụng (server khác vừa chèn cùng seq), tăng seq và thử lại.
function insertOpenOrder({ branch_id = 'br1', table_id = null, channel = 'dine_in' }) {
  const id = uid('o_');
  let seq = nextBillSeq(branch_id);
  const ins = db.prepare(`INSERT INTO orders (id,branch_id,table_id,channel,status,bill_no,created_at) VALUES (?,?,?,?,'open',?,?)`);
  for (let attempt = 0; ; attempt++) {
    try {
      ins.run(id, branch_id, table_id, channel, billNoForSeq(seq), now());
      break;
    } catch (e) {
      if (attempt < 10 && /unique|constraint/i.test(String(e?.message))) { seq++; continue; }
      throw e;
    }
  }
  return db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
}

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

function requireOpenShiftForSales(branch_id = 'br1') {
  const ops = getOperationsConfig(branch_id);
  if (ops.shifts?.requireOpenShift !== false && !getActiveShift(branch_id)) {
    throw new Error('Cần mở ca làm việc trước khi bán hàng.');
  }
}

// items: [{menu_item_id, qty, note, mods:[{group,name,price}]}] or [{sku_id, qty}]
export function createOrUpdateOrder(options) {
  const { branch_id = 'br1', table_id, channel = 'dine_in', source = 'staff_pos', require_confirm = false, items, actor = 'system', skipTransaction = false, linked_pos_device, linked_printer_id } = options;
  if (!items?.length) throw new Error('Order trống');
  requireOpenShiftForSales(branch_id);

  let inTx = false;
  if (!skipTransaction) {
    db.prepare('BEGIN IMMEDIATE').run();
    inTx = true;
  }

  try {
    const needsStaffConfirm = source === 'customer_ipad' || require_confirm === true || (source === 'staff_pos' && !!table_id);

    let order = table_id ? getOpenOrderForTable(table_id, branch_id) : null;
    const isNew = !order;
    if (isNew) {
      order = insertOpenOrder({ branch_id, table_id: table_id || null, channel });
    }

    if (linked_pos_device || linked_printer_id) {
      db.prepare(`UPDATE orders SET linked_pos_device = ?, linked_printer_id = ? WHERE id = ?`)
        .run(linked_pos_device || null, linked_printer_id || null, order.id);
      order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(order.id);
    }

    const insItem = db.prepare(`INSERT INTO order_items
      (id,order_id,menu_item_id,sku_id,name,emoji,qty,unit_price,station,sla_minutes,note,mods_json,status,lot_id,promo_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const created = [];
    for (const line of items) {
      const qty = Math.max(1, parseInt(line.qty) || 1);
      const id = uid('oi_');
      if (line.sku_id) {
        const sku = db.prepare(`SELECT * FROM skus WHERE id=? AND branch_id=? AND active=1`).get(line.sku_id, branch_id);
        if (!sku) throw new Error('SKU không tồn tại: ' + line.sku_id);
        if (sku.stock < qty) throw new Error(`Hết hàng: ${sku.name} (còn ${sku.stock})`);
        const lotId = line.lot_id || null;
        validateSkuLot(sku, qty, lotId, branch_id);
        insItem.run(id, order.id, null, sku.id, sku.name, sku.emoji, qty, sku.price, 'retail', 0, null, '[]',
          needsStaffConfirm ? 'pending_confirm' : 'served', lotId, line.promo ? JSON.stringify(line.promo) : null, now());
      } else {
        const mi = getMenuItemForOrder(line.menu_item_id);
        const mods = Array.isArray(line.mods) ? line.mods : [];
        // BẢO MẬT: giá modifier do client gửi — chỉ cho phép CỘNG THÊM (>=0), không
        // bao giờ trừ. Nếu không, khách tự gửi mod giá âm để hạ đơn giá về 0/âm.
        const modSum = mods.reduce((s, m) => s + Math.max(0, parseInt(m?.price) || 0), 0);
        const unitPrice = Math.max(0, (parseInt(mi.price) || 0) + modSum);
        insItem.run(id, order.id, mi.id, null, mi.name, mi.emoji, qty, unitPrice, mi.station, mi.sla_minutes,
          line.note || null, JSON.stringify(mods), needsStaffConfirm ? 'pending_confirm' : 'new', null, null, now());
      }
      created.push(db.prepare(`SELECT * FROM order_items WHERE id=?`).get(id));
    }

    recomputeTotals(order.id);
    if (table_id) {
      db.prepare(`UPDATE tables SET status='busy' WHERE id=?`).run(table_id);
      emit('table:updated', getTableState(table_id), branch_id);
    }
    audit(needsStaffConfirm ? 'order.pending' : 'order.send', { order: order.id, items: created.length, source }, branch_id, actor);

    const full = getOrder(order.id);
    archiveOrder(full);
    const printable = created.filter(i => i.status === 'new' && i.station !== 'retail');
    if (printable.length) printKitchenTickets(full, printable, branch_id, actor);
    printCupLabels(full, created, branch_id);
    emit('order:new', { order: full, newItems: created, isNew, pendingConfirm: needsStaffConfirm }, branch_id);
    if (needsStaffConfirm) emit('order:pending', { order: full, newItems: created }, branch_id);
    if (printable.length) emit('kds:refresh', { station: 'all' }, branch_id);
    emit('stats:dirty', {}, branch_id);

    if (inTx) {
      db.prepare('COMMIT').run();
    }
    return full;
  } catch (err) {
    if (inTx) {
      db.prepare('ROLLBACK').run();
    }
    throw err;
  }
}

export function getOrder(order_id) {
  if (!order_id) return null;
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(order_id);
  if (!order) return null;
  order.items = db.prepare(`SELECT * FROM order_items WHERE order_id=? ORDER BY created_at`).all(order_id)
    .map(it => {
      let image = null;
      if (it.menu_item_id) {
        const mi = db.prepare(`SELECT image FROM menu_items WHERE id=?`).get(it.menu_item_id);
        image = mi?.image || null;
      } else if (it.sku_id) {
        const sku = db.prepare(`SELECT image FROM skus WHERE id=?`).get(it.sku_id);
        image = sku?.image || null;
      }
      return {
        ...it,
        image,
        mods: parseJson(it.mods_json, []),
        promo: parseJson(it.promo_json, null)
      };
    });
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

export function confirmPendingItems(order_id, item_ids = [], branch_id = 'br1', actor = 'system') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status='open'`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const ids = new Set(Array.isArray(item_ids) && item_ids.length ? item_ids : []);
  const pending = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status='pending_confirm' ORDER BY created_at`).all(order_id)
    .filter(i => !ids.size || ids.has(i.id));
  if (!pending.length) throw new Error('Không có món chờ xác nhận');
  const upd = db.prepare(`UPDATE order_items SET status=? WHERE id=?`);
  for (const it of pending) upd.run(it.station === 'retail' ? 'served' : 'new', it.id);
  audit('order.confirm', { order: order_id, items: pending.length }, branch_id, actor);
  const full = getOrder(order_id);
  archiveOrder(full);
  const confirmed = db.prepare(`SELECT * FROM order_items WHERE id IN (${pending.map(() => '?').join(',')}) ORDER BY created_at`).all(...pending.map(i => i.id));
  const kitchenItems = confirmed.filter(i => i.status === 'new' && i.station !== 'retail');
  if (kitchenItems.length) printKitchenTickets(full, kitchenItems, branch_id, actor);
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

export function rejectPendingItems(order_id, item_ids = [], reason = '', branch_id = 'br1', actor = 'system') {
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
  archiveOrder(full);
  audit('order.reject', { order: order_id, items: pending.length, reason: cleanReason }, branch_id, actor);
  emit('order:updated', full, branch_id);
  emit('order:pending', { order: full, rejected: pending.map(i => i.id), reason: cleanReason }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return full;
}

export function moveTable(from_table_id, to_table_id, branch_id = 'br1', actor = 'system') {
  if (from_table_id === to_table_id) throw new Error('Bàn chuyển phải khác bàn hiện tại');
  const order = getOpenOrderForTable(from_table_id, branch_id);
  if (!order) throw new Error('Bàn hiện tại chưa có bill để chuyển');
  const targetOrder = getOpenOrderForTable(to_table_id, branch_id);
  if (targetOrder) throw new Error('Bàn đích đang có bill. Hãy dùng Gộp bàn.');
  const source = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(from_table_id, branch_id);
  const target = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(to_table_id, branch_id);
  if (!source) throw new Error('Bàn nguồn không tồn tại');
  if (!target) throw new Error('Bàn đích không tồn tại');
  
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status!='cancelled'`).all(order.id);
  const upd = db.prepare(`UPDATE order_items SET table_path=? WHERE id=?`);
  for (const item of items) {
    const currentPath = item.table_path || source.code;
    const newPath = currentPath + ' => ' + target.code;
    upd.run(newPath, item.id);
  }

  db.prepare(`UPDATE orders SET table_id=? WHERE id=?`).run(to_table_id, order.id);
  setTableByOpenOrders(from_table_id, branch_id);
  setTableByOpenOrders(to_table_id, branch_id);
  audit('table.move', { order: order.id, from: from_table_id, to: to_table_id, from_code: source.code, to_code: target.code }, branch_id, actor);
  emit('order:updated', getOrder(order.id), branch_id);
  emit('kds:refresh', {}, branch_id);
  archiveOrder(getOrder(order.id));
  return getOrder(order.id);
}

export function mergeTables(source_table_id, target_table_id, branch_id = 'br1', actor = 'system') {
  if (source_table_id === target_table_id) throw new Error('Không thể gộp cùng một bàn');
  const source = getOpenOrderForTable(source_table_id, branch_id);
  if (!source) throw new Error('Bàn nguồn chưa có bill');
  let target = getOpenOrderForTable(target_table_id, branch_id);
  const sourceTable = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(source_table_id, branch_id);
  const targetTable = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(target_table_id, branch_id);
  if (!sourceTable) throw new Error('Bàn nguồn không tồn tại');
  if (!targetTable) throw new Error('Bàn đích không tồn tại');
  if (!target) return moveTable(source_table_id, target_table_id, branch_id, actor);
  
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND status!='cancelled'`).all(source.id);
  const upd = db.prepare(`UPDATE order_items SET order_id=?, table_path=? WHERE id=?`);
  for (const item of items) {
    const currentPath = item.table_path || sourceTable.code;
    const newPath = currentPath + ' => ' + targetTable.code;
    upd.run(target.id, newPath, item.id);
  }

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
  }, branch_id, actor);
  emit('order:updated', getOrder(target.id), branch_id);
  emit('kds:refresh', {}, branch_id);
  archiveOrder(getOrder(target.id));
  archiveOrder(getOrder(source.id));
  return getOrder(target.id);
}

export function splitOrderItems(order_id, item_ids = [], branch_id = 'br1', actor = 'system') {
  const order = db.prepare(`SELECT * FROM orders WHERE id=? AND branch_id=? AND status='open'`).get(order_id, branch_id);
  if (!order) throw new Error('Bill không tồn tại hoặc đã đóng');
  const ids = [...new Set(Array.isArray(item_ids) ? item_ids : [])];
  if (!ids.length) throw new Error('Chọn ít nhất một dòng để tách bill');
  const active = db.prepare(`SELECT id FROM order_items WHERE order_id=? AND status!='cancelled'`).all(order_id).map(r => r.id);
  const selected = ids.filter(id => active.includes(id));
  if (!selected.length) throw new Error('Không tìm thấy dòng hợp lệ để tách');
  if (selected.length >= active.length) throw new Error('Không cần tách nếu chọn toàn bộ bill');
  const newId = insertOpenOrder({ branch_id, table_id: order.table_id || null, channel: order.channel || 'dine_in' }).id;
  const upd = db.prepare(`UPDATE order_items SET order_id=? WHERE id=? AND order_id=?`);
  for (const id of selected) upd.run(newId, id, order_id);
  recomputeTotals(order_id);
  recomputeTotals(newId);
  if (order.table_id) setTableByOpenOrders(order.table_id, branch_id);
  const table = order.table_id ? db.prepare(`SELECT code FROM tables WHERE id=?`).get(order.table_id) : null;
  audit('bill.split', { source_order: order_id, split_order: newId, table: order.table_id, table_code: table?.code, items: selected.length }, branch_id, actor);
  emit('order:updated', getOrder(order_id), branch_id);
  emit('order:updated', getOrder(newId), branch_id);
  const sourceOrder = getOrder(order_id);
  const splitOrder = getOrder(newId);
  archiveOrder(sourceOrder);
  archiveOrder(splitOrder);
  return { source: sourceOrder, split: splitOrder };
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
    WHERE o.branch_id=? AND (oi.status IN ('new','accepted','preparing','ready') OR (oi.status='cancelled' AND oi.kds_dismissed=0)) ${where}
    ORDER BY oi.created_at`).all(...params);
  return rows.map(r => ({ ...r, mods: JSON.parse(r.mods_json || '[]') }));
}

export function setItemStatus(item_id, status, branch_id = 'br1', actor = 'system') {
  const valid = ['new', 'accepted', 'preparing', 'ready', 'served', 'cancelled'];
  if (!valid.includes(status)) throw new Error('Trạng thái không hợp lệ');
  const item = db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
  if (!item) throw new Error('Item không tồn tại');
  const ts = now();
  const set = { accepted: 'accepted_at', ready: 'ready_at', served: 'served_at' }[status];
  if (set) db.prepare(`UPDATE order_items SET status=?, ${set}=? WHERE id=?`).run(status, ts, item_id);
  else db.prepare(`UPDATE order_items SET status=? WHERE id=?`).run(status, item_id);

  audit('item.status', { item: item_id, status }, branch_id, actor);
  const order = getOrder(item.order_id);
  archiveOrder(order);
  // When a dish becomes ready, auto-print a per-dish runner slip (with table no.).
  if (status === 'ready') printRunnerSlip(item, order, branch_id);
  emit('order:item', { order_id: item.order_id, item_id, status, order }, branch_id);
  emit('kds:refresh', { station: item.station }, branch_id);
  return db.prepare(`SELECT * FROM order_items WHERE id=?`).get(item_id);
}

export function cancelItem(item_id, reason, branch_id = 'br1', actor = 'system') {
  setItemStatus(item_id, 'cancelled', branch_id, actor);
  const item = db.prepare(`SELECT order_id FROM order_items WHERE id=?`).get(item_id);
  recomputeTotals(item.order_id);
  audit('item.cancel', { item: item_id, reason }, branch_id, actor);
  const order = getOrder(item.order_id);
  archiveOrder(order);
  emit('order:updated', order, branch_id);
  return order;
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

export function createTable({ branch_id = 'br1', zone, code, seats = 4 }) {
  if (!zone || !code) throw new Error('Thiếu khu vực hoặc số bàn');
  const cleanZone = String(zone).trim();
  const cleanCode = String(code).trim();
  if (!cleanZone || !cleanCode) throw new Error('Thiếu khu vực hoặc số bàn');

  const existing = db.prepare(`SELECT 1 FROM tables WHERE branch_id=? AND code=?`).get(branch_id, cleanCode);
  if (existing) throw new Error(`Số bàn "${cleanCode}" đã tồn tại`);

  const id = uid('t_');
  db.prepare(`INSERT INTO tables (id, branch_id, zone, code, seats, status) VALUES (?, ?, ?, ?, ?, 'free')`)
    .run(id, branch_id, cleanZone, cleanCode, parseInt(seats) || 4);

  audit('table.create', { id, zone: cleanZone, code: cleanCode, seats }, branch_id);
  const state = getTableState(id);
  emit('table:updated', state, branch_id);
  emit('stats:dirty', {}, branch_id);
  return state;
}

export function updateTable(id, { zone, code, seats }, branch_id = 'br1') {
  const table = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!table) throw new Error('Bàn không tồn tại');

  const cleanZone = zone !== undefined ? String(zone).trim() : table.zone;
  const cleanCode = code !== undefined ? String(code).trim() : table.code;
  const numSeats = seats !== undefined ? parseInt(seats) || 4 : table.seats;

  if (!cleanZone || !cleanCode) throw new Error('Thiếu khu vực hoặc số bàn');

  if (cleanCode !== table.code) {
    const existing = db.prepare(`SELECT 1 FROM tables WHERE branch_id=? AND code=? AND id!=?`).get(branch_id, cleanCode, id);
    if (existing) throw new Error(`Số bàn "${cleanCode}" đã tồn tại`);
  }

  db.prepare(`UPDATE tables SET zone=?, code=?, seats=? WHERE id=?`)
    .run(cleanZone, cleanCode, numSeats, id);

  audit('table.update', { id, zone: cleanZone, code: cleanCode, seats: numSeats }, branch_id);
  const state = getTableState(id);
  emit('table:updated', state, branch_id);
  emit('stats:dirty', {}, branch_id);
  return state;
}

export function deleteTable(id, branch_id = 'br1') {
  const table = db.prepare(`SELECT * FROM tables WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!table) throw new Error('Bàn không tồn tại');

  if (table.status !== 'free') {
    throw new Error('Bàn đang có khách, không thể xóa!');
  }

  const openOrder = getOpenOrderForTable(id, table.branch_id);
  if (openOrder) {
    throw new Error('Bàn đang có khách, không thể xóa!');
  }

  db.prepare(`DELETE FROM tables WHERE id=?`).run(id);

  audit('table.delete', { id, zone: table.zone, code: table.code }, branch_id);
  emit('table:updated', { id, deleted: true }, branch_id);
  emit('stats:dirty', {}, branch_id);
  return { id, success: true };
}
