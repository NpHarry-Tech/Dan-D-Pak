import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { orderReceipt } from '../services/history.js';

const apply = process.argv.includes('--apply');
const addColumn = (table, name, type) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(column => column.name === name)) {
    if (!apply) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
};

const additions = {
  order_items: [['item_code', 'TEXT'], ['item_barcode', 'TEXT'], ['unit_snapshot', 'TEXT']],
  inventory_document_lines: [['item_name', 'TEXT'], ['item_code', 'TEXT'], ['item_barcode', 'TEXT'], ['unit_snapshot', 'TEXT']],
  stock_movements: [['item_name', 'TEXT'], ['item_code', 'TEXT'], ['item_barcode', 'TEXT'], ['unit_snapshot', 'TEXT']],
  purchase_order_lines: [['item_code', 'TEXT'], ['item_barcode', 'TEXT']],
  stocktake_lines: [['item_name', 'TEXT'], ['item_code', 'TEXT'], ['item_barcode', 'TEXT'], ['unit_snapshot', 'TEXT']],
};

const missingBefore = Object.fromEntries(Object.entries(additions).map(([table, columns]) => {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  return [table, columns.map(([name]) => name).filter(name => !existing.has(name))];
}));
const paidWithoutSnapshot = db.prepare(`SELECT COUNT(*) n FROM orders o WHERE o.status='paid'
  AND NOT EXISTS(SELECT 1 FROM sale_snapshots s WHERE s.order_id=o.id)`).get().n;
console.log(JSON.stringify({ apply, missing_columns: missingBefore, paid_without_snapshot: paidWithoutSnapshot }));
if (!apply) process.exit(0);

db.exec('BEGIN IMMEDIATE');
try {
  for (const [table, columns] of Object.entries(additions)) {
    for (const [name, type] of columns) addColumn(table, name, type);
  }
  db.exec(`UPDATE order_items SET
    item_code=COALESCE(item_code,(SELECT code FROM skus WHERE skus.id=order_items.sku_id)),
    item_barcode=COALESCE(item_barcode,(SELECT barcode FROM skus WHERE skus.id=order_items.sku_id)),
    unit_snapshot=COALESCE(unit_snapshot,(SELECT unit FROM skus WHERE skus.id=order_items.sku_id),
      CASE WHEN sku_id IS NOT NULL THEN 'cái' ELSE 'phần' END);`);
  db.exec(`UPDATE inventory_document_lines SET
    item_name=COALESCE(item_name,(SELECT name FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT name FROM inventory_items WHERE item_type!='sku' AND inventory_items.id=item_id)),
    item_code=COALESCE(item_code,(SELECT code FROM skus WHERE item_type='sku' AND skus.id=item_id)),
    item_barcode=COALESCE(item_barcode,(SELECT barcode FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT barcode FROM inventory_items WHERE item_type!='sku' AND inventory_items.id=item_id)),
    unit_snapshot=COALESCE(unit_snapshot,(SELECT unit FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT unit FROM inventory_items WHERE item_type!='sku' AND inventory_items.id=item_id));`);
  db.exec(`UPDATE stock_movements SET
    item_name=COALESCE(item_name,(SELECT name FROM skus WHERE item_type='sku' AND skus.id=inventory_item_id),
      (SELECT name FROM inventory_items WHERE (item_type!='sku' OR item_type IS NULL) AND inventory_items.id=inventory_item_id)),
    item_code=COALESCE(item_code,(SELECT code FROM skus WHERE item_type='sku' AND skus.id=inventory_item_id)),
    item_barcode=COALESCE(item_barcode,(SELECT barcode FROM skus WHERE item_type='sku' AND skus.id=inventory_item_id),
      (SELECT barcode FROM inventory_items WHERE (item_type!='sku' OR item_type IS NULL) AND inventory_items.id=inventory_item_id)),
    unit_snapshot=COALESCE(unit_snapshot,(SELECT unit FROM skus WHERE item_type='sku' AND skus.id=inventory_item_id),
      (SELECT unit FROM inventory_items WHERE (item_type!='sku' OR item_type IS NULL) AND inventory_items.id=inventory_item_id));`);
  db.exec(`UPDATE purchase_order_lines SET
    item_code=COALESCE(item_code,(SELECT code FROM skus WHERE item_type='sku' AND skus.id=item_id)),
    item_barcode=COALESCE(item_barcode,(SELECT barcode FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT barcode FROM inventory_items WHERE item_type='inventory' AND inventory_items.id=item_id));`);
  db.exec(`UPDATE stocktake_lines SET
    item_name=COALESCE(item_name,(SELECT name FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT name FROM inventory_items WHERE item_type!='sku' AND inventory_items.id=item_id)),
    item_code=COALESCE(item_code,(SELECT code FROM skus WHERE item_type='sku' AND skus.id=item_id)),
    item_barcode=COALESCE(item_barcode,(SELECT barcode FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT barcode FROM inventory_items WHERE item_type!='sku' AND inventory_items.id=item_id)),
    unit_snapshot=COALESCE(unit_snapshot,(SELECT unit FROM skus WHERE item_type='sku' AND skus.id=item_id),
      (SELECT unit FROM inventory_items WHERE item_type!='sku' AND inventory_items.id=item_id));`);

  const missing = db.prepare(`SELECT o.id,o.branch_id,o.paid_at FROM orders o WHERE o.status='paid'
    AND NOT EXISTS(SELECT 1 FROM sale_snapshots s WHERE s.order_id=o.id) ORDER BY o.paid_at,o.id`).all();
  const insert = db.prepare(`INSERT INTO sale_snapshots
    (id,order_id,payment_id,branch_id,pricing_hash,snapshot_json,paid_at,business_timezone,business_date,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const order of missing) {
    const receipt = orderReceipt(order.id, order.branch_id);
    receipt.legacy_backfill = true;
    const json = JSON.stringify(receipt);
    const payment = db.prepare(`SELECT id FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1`).get(order.id);
    const paidAt = order.paid_at || receipt.paid_at || receipt.created_at || now();
    insert.run(`sale_legacy_${order.id}`, order.id, payment?.id || `legacy:${order.id}`, order.branch_id,
      crypto.createHash('sha256').update(json).digest('hex'), json, paidAt, 'Asia/Ho_Chi_Minh',
      String(paidAt).slice(0, 10), now());
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_paid_order_items_facts_immutable
    BEFORE UPDATE ON order_items
    WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.order_id AND o.status IN ('paid','void'))
      AND (NEW.name IS NOT OLD.name OR NEW.qty IS NOT OLD.qty OR NEW.unit_price IS NOT OLD.unit_price
        OR NEW.orig_price IS NOT OLD.orig_price OR NEW.vat_rate IS NOT OLD.vat_rate
        OR NEW.item_code IS NOT OLD.item_code OR NEW.item_barcode IS NOT OLD.item_barcode
        OR NEW.unit_snapshot IS NOT OLD.unit_snapshot OR NEW.menu_item_id IS NOT OLD.menu_item_id
        OR NEW.sku_id IS NOT OLD.sku_id OR NEW.mods_json IS NOT OLD.mods_json OR NEW.promo_json IS NOT OLD.promo_json)
    BEGIN SELECT RAISE(ABORT, 'paid order item facts are immutable'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_paid_order_items_no_delete BEFORE DELETE ON order_items
    WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.order_id AND o.status IN ('paid','void'))
    BEGIN SELECT RAISE(ABORT, 'paid order items cannot be deleted'); END;`);
  db.exec('COMMIT');
  console.log(JSON.stringify({ migrated: true, snapshots_created: missing.length }));
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
