// Inventory Core: two warehouse domains (kitchen + retail), lot/expiry
// tracking, FEFO issues, stocktake sessions, and legacy summary stock support.
import { db, uid, now, audit, defaultWarehouseId } from '../db.js';
import { emit } from '../realtime.js';

const DEFAULT_WAREHOUSE = { inventory: 'wh_kitchen', sku: 'wh_retail' };
const fallbackWarehouse = (branch_id, stockType) => defaultWarehouseId(branch_id, stockType) || DEFAULT_WAREHOUSE[stockType];
const SALES_CHANNELS = new Set(['ipad', 'pos', 'retail', 'online', 'grabmerchant', 'shopeefood', 'befood', 'grabmart', 'website']);

const asBool = (v) => v ? 1 : 0;
const textOr = (v, fallback) => (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : fallback;
const nullableText = (v, fallback) => (v !== undefined) ? (String(v || '').trim() || null) : fallback;
const numberOr = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const intOr = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseInt(v);
  return Number.isFinite(n) ? n : fallback;
};
const boolOr = (v, fallback) => (v === undefined || v === null) ? (fallback ? 1 : 0) : (v ? 1 : 0);
const qtyNum = (v, label = 'Số lượng') => {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(label + ' không hợp lệ');
  return n;
};

// ---- Units of measure (alt units convert to the base `unit`) ----
function parseUnits(item) { try { return JSON.parse(item?.units_json || '[]'); } catch { return []; } }
function normalizeUnits(units) {
  if (!Array.isArray(units)) return [];
  return units.map(u => ({ name: String(u.name || '').trim(), factor: Number(u.factor) || 0 }))
    .filter(u => u.name && u.factor > 0);
}
function parseSalesChannels(row) {
  try {
    const parsed = JSON.parse(row?.sales_channels_json || '[]');
    return Array.isArray(parsed) ? parsed.filter(c => SALES_CHANNELS.has(c)) : [];
  } catch {
    return [];
  }
}
function normalizeSalesChannels(channels, type = 'retail') {
  if (!Array.isArray(channels)) return type === 'kitchen' ? ['ipad', 'pos'] : ['retail'];
  return [...new Set(channels.map(c => String(c || '').trim()).filter(c => SALES_CHANNELS.has(c)))];
}
function withWarehouseMeta(row) {
  return {
    ...row,
    active: !!row.active,
    sales_channels: parseSalesChannels(row),
  };
}
function warehouseIdsForChannel(branch_id, channel, type = null) {
  const key = String(channel || '').trim();
  if (!SALES_CHANNELS.has(key)) return null;
  return listWarehouses(branch_id)
    .filter(w => (!type || w.type === type) && parseSalesChannels(w).includes(key))
    .map(w => w.id);
}
// How many base units in 1 of `uom` (the entered unit name).
function unitFactor(item, uom) {
  if (!uom || uom === item.unit) return 1;
  const u = parseUnits(item).find(x => x.name === uom);
  return u ? (Number(u.factor) || 1) : 1;
}

export function listWarehouses(branch_id = 'br1', filters = {}) {
  const includeInactive = filters.all === '1' || filters.all === 1 || filters.include_inactive === '1' || filters.include_inactive === 1;
  const rows = db.prepare(`SELECT * FROM warehouses WHERE branch_id=? ORDER BY sort,name`).all(branch_id);
  const mapped = rows.map(withWarehouseMeta);
  return includeInactive ? mapped : mapped.filter(w => w.active);
}

