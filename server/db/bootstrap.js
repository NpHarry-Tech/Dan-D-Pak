import { db } from './connection.js';
import { now, uid } from './ids.js';
export function defaultWarehouseIds(branch_id = 'br1') {
  if (branch_id === 'br1') {
    return { kitchen: 'wh_kitchen', retail: 'wh_retail', showroom: 'wh_showroom_bcm' };
  }
  const clean = String(branch_id || 'br1').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  return {
    kitchen: `${clean}_wh_kitchen`,
    retail: `${clean}_wh_retail`,
    showroom: `${clean}_wh_showroom_bcm`,
  };
}

export function defaultWarehouseId(branch_id = 'br1', stockType = 'inventory') {
  const ids = defaultWarehouseIds(branch_id);
  return stockType === 'sku' || stockType === 'retail' ? ids.retail : ids.kitchen;
}

export function bootstrapBranchDefaults() {
  db.prepare(`INSERT OR IGNORE INTO branches (id,name,address,code,active,sort) VALUES (?,?,?,?,1,?)`)
    .run('br1', 'Dan D Pak Sala', 'Sala, TP.HCM', 'SALA', 1);
  db.prepare(`UPDATE branches
    SET name=CASE WHEN name IN ('District 1 - HCMC','Dan D Pak') THEN 'Dan D Pak Sala' ELSE name END,
        code=COALESCE(NULLIF(code,''),'SALA'),
        active=COALESCE(active,1),
        sort=COALESCE(sort,1)
    WHERE id='br1'`).run();
  db.prepare(`UPDATE users SET branch_access_json='["*"]' WHERE role='owner' AND (branch_access_json IS NULL OR branch_access_json='' OR branch_access_json='[]')`).run();
}

// Self-heal after a crash: replay the fsync'd NDJSON footprint archive back into
// audit_log. With WAL+synchronous=NORMAL, a power loss can roll back SQLite's most
// recent commits, but the archive (written + fsync'd before each SQLite insert)
// still has them. INSERT OR IGNORE on the primary key makes this idempotent, so it
// only restores rows that are genuinely missing. Returns how many were restored.

export function bootstrapWarehouseDefaults(branch_id = 'br1') {
  const ids = defaultWarehouseIds(branch_id);
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,code,name,type,sort) VALUES (?,?,?,?,?,?)`)
    .run(ids.kitchen, branch_id, 'KITCHEN', 'Kho bếp / nguyên liệu & vật dụng', 'kitchen', 1);
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,code,name,type,sort) VALUES (?,?,?,?,?,?)`)
    .run(ids.retail, branch_id, 'BCM', 'Kho BCM', 'retail', 2);
  db.prepare(`UPDATE warehouses SET code='BCM', name='Kho BCM', type='retail', active=1, sort=2 WHERE id=? AND branch_id=? AND (code='RETAIL' OR name LIKE '%retail%')`)
    .run(ids.retail, branch_id);
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,code,name,type,sort) VALUES (?,?,?,?,?,?)`)
    .run(ids.showroom, branch_id, 'SHOWROOM_BCM', 'Showroom BCM', 'retail', 3);
  db.prepare(`UPDATE warehouses SET sales_channels_json=? WHERE id=? AND branch_id=? AND (sales_channels_json IS NULL OR sales_channels_json='')`)
    .run(JSON.stringify(['ipad', 'pos']), ids.kitchen, branch_id);
  db.prepare(`UPDATE warehouses SET sales_channels_json=? WHERE id=? AND branch_id=? AND (sales_channels_json IS NULL OR sales_channels_json='')`)
    .run(JSON.stringify(['retail', 'online', 'grabmart', 'website']), ids.retail, branch_id);
  db.prepare(`UPDATE warehouses SET sales_channels_json=? WHERE id=? AND branch_id=? AND (sales_channels_json IS NULL OR sales_channels_json='')`)
    .run(JSON.stringify(['retail', 'grabmart']), ids.showroom, branch_id);

  db.prepare(`UPDATE inventory_items SET warehouse_id=COALESCE(warehouse_id,?), item_type=COALESCE(item_type,'ingredient'), active=COALESCE(active,1) WHERE branch_id=?`)
    .run(ids.kitchen, branch_id);
  db.prepare(`UPDATE skus SET warehouse_id=COALESCE(warehouse_id,?), active=COALESCE(active,1) WHERE branch_id=?`)
    .run(ids.retail, branch_id);
  db.prepare(`UPDATE menu_items SET ingredients_json=COALESCE(ingredients_json,'[]'), allergens_json=COALESCE(allergens_json,'[]'), schedule_json=COALESCE(schedule_json,'{"mode":"always"}'), hidden=COALESCE(hidden,0)`)
    .run();

  backfillMovementMeta(branch_id);
  createOpeningLots(branch_id);
  bootstrapVoucherDefaults(branch_id);
}

export function bootstrapTableDefaults(branch_id = 'br1') {
  const existing = db.prepare(`SELECT COUNT(*) n FROM tables WHERE branch_id=?`).get(branch_id).n;
  if (existing) return;
  const prefix = branch_id === 'br1' ? '' : `${String(branch_id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}_`;
  const rows = [
    ['Tầng trệt', ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10']],
    ['Tầng 1', ['A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19']],
    ['Nội bộ', ['Nội Bộ 01']],
    ['OS', ['OS1', 'OS2']],
    ['Take away', ['TA01']],
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO tables (id,branch_id,zone,code,seats,status) VALUES (?,?,?,?,?,'free')`);
  for (const [zone, codes] of rows) {
    for (const code of codes) ins.run(`${prefix}t_${code.replace(/\s+/g, '_')}`, branch_id, zone, code, 4);
  }
}
function backfillMovementMeta(branch_id) {
  const rows = db.prepare(`SELECT id, inventory_item_id FROM stock_movements WHERE branch_id=? AND item_type IS NULL`).all(branch_id);
  const upd = db.prepare(`UPDATE stock_movements SET item_type=?, warehouse_id=? WHERE id=?`);
  for (const r of rows) {
    const inv = db.prepare(`SELECT warehouse_id FROM inventory_items WHERE id=?`).get(r.inventory_item_id);
    const sku = inv ? null : db.prepare(`SELECT warehouse_id FROM skus WHERE id=?`).get(r.inventory_item_id);
    upd.run(inv ? 'inventory' : 'sku', inv?.warehouse_id || sku?.warehouse_id || defaultWarehouseId(branch_id, inv ? 'inventory' : 'sku'), r.id);
  }
}

