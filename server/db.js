// SQLite layer for the Local Store Server.
// The schema is migration-friendly: existing demo DBs keep working while new
// warehouse/menu fields are added in place.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { appendAuditArchive, ensurePermanentStorage } from './services/archive.js';
import { env } from './config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function resolveDbPath() {
  if (!env.SQLITE_PATH) return join(__dirname, 'store.db');
  return isAbsolute(env.SQLITE_PATH) ? env.SQLITE_PATH : resolve(ROOT, env.SQLITE_PATH);
}

export const DB_PATH = resolveDbPath();
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    code TEXT,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER DEFAULT 0,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    zone TEXT NOT NULL,
    code TEXT NOT NULL,
    seats INTEGER DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'free'
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    sort INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER DEFAULT 0,
    sales_channels_json TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT,
    image TEXT,
    description TEXT,
    price INTEGER NOT NULL,
    station TEXT NOT NULL DEFAULT 'kitchen',
    sla_minutes INTEGER DEFAULT 10,
    available INTEGER NOT NULL DEFAULT 1,
    hidden INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    ingredients_json TEXT DEFAULT '[]',
    allergens_json TEXT DEFAULT '[]',
    schedule_json TEXT DEFAULT '{"mode":"always"}',
    modifiers_json TEXT DEFAULT '[]',
    sort INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS skus (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    emoji TEXT,
    image TEXT,
    price INTEGER NOT NULL,
    cost INTEGER DEFAULT 0,
    stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'cái',
    warehouse_id TEXT,
    category TEXT,
    supplier TEXT,
    source_url TEXT,
    track_lot INTEGER NOT NULL DEFAULT 0,
    expiry_required INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'g',
    stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    warehouse_id TEXT,
    item_type TEXT NOT NULL DEFAULT 'ingredient',
    barcode TEXT,
    category TEXT,
    cost REAL DEFAULT 0,
    track_lot INTEGER NOT NULL DEFAULT 0,
    expiry_required INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS recipes (
    menu_item_id TEXT NOT NULL,
    inventory_item_id TEXT NOT NULL,
    qty REAL NOT NULL,
    PRIMARY KEY (menu_item_id, inventory_item_id)
  );

  CREATE TABLE IF NOT EXISTS stock_lots (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    lot_no TEXT NOT NULL,
    mfg_date TEXT,
    expiry_date TEXT,
    received_at TEXT NOT NULL,
    qty_on_hand REAL NOT NULL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    supplier TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE (warehouse_id, item_type, item_id, lot_no)
  );

  CREATE TABLE IF NOT EXISTS inventory_documents (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    warehouse_id TEXT,
    to_warehouse_id TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'posted',
    supplier TEXT,
    ref TEXT,
    reason TEXT,
    created_at TEXT NOT NULL,
    posted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS inventory_document_lines (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    lot_id TEXT,
    qty REAL NOT NULL,
    unit_cost REAL DEFAULT 0,
    expiry_date TEXT,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS stocktake_sessions (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'full',
    status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NOT NULL,
    approved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS stocktake_lines (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    lot_id TEXT,
    expected_qty REAL NOT NULL DEFAULT 0,
    counted_qty REAL NOT NULL DEFAULT 0,
    delta_qty REAL NOT NULL DEFAULT 0,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    inventory_item_id TEXT NOT NULL,
    type TEXT NOT NULL,
    qty REAL NOT NULL,
    ref TEXT,
    created_at TEXT NOT NULL,
    item_type TEXT,
    warehouse_id TEXT,
    lot_id TEXT,
    unit_cost REAL,
    reason TEXT,
    doc_id TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    table_id TEXT,
    channel TEXT NOT NULL DEFAULT 'dine_in',
    status TEXT NOT NULL DEFAULT 'open',
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    online_channel TEXT,
    online_ref TEXT,
    online_status TEXT,
    customer_json TEXT,
    invoice_id TEXT,
    voucher_id TEXT,
    voucher_code TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT,
    sku_id TEXT,
    name TEXT NOT NULL,
    emoji TEXT,
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    station TEXT NOT NULL DEFAULT 'kitchen',
    sla_minutes INTEGER DEFAULT 10,
    note TEXT,
    mods_json TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'new',
    lot_id TEXT,
    promo_json TEXT,
    reject_reason TEXT,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    ready_at TEXT,
    served_at TEXT
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    code TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'order',
    sku_id TEXT,
    min_total INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_branch_active ON vouchers(branch_id, active, scope);

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    tax_code TEXT,
    company TEXT,
    address TEXT,
    perk_type TEXT NOT NULL DEFAULT 'none',
    perk_value INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(branch_id);
  CREATE INDEX IF NOT EXISTS idx_customers_tax ON customers(tax_code);
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    shift_id TEXT,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_lines (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference TEXT
  );

  CREATE TABLE IF NOT EXISTS staff_calls (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    branch_id TEXT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    branch_id TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

  CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    printer TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL,
    printed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    invoice_no TEXT NOT NULL,
    lookup_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'issued',
    customer_json TEXT,
    total INTEGER NOT NULL,
    issued_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    branch_id TEXT,
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_branch_time ON audit_log(branch_id, created_at);

  CREATE TABLE IF NOT EXISTS app_settings (
    branch_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at TEXT,
    PRIMARY KEY(branch_id,key)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    shift_key TEXT,
    shift_label TEXT,
    opening_cash INTEGER NOT NULL DEFAULT 0,
    opening_count_json TEXT DEFAULT '{}',
    closing_cash INTEGER,
    closing_count_json TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at TEXT NOT NULL,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cash_drawer_entries (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    shift_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('expense','reimbursement')),
    occurred_at TEXT NOT NULL,
    counterparty TEXT,
    reason TEXT,
    product TEXT,
    invoice_image TEXT,
    reimburses_entry_id TEXT,
    note TEXT,
    actor_id TEXT,
    actor_name TEXT,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL DEFAULT 0,
    balance_after INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cash_drawer_reimbursement_allocations (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    reimbursement_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Purchase (Mua hàng): PO references a partner (supplier) and posts into the
  -- existing inventory receiving flow when goods arrive. Công nợ NCC = total - amount_paid.
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    code TEXT,
    supplier_id TEXT,
    supplier_name TEXT,
    warehouse_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    order_date TEXT,
    expected_date TEXT,
    note TEXT,
    subtotal INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_po_branch ON purchase_orders(branch_id);
  CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);

  CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id TEXT PRIMARY KEY,
    po_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    name TEXT,
    unit TEXT,
    qty REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    received_qty REAL NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_pol_po ON purchase_order_lines(po_id);

  CREATE TABLE IF NOT EXISTS purchase_payments (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    po_id TEXT NOT NULL,
    supplier_id TEXT,
    amount INTEGER NOT NULL,
    method TEXT,
    note TEXT,
    actor_name TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pp_po ON purchase_payments(po_id);

  -- Expenses (Chi phí): general business expense ledger. Two cash sources:
  --   'drawer'  -> trừ vào két ca đang mở (reuses cash_drawer_entries, linked via drawer_entry_id)
  --   'direct'  -> kế toán chi trực tiếp / chuyển khoản (không đụng két)
  CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort INTEGER DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    code TEXT,
    category_id TEXT,
    category_name TEXT,
    payee_id TEXT,
    payee_name TEXT,
    source TEXT NOT NULL DEFAULT 'direct',
    method TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    expense_date TEXT,
    note TEXT,
    invoice_image TEXT,
    drawer_entry_id TEXT,
    actor_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_exp_branch ON expenses(branch_id);
  CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date);
  `);

  // Columns added after the first demo release.
  addColumnIfMissing('orders', 'bill_no', 'TEXT');   // Số Bill nội bộ Dan{ddMMyy}{seq}, reset theo ngày
  addColumnIfMissing('branches', 'code', 'TEXT');
  addColumnIfMissing('branches', 'phone', 'TEXT');
  addColumnIfMissing('branches', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('branches', 'sort', 'INTEGER DEFAULT 0');
  addColumnIfMissing('branches', 'note', 'TEXT');
  addColumnIfMissing('users', 'branch_access_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('warehouses', 'sales_channels_json', 'TEXT');
  addColumnIfMissing('order_items', 'sku_id', 'TEXT');
  addColumnIfMissing('order_items', 'lot_id', 'TEXT');
  addColumnIfMissing('order_items', 'promo_json', 'TEXT');
  addColumnIfMissing('order_items', 'reject_reason', 'TEXT');
  addColumnIfMissing('menu_items', 'image', 'TEXT');
  addColumnIfMissing('menu_items', 'description', 'TEXT');
  addColumnIfMissing('menu_items', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('menu_items', 'deleted_at', 'TEXT');
  addColumnIfMissing('menu_items', 'ingredients_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('menu_items', 'allergens_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('menu_items', 'schedule_json', `TEXT DEFAULT '{"mode":"always"}'`);
  addColumnIfMissing('menu_items', 'addons_json', `TEXT DEFAULT '[]'`);   // combos & extras

  addColumnIfMissing('inventory_items', 'warehouse_id', 'TEXT');
  addColumnIfMissing('inventory_items', 'item_type', `TEXT NOT NULL DEFAULT 'ingredient'`);
  addColumnIfMissing('inventory_items', 'barcode', 'TEXT');
  addColumnIfMissing('inventory_items', 'category', 'TEXT');
  addColumnIfMissing('inventory_items', 'cost', 'REAL DEFAULT 0');
  addColumnIfMissing('inventory_items', 'track_lot', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('inventory_items', 'expiry_required', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('inventory_items', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('inventory_items', 'note', 'TEXT');

  addColumnIfMissing('skus', 'warehouse_id', 'TEXT');
  addColumnIfMissing('skus', 'image', 'TEXT');
  addColumnIfMissing('skus', 'category', 'TEXT');
  addColumnIfMissing('skus', 'supplier', 'TEXT');
  addColumnIfMissing('skus', 'source_url', 'TEXT');
  addColumnIfMissing('skus', 'track_lot', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('skus', 'expiry_required', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('skus', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('skus', 'units_json', `TEXT DEFAULT '[]'`);          // alt units of measure
  addColumnIfMissing('inventory_items', 'units_json', `TEXT DEFAULT '[]'`);

  addColumnIfMissing('stock_movements', 'item_type', 'TEXT');
  addColumnIfMissing('stock_movements', 'warehouse_id', 'TEXT');
  addColumnIfMissing('stock_movements', 'lot_id', 'TEXT');
  addColumnIfMissing('stock_movements', 'unit_cost', 'REAL');
  addColumnIfMissing('stock_movements', 'reason', 'TEXT');
  addColumnIfMissing('stock_movements', 'doc_id', 'TEXT');

  addColumnIfMissing('orders', 'online_channel', 'TEXT');
  addColumnIfMissing('orders', 'online_ref', 'TEXT');
  addColumnIfMissing('orders', 'online_status', 'TEXT');
  addColumnIfMissing('orders', 'customer_json', 'TEXT');
  addColumnIfMissing('orders', 'invoice_id', 'TEXT');
  addColumnIfMissing('orders', 'invoice_choice', 'TEXT');   // 'issued' | 'declined' — khách tự chọn xuất HĐ VAT hay không sau khi thanh toán
  addColumnIfMissing('orders', 'voucher_id', 'TEXT');
  addColumnIfMissing('orders', 'voucher_code', 'TEXT');
  addColumnIfMissing('payments', 'shift_id', 'TEXT');
  addColumnIfMissing('print_jobs', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('print_jobs', 'last_attempt_at', 'TEXT');
  addColumnIfMissing('print_jobs', 'error', 'TEXT');
  addColumnIfMissing('print_jobs', 'transport', 'TEXT');
  addColumnIfMissing('print_jobs', 'target', 'TEXT');
  addColumnIfMissing('print_jobs', 'reprint_of', 'TEXT');
  addColumnIfMissing('print_jobs', 'printed_by', 'TEXT');
  addColumnIfMissing('order_items', 'table_path', 'TEXT');
  addColumnIfMissing('order_items', 'kds_dismissed', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'lang', 'TEXT');
  addColumnIfMissing('customers', 'birthday', 'TEXT');
  addColumnIfMissing('customers', 'preferences', 'TEXT');
  addColumnIfMissing('customers', 'allergies', 'TEXT');
  addColumnIfMissing('customers', 'favorite_items_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('customers', 'last_profiled_at', 'TEXT');
  // Contacts/Partners: one directory shared by sales (customer) and purchasing (supplier).
  addColumnIfMissing('customers', 'partner_type', `TEXT NOT NULL DEFAULT 'customer'`); // customer | supplier | both
  addColumnIfMissing('customers', 'contact_person', 'TEXT'); // người liên hệ (chủ yếu cho NCC)
  addColumnIfMissing('customers', 'active', 'INTEGER NOT NULL DEFAULT 1');
  // Purchase payments: support paying a supplier straight from the cash drawer.
  addColumnIfMissing('purchase_payments', 'source', `TEXT NOT NULL DEFAULT 'direct'`); // drawer | direct
  addColumnIfMissing('purchase_payments', 'drawer_entry_id', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'invoice_image', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'reimburses_entry_id', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'actor_id', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'actor_name', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'balance_before', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('cash_drawer_entries', 'balance_after', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_reimburses ON cash_drawer_entries(reimburses_entry_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_alloc_expense ON cash_drawer_reimbursement_allocations(expense_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_alloc_reimbursement ON cash_drawer_reimbursement_allocations(reimbursement_id);`);

  // Enterprise storage: system-wide + branch + user scoped key-value store.
  db.exec(`
  CREATE TABLE IF NOT EXISTS enterprise_storage (
    scope      TEXT NOT NULL,
    scope_id   TEXT NOT NULL DEFAULT '',
    key        TEXT NOT NULL,
    value      TEXT,
    updated_at TEXT,
    updated_by TEXT,
    PRIMARY KEY (scope, scope_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_es_scope ON enterprise_storage(scope, scope_id);

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,
    updated_at TEXT,
    PRIMARY KEY (user_id, key)
  );
  CREATE INDEX IF NOT EXISTS idx_up_user ON user_preferences(user_id);
  `);

  ensurePermanentStorage();
  bootstrapBranchDefaults();
  for (const b of db.prepare(`SELECT id FROM branches WHERE active=1 ORDER BY sort,name`).all()) {
    bootstrapWarehouseDefaults(b.id);
    bootstrapTableDefaults(b.id);
  }
}

function addColumnIfMissing(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`);
}

export const now = () => new Date().toISOString();
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function audit(action, detail, branch_id = 'br1', actor = 'system') {
  const id = uid('a_');
  const created_at = now();
  const cleanDetail = typeof detail === 'string' ? detail : JSON.stringify(detail);
  db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, branch_id, actor, action, cleanDetail, created_at);
  appendAuditArchive({ id, branch_id, actor, action, detail: cleanDetail, created_at });
}

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

// Giữ nhật ký hoạt động trong `days` ngày gần nhất (cửa sổ trượt). Sang ngày thứ 8
// các dòng của ngày đầu tiên đã quá 7 ngày nên bị xóa. Trả về số dòng đã xóa.
export function purgeOldAudit(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`DELETE FROM audit_log WHERE created_at < ?`).run(cutoff).changes;
}

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