export function createWarehouse(body, branch_id = 'br1') {
  const name = textOr(body.name, '');
  if (!name) throw new Error('Thiếu tên kho');
  const type = body.type === 'kitchen' ? 'kitchen' : 'retail';
  const salesChannels = normalizeSalesChannels(body.sales_channels || body.salesChannels, type);
  const code = normalizeWarehouseCode(body.code || name);
  const branchPrefix = branch_id === 'br1' ? '' : `${String(branch_id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}_`;
  const id = body.id || `${branchPrefix}wh_${code.toLowerCase()}`;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : 1;
  const sort = intOr(body.sort, db.prepare(`SELECT COALESCE(MAX(sort),0)+1 n FROM warehouses WHERE branch_id=?`).get(branch_id).n);
  const dup = db.prepare(`SELECT id FROM warehouses WHERE id=? OR (branch_id=? AND code=?)`).get(id, branch_id, code);
  if (dup) throw new Error('Mã kho đã tồn tại');
  db.prepare(`INSERT INTO warehouses (id,branch_id,code,name,type,active,sort,sales_channels_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, branch_id, code, name, type, active, sort, JSON.stringify(salesChannels));
  audit('warehouse.create', { id, code, name, type, active, sales_channels: salesChannels }, branch_id);
  emit('inventory:updated', { warehouse: id }, branch_id);
  return withWarehouseMeta(db.prepare(`SELECT * FROM warehouses WHERE id=?`).get(id));
}

export function updateWarehouse(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM warehouses WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Kho không tồn tại');
  const code = body.code !== undefined ? normalizeWarehouseCode(body.code || cur.code) : cur.code;
  const name = textOr(body.name, cur.name);
  const type = body.type !== undefined ? (body.type === 'kitchen' ? 'kitchen' : 'retail') : cur.type;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : cur.active;
  const sort = intOr(body.sort, cur.sort || 0);
  const salesChannels = body.sales_channels !== undefined || body.salesChannels !== undefined
    ? normalizeSalesChannels(body.sales_channels || body.salesChannels || [], type)
    : parseSalesChannels(cur);
  const dup = db.prepare(`SELECT id FROM warehouses WHERE branch_id=? AND code=? AND id!=?`).get(branch_id, code, id);
  if (dup) throw new Error('Mã kho đã tồn tại');
  db.prepare(`UPDATE warehouses SET code=?, name=?, type=?, active=?, sort=?, sales_channels_json=? WHERE id=? AND branch_id=?`)
    .run(code, name, type, active, sort, JSON.stringify(salesChannels), id, branch_id);
  audit('warehouse.update', { id, code, name, type, active, sales_channels: salesChannels }, branch_id);
  emit('inventory:updated', { warehouse: id }, branch_id);
  return withWarehouseMeta(db.prepare(`SELECT * FROM warehouses WHERE id=?`).get(id));
}

export function listInventory(branch_id = 'br1', filters = {}) {
  const rows = db.prepare(`SELECT * FROM inventory_items WHERE branch_id=? AND active=1 ORDER BY item_type,name`).all(branch_id);
  return rows
    .filter(i => !filters.item_type || i.item_type === filters.item_type)
    .filter(i => !filters.warehouse_id || (i.warehouse_id || fallbackWarehouse(branch_id, 'inventory')) === filters.warehouse_id)
    .map(i => enrichStockRow('inventory', i, filters.warehouse_id));
}

export function listSkus(branch_id = 'br1', filters = {}) {
  const channelWarehouseIds = filters.channel ? warehouseIdsForChannel(branch_id, filters.channel, 'retail') : null;
  const rows = db.prepare(`SELECT * FROM skus WHERE branch_id=? AND active=1 ORDER BY name`).all(branch_id);
  return rows
    .filter(s => !filters.warehouse_id || (s.warehouse_id || fallbackWarehouse(branch_id, 'sku')) === filters.warehouse_id)
    .filter(s => !channelWarehouseIds || channelWarehouseIds.includes(s.warehouse_id || fallbackWarehouse(branch_id, 'sku')))
    .map(s => enrichStockRow('sku', s, filters.warehouse_id));
}

export function findSkuByBarcode(barcode, branch_id = 'br1', filters = {}) {
  const channelWarehouseIds = filters.channel ? warehouseIdsForChannel(branch_id, filters.channel, 'retail') : null;
  const rows = db.prepare(`SELECT * FROM skus WHERE branch_id=? AND barcode=? AND active=1 ORDER BY name`).all(branch_id, barcode);
  const row = rows
    .filter(s => !filters.warehouse_id || (s.warehouse_id || fallbackWarehouse(branch_id, 'sku')) === filters.warehouse_id)
    .find(s => !channelWarehouseIds || channelWarehouseIds.includes(s.warehouse_id || fallbackWarehouse(branch_id, 'sku')));
  return row ? enrichStockRow('sku', row, filters.warehouse_id) : null;
}

export function createInventoryItem(body, branch_id = 'br1') {
  if (!body.name) throw new Error('Thiếu tên mặt hàng');
  const id = body.id || uid('i_');
  const warehouse_id = body.warehouse_id || fallbackWarehouse(branch_id, 'inventory');
  const item_type = ['ingredient', 'supply'].includes(body.item_type) ? body.item_type : 'ingredient';
  db.prepare(`INSERT INTO inventory_items
    (id,branch_id,name,unit,stock,min_stock,warehouse_id,item_type,barcode,category,cost,track_lot,expiry_required,active,note,units_json)
    VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?,1,?,?)`).run(
    id, branch_id, body.name, body.unit || 'cái', parseFloat(body.min_stock) || 0,
    warehouse_id, item_type, body.barcode || null, body.category || null, parseFloat(body.cost) || 0,
    asBool(body.track_lot), asBool(body.expiry_required), body.note || null, JSON.stringify(normalizeUnits(body.units)));

  const opening = parseFloat(body.opening_stock || body.stock || 0);
  if (opening > 0) receiveStock(id, opening, branch_id, {
    warehouse_id,
    unit_cost: parseFloat(body.cost) || 0,
    lot_no: body.lot_no || 'OPENING',
    expiry_date: body.expiry_date || null,
    supplier: body.supplier || 'opening',
    movementType: 'opening',
  });
  audit('inventory.item.create', { id, name: body.name, item_type }, branch_id);
  emit('inventory:updated', { ids: [id] }, branch_id);
  return getItem('inventory', id, branch_id);
}

export function updateInventoryItem(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM inventory_items WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Mặt hàng kho bếp không tồn tại');
  const item_type = body.item_type !== undefined
    ? (['ingredient', 'supply'].includes(body.item_type) ? body.item_type : cur.item_type)
    : cur.item_type;
  db.prepare(`UPDATE inventory_items SET
      name=?, unit=?, min_stock=?, warehouse_id=?, item_type=?, barcode=?, category=?, cost=?,
      track_lot=?, expiry_required=?, active=?, note=?, units_json=?
    WHERE id=? AND branch_id=?`).run(
    textOr(body.name, cur.name),
    textOr(body.unit, cur.unit),
    numberOr(body.min_stock, cur.min_stock),
    textOr(body.warehouse_id, cur.warehouse_id || fallbackWarehouse(branch_id, 'inventory')),
    item_type,
    nullableText(body.barcode, cur.barcode),
    nullableText(body.category, cur.category),
    numberOr(body.cost, cur.cost || 0),
    boolOr(body.track_lot, cur.track_lot),
    boolOr(body.expiry_required, cur.expiry_required),
    boolOr(body.active, cur.active),
    nullableText(body.note, cur.note),
    body.units !== undefined ? JSON.stringify(normalizeUnits(body.units)) : (cur.units_json || '[]'),
    id,
    branch_id);
  audit('inventory.item.update', { id, name: body.name || cur.name }, branch_id);
  emit('inventory:updated', { ids: [id] }, branch_id);
  return getItem('inventory', id, branch_id);
}

export function deleteInventoryItem(id, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM inventory_items WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('Mặt hàng kho bếp không tồn tại');
  cleanupStockMaster('inventory', id, branch_id);
  db.prepare(`DELETE FROM inventory_items WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('inventory.item.delete', { id, name: cur.name }, branch_id);
  emit('inventory:updated', { ids: [id], deleted: true }, branch_id);
  return { ok: true, deleted: id, name: cur.name };
}

