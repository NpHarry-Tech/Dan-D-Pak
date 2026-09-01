import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.SQLITE_PATH || '/data/store.db');
for (const table of ['order_items', 'sale_snapshots', 'inventory_document_lines',
  'stock_movements', 'purchase_order_lines', 'stocktake_lines']) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  console.log(`${table}: ${columns.join(',')}`);
}
console.log(JSON.stringify({
  paid: db.prepare(`SELECT COUNT(*) n FROM orders WHERE status='paid'`).get().n,
  snapshots: db.prepare(`SELECT COUNT(*) n FROM sale_snapshots`).get().n,
  paid_without_snapshot: db.prepare(`SELECT COUNT(*) n FROM orders o WHERE o.status='paid'
    AND NOT EXISTS(SELECT 1 FROM sale_snapshots s WHERE s.order_id=o.id)`).get().n,
  distinct_snapshot_orders: db.prepare(`SELECT COUNT(DISTINCT order_id) n FROM sale_snapshots`).get().n,
  order_items_without_unit_snapshot: db.prepare(`SELECT COUNT(*) n FROM order_items WHERE unit_snapshot IS NULL`).get().n,
  snapshot_triggers: db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'
    AND name LIKE 'trg_paid_order_items%' ORDER BY name`).all().map(row => row.name),
  foreign_key_violations: db.prepare(`PRAGMA foreign_key_check`).all().length,
}));