function createOpeningLots(branch_id) {
  const countLots = db.prepare(`SELECT COUNT(*) n FROM stock_lots WHERE branch_id=? AND item_type=? AND item_id=?`);
  const insLot = db.prepare(`INSERT OR IGNORE INTO stock_lots
    (id,branch_id,warehouse_id,item_type,item_id,lot_no,received_at,qty_on_hand,unit_cost,supplier,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`);

  for (const i of db.prepare(`SELECT id, warehouse_id, stock, cost FROM inventory_items WHERE branch_id=? AND stock>0`).all(branch_id)) {
    if (countLots.get(branch_id, 'inventory', i.id).n) continue;
    insLot.run(uid('lot_'), branch_id, i.warehouse_id || defaultWarehouseId(branch_id, 'inventory'), 'inventory', i.id, 'OPENING', now(), i.stock, i.cost || 0, 'opening', now());
  }
  for (const s of db.prepare(`SELECT id, warehouse_id, stock, cost FROM skus WHERE branch_id=? AND stock>0`).all(branch_id)) {
    if (countLots.get(branch_id, 'sku', s.id).n) continue;
    insLot.run(uid('lot_'), branch_id, s.warehouse_id || defaultWarehouseId(branch_id, 'sku'), 'sku', s.id, 'OPENING', now(), s.stock, s.cost || 0, 'opening', now());
  }
}

function bootstrapVoucherDefaults(branch_id) {
  const anySku = db.prepare(`SELECT id FROM skus WHERE branch_id=? AND active=1 LIMIT 1`).get(branch_id);
  if (!anySku) return;
  const hasVoucher = db.prepare(`SELECT COUNT(*) n FROM vouchers WHERE branch_id=?`).get(branch_id).n;
  if (hasVoucher) return;

  const choco = db.prepare(`SELECT id FROM skus WHERE branch_id=? AND id='s_choco' AND active=1`).get(branch_id)
    || db.prepare(`SELECT id FROM skus WHERE branch_id=? AND active=1 ORDER BY name LIMIT 1`).get(branch_id);
  const ts = now();
  const prefix = branch_id === 'br1' ? '' : `${String(branch_id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}_`;
  db.prepare(`INSERT OR IGNORE INTO vouchers
    (id,branch_id,code,name,type,value,scope,sku_id,min_total,active,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`${prefix}v_open10`, branch_id, 'OPEN10', 'Khai trương -10%', 'pct', 10, 'order', null, 0, 1, 'Voucher mẫu toàn bill', ts, ts);
  if (choco) {
    db.prepare(`INSERT OR IGNORE INTO vouchers
      (id,branch_id,code,name,type,value,scope,sku_id,min_total,active,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`${prefix}v_choco5`, branch_id, 'CHOCO5', 'Promo SKU giảm 5K', 'amount', 5000, 'sku', choco.id, 0, 1, 'Promo mẫu gán SKU', ts, ts);
  }
}