export function createSku(body, branch_id = 'br1') {
  if (!body.name) throw new Error('Thiếu tên SKU');
  const id = body.id || uid('s_');
  const warehouse_id = body.warehouse_id || fallbackWarehouse(branch_id, 'sku');
  db.prepare(`INSERT INTO skus
    (id,branch_id,barcode,name,emoji,image,price,cost,stock,min_stock,unit,warehouse_id,category,supplier,source_url,track_lot,expiry_required,active,units_json)
    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,1,?)`).run(
    id, branch_id, body.barcode || null, body.name, body.emoji || '📦', body.image || null,
    parseInt(body.price) || 0, parseInt(body.cost) || 0, parseFloat(body.min_stock) || 0,
    body.unit || 'cái', warehouse_id, body.category || null, body.supplier || null, body.source_url || null,
    asBool(body.track_lot), asBool(body.expiry_required), JSON.stringify(normalizeUnits(body.units)));

  const opening = parseFloat(body.opening_stock || body.stock || 0);
  if (opening > 0) receiveSku(id, opening, branch_id, {
    warehouse_id,
    unit_cost: parseFloat(body.cost) || 0,
    lot_no: body.lot_no || 'OPENING',
    expiry_date: body.expiry_date || null,
    supplier: body.supplier || 'opening',
    movementType: 'opening',
  });
  audit('sku.create', { id, name: body.name }, branch_id);
  emit('inventory:updated', { ids: [id] }, branch_id);
  return getItem('sku', id, branch_id);
}

export function deleteSku(id, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM skus WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('SKU không tồn tại');
  cleanupStockMaster('sku', id, branch_id);
  db.prepare(`DELETE FROM skus WHERE id=? AND branch_id=?`).run(id, branch_id);
  audit('sku.delete', { id, name: cur.name }, branch_id);
  emit('inventory:updated', { ids: [id], deleted: true }, branch_id);
  return { ok: true, deleted: id, name: cur.name };
}

export function updateSku(id, body, branch_id = 'br1') {
  const cur = db.prepare(`SELECT * FROM skus WHERE id=? AND branch_id=?`).get(id, branch_id);
  if (!cur) throw new Error('SKU không tồn tại');
  db.prepare(`UPDATE skus SET
      barcode=?, name=?, emoji=?, image=?, price=?, cost=?, min_stock=?, unit=?, warehouse_id=?,
      category=?, supplier=?, source_url=?, track_lot=?, expiry_required=?, active=?, units_json=?
    WHERE id=? AND branch_id=?`).run(
    nullableText(body.barcode, cur.barcode),
    textOr(body.name, cur.name),
    textOr(body.emoji, cur.emoji || '📦'),
    nullableText(body.image, cur.image),
    intOr(body.price, cur.price),
    intOr(body.cost, cur.cost || 0),
    numberOr(body.min_stock, cur.min_stock),
    textOr(body.unit, cur.unit || 'cái'),
    textOr(body.warehouse_id, cur.warehouse_id || fallbackWarehouse(branch_id, 'sku')),
    nullableText(body.category, cur.category),
    nullableText(body.supplier, cur.supplier),
    nullableText(body.source_url, cur.source_url),
    boolOr(body.track_lot, cur.track_lot),
    boolOr(body.expiry_required, cur.expiry_required),
    boolOr(body.active, cur.active),
    body.units !== undefined ? JSON.stringify(normalizeUnits(body.units)) : (cur.units_json || '[]'),
    id,
    branch_id);
  audit('sku.update', { id, name: body.name || cur.name }, branch_id);
  emit('inventory:updated', { ids: [id] }, branch_id);
  return getItem('sku', id, branch_id);
}

export function receiveStock(inventory_item_id, qty, branch_id = 'br1', options = {}) {
  receiveGeneric('inventory', inventory_item_id, qty, branch_id, options);
  checkAlerts(branch_id, [{ stockType: 'inventory', id: inventory_item_id }]);
  emit('inventory:updated', { ids: [inventory_item_id] }, branch_id);
  return getItem('inventory', inventory_item_id, branch_id);
}

