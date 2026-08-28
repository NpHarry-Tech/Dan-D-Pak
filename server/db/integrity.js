// Logical integrity checks for the production money path. The legacy schema has
// no declared foreign keys, so PRAGMA integrity_check alone cannot see orphans.
export const CRITICAL_RELATIONS = [
  ['order_items', 'order_id', 'orders', 'id'],
  ['payments', 'order_id', 'orders', 'id'],
  ['payment_lines', 'payment_id', 'payments', 'id'],
  ['sale_snapshots', 'order_id', 'orders', 'id'],
  ['receipt_print_outbox', 'payment_id', 'payments', 'id'],
  ['e_invoices', 'order_id', 'orders', 'id'],
  ['invoice_allocations', 'order_id', 'orders', 'id'],
  ['invoice_allocations', 'e_invoice_id', 'e_invoices', 'id'],
  ['inventory_document_lines', 'document_id', 'inventory_documents', 'id'],
  ['stocktake_lines', 'session_id', 'stocktake_sessions', 'id'],
  ['purchase_order_lines', 'po_id', 'purchase_orders', 'id'],
  ['purchase_payments', 'po_id', 'purchase_orders', 'id'],
  ['purchase_returns', 'po_id', 'purchase_orders', 'id'],
  ['purchase_return_lines', 'pr_id', 'purchase_returns', 'id'],
  ['cash_drawer_reimbursement_allocations', 'reimbursement_id', 'cash_drawer_entries', 'id'],
  ['cash_drawer_reimbursement_allocations', 'expense_id', 'cash_drawer_entries', 'id'],
  ['menu_items', 'category_id', 'categories', 'id'],
  ['orders', 'table_id', 'tables', 'id'],
  ['skus', 'warehouse_id', 'warehouses', 'id'],
  ['inventory_items', 'warehouse_id', 'warehouses', 'id'],
  ['stock_lots', 'warehouse_id', 'warehouses', 'id'],
  ['inventory_documents', 'warehouse_id', 'warehouses', 'id'],
  ['inventory_documents', 'to_warehouse_id', 'warehouses', 'id'],
  ['stocktake_sessions', 'warehouse_id', 'warehouses', 'id'],
  ['stock_movements', 'warehouse_id', 'warehouses', 'id'],
  ['purchase_orders', 'warehouse_id', 'warehouses', 'id'],
  ['purchase_returns', 'warehouse_id', 'warehouses', 'id'],
  ['inventory_document_lines', 'lot_id', 'stock_lots', 'id'],
  ['stocktake_lines', 'lot_id', 'stock_lots', 'id'],
  ['stock_movements', 'lot_id', 'stock_lots', 'id'],
  ['purchase_return_lines', 'lot_id', 'stock_lots', 'id'],
];

const ident = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function scanCriticalOrphans(db, { sampleLimit = 20 } = {}) {
  const tables = new Set(db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'`,
  ).all().map((row) => row.name));
  const findings = [];
  for (const [child, childKey, parent, parentKey] of CRITICAL_RELATIONS) {
    if (!tables.has(child) || !tables.has(parent)) continue;
    const columns = new Set(db.prepare(`PRAGMA table_info(${ident(child)})`).all().map((row) => row.name));
    if (!columns.has(childKey)) continue;
    const where = `c.${ident(childKey)} IS NOT NULL AND TRIM(CAST(c.${ident(childKey)} AS TEXT))!=''
      AND NOT EXISTS (SELECT 1 FROM ${ident(parent)} p WHERE p.${ident(parentKey)}=c.${ident(childKey)})`;
    const count = db.prepare(`SELECT COUNT(*) count FROM ${ident(child)} c WHERE ${where}`).get().count;
    if (!count) continue;
    const samples = db.prepare(`SELECT c.${ident(childKey)} value FROM ${ident(child)} c
      WHERE ${where} LIMIT ?`).all(Math.max(1, Math.min(100, sampleLimit))).map((row) => row.value);
    findings.push({ child, childKey, parent, parentKey, count, samples });
  }
  return {
    ok: findings.length === 0,
    checkedRelations: CRITICAL_RELATIONS.length,
    orphanCount: findings.reduce((sum, item) => sum + Number(item.count || 0), 0),
    findings,
  };
}