export function receiveSku(sku_id, qty, branch_id = 'br1', options = {}) {
  receiveGeneric('sku', sku_id, qty, branch_id, options);
  checkAlerts(branch_id, [{ stockType: 'sku', id: sku_id }]);
  emit('inventory:updated', { ids: [sku_id] }, branch_id);
  return getItem('sku', sku_id, branch_id);
}

export function issueStock(stockType, item_id, qty, branch_id = 'br1', options = {}) {
  const consumed = issueGeneric(normalizeStockType(stockType), item_id, qty, branch_id, options);
  checkAlerts(branch_id, [{ stockType: normalizeStockType(stockType), id: item_id }]);
  emit('inventory:updated', { ids: [item_id] }, branch_id);
  return consumed;
}

export function adjustStock(inventory_item_id, newStock, branch_id = 'br1', options = {}) {
  return setStockLevel('inventory', inventory_item_id, newStock, branch_id, options);
}

export function adjustSku(sku_id, newStock, branch_id = 'br1', options = {}) {
  return setStockLevel('sku', sku_id, newStock, branch_id, options);
}

export function returnSku(sku_id, qty, ref, branch_id = 'br1', options = {}) {
  const lot = options.lot_id ? db.prepare(`SELECT * FROM stock_lots WHERE id=? AND branch_id=? AND item_type='sku' AND item_id=?`)
    .get(options.lot_id, branch_id, sku_id) : null;
  receiveGeneric('sku', sku_id, qty, branch_id, {
    ref,
    movementType: 'return',
    reason: 'retail_return',
    warehouse_id: lot?.warehouse_id || options.warehouse_id,
    lot_no: lot?.lot_no || options.lot_no,
    expiry_date: lot?.expiry_date || options.expiry_date,
    mfg_date: lot?.mfg_date || options.mfg_date,
    unit_cost: lot?.unit_cost || options.unit_cost,
    supplier: lot?.supplier || options.supplier,
  });
  emit('inventory:updated', { ids: [sku_id] }, branch_id);
}

export function transferStock(body, branch_id = 'br1') {
  const stockType = normalizeStockType(body.stock_type || body.item_type);
  const item_id = body.item_id;
  const from = body.from_warehouse_id;
  const to = body.to_warehouse_id;
  if (!item_id || !from || !to || from === to) throw new Error('Phiếu chuyển kho thiếu thông tin');
  const item = getItem(stockType, item_id, branch_id);
  if (!item) throw new Error('Mặt hàng không tồn tại');
  const qty = qtyNum(body.qty) * unitFactor(item, body.uom);

  const doc = createDocument(branch_id, {
    type: 'transfer',
    warehouse_id: from,
    to_warehouse_id: to,
    reason: body.reason || 'transfer',
    ref: body.ref || null,
  });
  const consumed = consumeLots(stockType, item_id, from, qty, body.lot_id);
  for (const c of consumed) {
    const lot = c.lot_id ? db.prepare(`SELECT * FROM stock_lots WHERE id=?`).get(c.lot_id) : null;
    const targetLot = upsertLot({
      branch_id,
      warehouse_id: to,
      item_type: stockType,
      item_id,
      lot_no: lot?.lot_no || body.lot_no || 'TRANSFER',
      expiry_date: lot?.expiry_date || body.expiry_date || null,
      mfg_date: lot?.mfg_date || null,
      unit_cost: lot?.unit_cost || item.cost || 0,
      supplier: lot?.supplier || body.supplier || null,
      qty: c.qty,
    });
    recordMovement({ branch_id, stockType, item_id, warehouse_id: from, lot_id: c.lot_id, type: 'transfer_out', qty: -c.qty, ref: doc.id, reason: body.reason, doc_id: doc.id, unit_cost: lot?.unit_cost || 0 });
    recordMovement({ branch_id, stockType, item_id, warehouse_id: to, lot_id: targetLot.id, type: 'transfer_in', qty: c.qty, ref: doc.id, reason: body.reason, doc_id: doc.id, unit_cost: lot?.unit_cost || 0 });
    addDocumentLine(doc.id, stockType, item_id, c.lot_id, -c.qty, lot?.unit_cost || 0, lot?.expiry_date || null, 'transfer out');
    addDocumentLine(doc.id, stockType, item_id, targetLot.id, c.qty, lot?.unit_cost || 0, lot?.expiry_date || null, 'transfer in');
  }
  audit('stock.transfer', { item: item_id, stockType, qty, from, to }, branch_id);
  emit('inventory:updated', { ids: [item_id] }, branch_id);
  return { ok: true, document_id: doc.id };
}

export function applyStocktake({ warehouse_id, name, mode = 'partial', lines = [] }, branch_id = 'br1') {
  if (!warehouse_id) throw new Error('Thiếu kho kiểm');
  if (!Array.isArray(lines) || !lines.length) throw new Error('Chưa có dòng kiểm kho');
  const sid = uid('st_');
  db.prepare(`INSERT INTO stocktake_sessions (id,branch_id,warehouse_id,name,mode,status,created_at,approved_at)
    VALUES (?,?,?,?,?,'approved',?,?)`).run(sid, branch_id, warehouse_id, name || 'Kiểm kho', mode, now(), now());

  const insLine = db.prepare(`INSERT INTO stocktake_lines
    (id,session_id,item_type,item_id,lot_id,expected_qty,counted_qty,delta_qty,reason)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  let changed = 0;
  for (const line of lines) {
    const stockType = normalizeStockType(line.stock_type || line.item_type);
    const item_id = line.item_id;
    const counted = parseFloat(line.counted_qty ?? line.stock);
    if (!item_id || !Number.isFinite(counted) || counted < 0) continue;
    const expected = currentStock(stockType, item_id, warehouse_id, line.lot_id);
    const delta = counted - expected;
    insLine.run(uid('stl_'), sid, stockType, item_id, line.lot_id || null, expected, counted, delta, line.reason || null);
    if (Math.abs(delta) < 0.000001) continue;
    if (delta > 0) {
      receiveGeneric(stockType, item_id, delta, branch_id, {
        warehouse_id,
        lot_no: line.lot_no || `COUNT-${sid.slice(-5)}`,
        expiry_date: line.expiry_date || null,
        movementType: 'stocktake',
        ref: sid,
        reason: line.reason || 'stocktake_gain',
      });
    } else {
      issueGeneric(stockType, item_id, Math.abs(delta), branch_id, {
        warehouse_id,
        lot_id: line.lot_id || null,
        movementType: 'stocktake',
        ref: sid,
        reason: line.reason || 'stocktake_loss',
      });
    }
    changed++;
  }
  audit('stocktake.approve', { session: sid, warehouse_id, changed }, branch_id);
  emit('inventory:updated', {}, branch_id);
  return { ok: true, session_id: sid, changed };
}

export function listStocktakes(branch_id = 'br1', limit = 20) {
  return db.prepare(`
    SELECT s.*, w.name AS warehouse_name,
      (SELECT COUNT(*) FROM stocktake_lines l WHERE l.session_id=s.id) AS lines
    FROM stocktake_sessions s
    LEFT JOIN warehouses w ON w.id=s.warehouse_id
    WHERE s.branch_id=?
    ORDER BY s.created_at DESC LIMIT ?`).all(branch_id, limit);
}

export function listLots(branch_id = 'br1', filters = {}) {
  const rows = db.prepare(`
    SELECT l.*, w.name AS warehouse_name,
      COALESCE(i.name, s.name) AS item_name,
      COALESCE(i.unit, s.unit) AS unit,
      COALESCE(i.item_type, 'retail') AS item_kind
    FROM stock_lots l
    LEFT JOIN warehouses w ON w.id=l.warehouse_id
    LEFT JOIN inventory_items i ON i.id=l.item_id AND l.item_type='inventory'
    LEFT JOIN skus s ON s.id=l.item_id AND l.item_type='sku'
    WHERE l.branch_id=? AND l.qty_on_hand>0
    ORDER BY
      CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END,
      l.expiry_date ASC,
      l.received_at ASC`).all(branch_id);
  const maxDate = filters.expiring_days ? new Date(Date.now() + Number(filters.expiring_days) * 86400000).toISOString().slice(0, 10) : null;
  return rows
    .filter(l => !filters.warehouse_id || l.warehouse_id === filters.warehouse_id)
    .filter(l => !filters.item_type || l.item_type === filters.item_type)
    .filter(l => !maxDate || (l.expiry_date && l.expiry_date <= maxDate));
}

export function listMovements(branch_id = 'br1', limit = 80) {
  return db.prepare(`
    SELECT m.*,
      COALESCE(i.name, s.name) AS item_name,
      COALESCE(i.unit, s.unit) AS unit,
      COALESCE(i.item_type, 'retail') AS item_kind,
      w.name AS warehouse_name,
      l.lot_no,
      l.expiry_date
    FROM stock_movements m
    LEFT JOIN inventory_items i ON i.id=m.inventory_item_id AND (m.item_type='inventory' OR m.item_type IS NULL)
    LEFT JOIN skus s ON s.id=m.inventory_item_id AND m.item_type='sku'
    LEFT JOIN warehouses w ON w.id=m.warehouse_id
    LEFT JOIN stock_lots l ON l.id=m.lot_id
    WHERE m.branch_id=?
    ORDER BY m.created_at DESC LIMIT ?`).all(branch_id, limit);
}

// ---- Warehouse documents (digital goods-receipt / goods-issue slips) ----
export function listDocuments(branch_id = 'br1', filters = {}) {
  const rows = db.prepare(`
    SELECT d.*, w.name AS warehouse_name, tw.name AS to_warehouse_name,
      (SELECT COUNT(*) FROM inventory_document_lines l WHERE l.document_id=d.id) AS line_count,
      (SELECT COALESCE(SUM(ABS(l.qty)*l.unit_cost),0) FROM inventory_document_lines l WHERE l.document_id=d.id) AS total_value
    FROM inventory_documents d
    LEFT JOIN warehouses w ON w.id=d.warehouse_id
    LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
    WHERE d.branch_id=?
    ORDER BY d.created_at DESC LIMIT ?`).all(branch_id, parseInt(filters.limit) || 60);
  return rows
    .filter(d => !filters.warehouse_id || d.warehouse_id === filters.warehouse_id || d.to_warehouse_id === filters.warehouse_id)
    .filter(d => !filters.type || d.type === filters.type);
}

export function getDocument(id, branch_id = 'br1') {
  const doc = db.prepare(`
    SELECT d.*, w.name AS warehouse_name, w.code AS warehouse_code, tw.name AS to_warehouse_name
    FROM inventory_documents d
    LEFT JOIN warehouses w ON w.id=d.warehouse_id
    LEFT JOIN warehouses tw ON tw.id=d.to_warehouse_id
    WHERE d.id=? AND d.branch_id=?`).get(id, branch_id);
  if (!doc) throw new Error('Phiếu không tồn tại');
  const branch = db.prepare(`SELECT name, address FROM branches WHERE id=?`).get(branch_id);
  const lines = db.prepare(`
    SELECT l.*, COALESCE(i.name, s.name) AS item_name, COALESCE(i.unit, s.unit) AS unit,
      lot.lot_no, lot.expiry_date
    FROM inventory_document_lines l
    LEFT JOIN inventory_items i ON i.id=l.item_id AND l.item_type='inventory'
    LEFT JOIN skus s ON s.id=l.item_id AND l.item_type='sku'
    LEFT JOIN stock_lots lot ON lot.id=l.lot_id
    WHERE l.document_id=?
    ORDER BY l.rowid`).all(id);
  return { ...doc, branch_name: branch?.name, branch_address: branch?.address, lines };
}

export function deductForOrder(order, branch_id = 'br1') {
  const getRecipe = db.prepare(`SELECT inventory_item_id, qty FROM recipes WHERE menu_item_id=?`);
  const touched = [];
  for (const it of order.items || []) {
    if (it.status === 'cancelled') continue;
    if (it.sku_id) {
      issueGeneric('sku', it.sku_id, it.qty, branch_id, { movementType: 'sale', ref: order.id, reason: 'retail_sale', lot_id: it.lot_id || null });
      touched.push({ stockType: 'sku', id: it.sku_id });
    } else if (it.menu_item_id) {
      for (const r of getRecipe.all(it.menu_item_id)) {
        const used = r.qty * it.qty;
        issueGeneric('inventory', r.inventory_item_id, used, branch_id, { movementType: 'recipe', ref: order.id, reason: it.name });
        touched.push({ stockType: 'inventory', id: r.inventory_item_id });
      }
    }
  }
  checkAlerts(branch_id, touched);
  emit('inventory:updated', { ids: touched.map(t => t.id) }, branch_id);
}

function receiveGeneric(stockType, item_id, qtyRaw, branch_id, options = {}) {
  const item = getItem(stockType, item_id, branch_id);
  if (!item) throw new Error('Mặt hàng không tồn tại');
  const qty = qtyNum(qtyRaw) * unitFactor(item, options.uom);
  const warehouse_id = options.warehouse_id || item.warehouse_id || fallbackWarehouse(branch_id, stockType);
  if (item.expiry_required && !options.expiry_date) throw new Error(`${item.name} bắt buộc nhập hạn sử dụng`);
  const doc = options.doc_id ? { id: options.doc_id } : createDocument(branch_id, {
    type: options.movementType || 'receipt',
    warehouse_id,
    supplier: options.supplier || item.supplier || null,
    ref: options.ref || null,
    reason: options.reason || null,
  });
  const lot = upsertLot({
    branch_id,
    warehouse_id,
    item_type: stockType,
    item_id,
    lot_no: normalizeLotNo(item, options),
    mfg_date: options.mfg_date || null,
    expiry_date: options.expiry_date || null,
    received_at: options.received_at || now(),
    qty,
    unit_cost: parseFloat(options.unit_cost ?? item.cost ?? 0) || 0,
    supplier: options.supplier || item.supplier || null,
  });
  addSummaryStock(stockType, item_id, qty);
  recordMovement({
    branch_id, stockType, item_id, warehouse_id, lot_id: lot.id,
    type: options.movementType || 'receipt', qty, ref: options.ref || doc.id,
    reason: options.reason || null, doc_id: doc.id, unit_cost: lot.unit_cost || 0,
  });
  addDocumentLine(doc.id, stockType, item_id, lot.id, qty, lot.unit_cost || 0, lot.expiry_date || null, options.note || null);
  audit(`${stockType}.receive`, { item: item_id, qty, lot: lot.lot_no }, branch_id);
  return lot;
}

function issueGeneric(stockType, item_id, qtyRaw, branch_id, options = {}) {
  const item = getItem(stockType, item_id, branch_id);
  if (!item) throw new Error('Mặt hàng không tồn tại');
  const qty = qtyNum(qtyRaw) * unitFactor(item, options.uom);
  const warehouse_id = options.warehouse_id || item.warehouse_id || fallbackWarehouse(branch_id, stockType);
  const available = currentStock(stockType, item_id, warehouse_id, options.lot_id || null);
  if (available + 0.000001 < qty) throw new Error(`Không đủ tồn: ${item.name} (còn ${roundQty(available)} ${item.unit})`);
  const doc = options.doc_id ? { id: options.doc_id } : createDocument(branch_id, {
    type: options.movementType || 'issue',
    warehouse_id,
    ref: options.ref || null,
    reason: options.reason || null,
  });
  const consumed = consumeLots(stockType, item_id, warehouse_id, qty, options.lot_id);
  addSummaryStock(stockType, item_id, -qty);
  for (const c of consumed) {
    recordMovement({
      branch_id, stockType, item_id, warehouse_id, lot_id: c.lot_id,
      type: options.movementType || 'issue', qty: -c.qty, ref: options.ref || doc.id,
      reason: options.reason || null, doc_id: doc.id, unit_cost: c.unit_cost || 0,
    });
    addDocumentLine(doc.id, stockType, item_id, c.lot_id, -c.qty, c.unit_cost || 0, c.expiry_date || null, options.note || null);
  }
  audit(`${stockType}.issue`, { item: item_id, qty, type: options.movementType || 'issue' }, branch_id);
  return consumed;
}

function setStockLevel(stockType, item_id, newStockRaw, branch_id, options = {}) {
  const newStock = parseFloat(newStockRaw);
  if (!Number.isFinite(newStock) || newStock < 0) throw new Error('Tồn kiểm không hợp lệ');
  const item = getItem(stockType, item_id, branch_id);
  if (!item) throw new Error('Mặt hàng không tồn tại');
  const warehouse_id = options.warehouse_id || item.warehouse_id || fallbackWarehouse(branch_id, stockType);
  const cur = currentStock(stockType, item_id, warehouse_id);
  const delta = newStock - cur;
  if (Math.abs(delta) < 0.000001) return getItem(stockType, item_id, branch_id);
  if (delta > 0) receiveGeneric(stockType, item_id, delta, branch_id, { ...options, warehouse_id, movementType: 'stocktake', reason: options.reason || 'manual_count' });
  else issueGeneric(stockType, item_id, Math.abs(delta), branch_id, { ...options, warehouse_id, movementType: 'stocktake', reason: options.reason || 'manual_count' });
  checkAlerts(branch_id, [{ stockType, id: item_id }]);
  emit('inventory:updated', { ids: [item_id] }, branch_id);
  return getItem(stockType, item_id, branch_id);
}

function consumeLots(stockType, item_id, warehouse_id, qty, lot_id = null) {
  const rows = lot_id
    ? [selectedLot(stockType, item_id, warehouse_id, lot_id, qty)]
    : db.prepare(`
        SELECT * FROM stock_lots
        WHERE warehouse_id=? AND item_type=? AND item_id=? AND qty_on_hand>0
        ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, received_at ASC`).all(warehouse_id, stockType, item_id);
  let remaining = qty;
  const consumed = [];
  for (const lot of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.qty_on_hand);
    db.prepare(`UPDATE stock_lots SET qty_on_hand=qty_on_hand-?, status=CASE WHEN qty_on_hand-?<=0 THEN 'depleted' ELSE status END WHERE id=?`)
      .run(take, take, lot.id);
    consumed.push({ lot_id: lot.id, qty: take, unit_cost: lot.unit_cost || 0, expiry_date: lot.expiry_date || null });
    remaining -= take;
  }
  if (remaining > 0.000001) {
    if (lot_id) throw new Error('Lot không đủ tồn');
    consumed.push({ lot_id: null, qty: remaining, unit_cost: 0, expiry_date: null });
  }
  return consumed;
}

function selectedLot(stockType, item_id, warehouse_id, lot_id, qty) {
  const lot = db.prepare(`SELECT * FROM stock_lots WHERE id=? AND warehouse_id=? AND item_type=? AND item_id=?`)
    .get(lot_id, warehouse_id, stockType, item_id);
  if (!lot) throw new Error('Lot không tồn tại');
  if (lot.qty_on_hand + 0.000001 < qty) throw new Error('Lot không đủ tồn');
  return lot;
}

function upsertLot({ branch_id, warehouse_id, item_type, item_id, lot_no, mfg_date = null, expiry_date = null, received_at = now(), qty, unit_cost = 0, supplier = null }) {
  const found = db.prepare(`SELECT * FROM stock_lots WHERE warehouse_id=? AND item_type=? AND item_id=? AND lot_no=?`)
    .get(warehouse_id, item_type, item_id, lot_no);
  if (found) {
    db.prepare(`UPDATE stock_lots SET qty_on_hand=qty_on_hand+?, unit_cost=?, supplier=COALESCE(?,supplier), expiry_date=COALESCE(?,expiry_date), mfg_date=COALESCE(?,mfg_date), status='active' WHERE id=?`)
      .run(qty, unit_cost, supplier, expiry_date, mfg_date, found.id);
    return db.prepare(`SELECT * FROM stock_lots WHERE id=?`).get(found.id);
  }
  const id = uid('lot_');
  db.prepare(`INSERT INTO stock_lots
    (id,branch_id,warehouse_id,item_type,item_id,lot_no,mfg_date,expiry_date,received_at,qty_on_hand,unit_cost,supplier,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`).run(
    id, branch_id, warehouse_id, item_type, item_id, lot_no, mfg_date, expiry_date, received_at, qty, unit_cost, supplier, now());
  return db.prepare(`SELECT * FROM stock_lots WHERE id=?`).get(id);
}

function normalizeLotNo(item, options = {}) {
  if (options.lot_no) return String(options.lot_no).trim();
  if (item.track_lot || item.expiry_required || options.expiry_date) {
    const d = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `LOT-${d}-${uid('').slice(-5).toUpperCase()}`;
  }
  return 'NOLOT';
}

function createDocument(branch_id, { type, warehouse_id = null, to_warehouse_id = null, supplier = null, ref = null, reason = null }) {
  const id = uid('doc_');
  db.prepare(`INSERT INTO inventory_documents (id,branch_id,warehouse_id,to_warehouse_id,type,status,supplier,ref,reason,created_at,posted_at)
    VALUES (?,?,?,?,?,'posted',?,?,?,?,?)`).run(id, branch_id, warehouse_id, to_warehouse_id, type, supplier, ref, reason, now(), now());
  return { id };
}

function addDocumentLine(document_id, item_type, item_id, lot_id, qty, unit_cost, expiry_date, note) {
  db.prepare(`INSERT INTO inventory_document_lines (id,document_id,item_type,item_id,lot_id,qty,unit_cost,expiry_date,note)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(uid('dl_'), document_id, item_type, item_id, lot_id || null, qty, unit_cost || 0, expiry_date || null, note || null);
}

function recordMovement({ branch_id, stockType, item_id, warehouse_id, lot_id = null, type, qty, ref = null, reason = null, doc_id = null, unit_cost = 0 }) {
  db.prepare(`INSERT INTO stock_movements
    (id,branch_id,inventory_item_id,type,qty,ref,created_at,item_type,warehouse_id,lot_id,unit_cost,reason,doc_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid('sm_'), branch_id, item_id, type, qty, ref, now(), stockType, warehouse_id, lot_id, unit_cost, reason, doc_id);
}

function addSummaryStock(stockType, item_id, delta) {
  if (stockType === 'sku') db.prepare(`UPDATE skus SET stock=stock+? WHERE id=?`).run(delta, item_id);
  else db.prepare(`UPDATE inventory_items SET stock=stock+? WHERE id=?`).run(delta, item_id);
}

function currentStock(stockType, item_id, warehouse_id, lot_id = null) {
  if (lot_id) {
    return db.prepare(`SELECT COALESCE(qty_on_hand,0) stock FROM stock_lots WHERE id=? AND item_type=? AND item_id=? AND warehouse_id=?`)
      .get(lot_id, stockType, item_id, warehouse_id)?.stock || 0;
  }
  const lotRows = db.prepare(`SELECT COALESCE(SUM(qty_on_hand),0) stock FROM stock_lots WHERE item_type=? AND item_id=? AND warehouse_id=?`)
    .get(stockType, item_id, warehouse_id);
  if (lotRows && lotRows.stock > 0) return lotRows.stock;
  return getItem(stockType, item_id)?.stock || 0;
}

function enrichStockRow(stockType, row, warehouseFilter = null) {
  const warehouse_id = row.warehouse_id || fallbackWarehouse(row.branch_id || 'br1', stockType);
  const stock = warehouseFilter ? currentStock(stockType, row.id, warehouseFilter) : row.stock;
  return {
    ...row,
    stock,
    warehouse_id,
    stock_type: stockType,
    low: stock <= row.min_stock,
    track_lot: !!row.track_lot,
    expiry_required: !!row.expiry_required,
    active: !!row.active,
    units: parseUnits(row),
  };
}

function getItem(stockType, id, branch_id = null) {
  if (stockType === 'sku') {
    return branch_id
      ? db.prepare(`SELECT *, 'sku' AS stock_type FROM skus WHERE id=? AND branch_id=?`).get(id, branch_id)
      : db.prepare(`SELECT *, 'sku' AS stock_type FROM skus WHERE id=?`).get(id);
  }
  return branch_id
    ? db.prepare(`SELECT *, 'inventory' AS stock_type FROM inventory_items WHERE id=? AND branch_id=?`).get(id, branch_id)
    : db.prepare(`SELECT *, 'inventory' AS stock_type FROM inventory_items WHERE id=?`).get(id);
}

function cleanupStockMaster(stockType, id, branch_id) {
  if (stockType === 'inventory') db.prepare(`DELETE FROM recipes WHERE inventory_item_id=?`).run(id);
  db.prepare(`DELETE FROM stock_lots WHERE branch_id=? AND item_type=? AND item_id=?`).run(branch_id, stockType, id);
  db.prepare(`DELETE FROM stock_movements
    WHERE branch_id=? AND inventory_item_id=? AND (item_type=? OR (item_type IS NULL AND ?='inventory'))`)
    .run(branch_id, id, stockType, stockType);
  db.prepare(`DELETE FROM inventory_document_lines WHERE item_type=? AND item_id=?`).run(stockType, id);
  db.prepare(`DELETE FROM stocktake_lines WHERE item_type=? AND item_id=?`).run(stockType, id);
}

function normalizeStockType(v) {
  if (v === 'sku' || v === 'retail') return 'sku';
  return 'inventory';
}

function checkAlerts(branch_id, touched) {
  const seen = new Set();
  for (const t of touched) {
    const key = `${t.stockType}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = getItem(t.stockType, t.id);
    if (item && item.stock <= item.min_stock) {
      emit('inventory:alert', { id: t.id, name: item.name, stock: item.stock, min: item.min_stock, unit: item.unit }, branch_id);
    }
  }
}

function roundQty(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeWarehouseCode(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'WAREHOUSE';
}
