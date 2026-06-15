// SQLite layer for the Local Store Server.
// The schema is migration-friendly: existing demo DBs keep working while new
// warehouse/menu fields are added in place.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(__dirname, 'store.db');

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT
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
    sort INTEGER DEFAULT 0
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
  `);

  // Columns added after the first demo release.
  addColumnIfMissing('orders', 'bill_no', 'TEXT');   // Số Bill nội bộ Dan{ddMMyy}{seq}, reset theo ngày
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
  addColumnIfMissing('orders', 'voucher_id', 'TEXT');
  addColumnIfMissing('orders', 'voucher_code', 'TEXT');
  addColumnIfMissing('payments', 'shift_id', 'TEXT');

  bootstrapWarehouseDefaults();
}

function addColumnIfMissing(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`);
}

export const now = () => new Date().toISOString();
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function audit(action, detail, branch_id = 'br1', actor = 'system') {
  db.prepare(`INSERT INTO audit_log (id,branch_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('a_'), branch_id, actor, action, typeof detail === 'string' ? detail : JSON.stringify(detail), now());
}

export function bootstrapWarehouseDefaults(branch_id = 'br1') {
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,code,name,type,sort) VALUES (?,?,?,?,?,?)`)
    .run('wh_kitchen', branch_id, 'KITCHEN', 'Kho bếp / nguyên liệu & vật dụng', 'kitchen', 1);
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,code,name,type,sort) VALUES (?,?,?,?,?,?)`)
    .run('wh_retail', branch_id, 'BCM', 'Kho BCM', 'retail', 2);
  db.prepare(`UPDATE warehouses SET code='BCM', name='Kho BCM', type='retail', active=1, sort=2 WHERE id='wh_retail' AND branch_id=? AND (code='RETAIL' OR name LIKE '%retail%')`)
    .run(branch_id);
  db.prepare(`INSERT OR IGNORE INTO warehouses (id,branch_id,code,name,type,sort) VALUES (?,?,?,?,?,?)`)
    .run('wh_showroom_bcm', branch_id, 'SHOWROOM_BCM', 'Showroom BCM', 'retail', 3);

  db.prepare(`UPDATE inventory_items SET warehouse_id=COALESCE(warehouse_id,'wh_kitchen'), item_type=COALESCE(item_type,'ingredient'), active=COALESCE(active,1) WHERE branch_id=?`)
    .run(branch_id);
  db.prepare(`UPDATE skus SET warehouse_id=COALESCE(warehouse_id,'wh_retail'), active=COALESCE(active,1) WHERE branch_id=?`)
    .run(branch_id);
  db.prepare(`UPDATE menu_items SET ingredients_json=COALESCE(ingredients_json,'[]'), allergens_json=COALESCE(allergens_json,'[]'), schedule_json=COALESCE(schedule_json,'{"mode":"always"}'), hidden=COALESCE(hidden,0)`)
    .run();

  backfillMovementMeta(branch_id);
  createOpeningLots(branch_id);
  bootstrapVoucherDefaults(branch_id);
}

function backfillMovementMeta(branch_id) {
  const rows = db.prepare(`SELECT id, inventory_item_id FROM stock_movements WHERE branch_id=? AND item_type IS NULL`).all(branch_id);
  const upd = db.prepare(`UPDATE stock_movements SET item_type=?, warehouse_id=? WHERE id=?`);
  for (const r of rows) {
    const inv = db.prepare(`SELECT warehouse_id FROM inventory_items WHERE id=?`).get(r.inventory_item_id);
    const sku = inv ? null : db.prepare(`SELECT warehouse_id FROM skus WHERE id=?`).get(r.inventory_item_id);
    upd.run(inv ? 'inventory' : 'sku', inv?.warehouse_id || sku?.warehouse_id || (inv ? 'wh_kitchen' : 'wh_retail'), r.id);
  }
}

function createOpeningLots(branch_id) {
  const countLots = db.prepare(`SELECT COUNT(*) n FROM stock_lots WHERE branch_id=? AND item_type=? AND item_id=?`);
  const insLot = db.prepare(`INSERT OR IGNORE INTO stock_lots
    (id,branch_id,warehouse_id,item_type,item_id,lot_no,received_at,qty_on_hand,unit_cost,supplier,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`);

  for (const i of db.prepare(`SELECT id, warehouse_id, stock, cost FROM inventory_items WHERE branch_id=? AND stock>0`).all(branch_id)) {
    if (countLots.get(branch_id, 'inventory', i.id).n) continue;
    insLot.run(uid('lot_'), branch_id, i.warehouse_id || 'wh_kitchen', 'inventory', i.id, 'OPENING', now(), i.stock, i.cost || 0, 'opening', now());
  }
  for (const s of db.prepare(`SELECT id, warehouse_id, stock, cost FROM skus WHERE branch_id=? AND stock>0`).all(branch_id)) {
    if (countLots.get(branch_id, 'sku', s.id).n) continue;
    insLot.run(uid('lot_'), branch_id, s.warehouse_id || 'wh_retail', 'sku', s.id, 'OPENING', now(), s.stock, s.cost || 0, 'opening', now());
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
  db.prepare(`INSERT OR IGNORE INTO vouchers
    (id,branch_id,code,name,type,value,scope,sku_id,min_total,active,note,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('v_open10', branch_id, 'OPEN10', 'Khai trương -10%', 'pct', 10, 'order', null, 0, 1, 'Voucher mẫu toàn bill', ts, ts);
  if (choco) {
    db.prepare(`INSERT OR IGNORE INTO vouchers
      (id,branch_id,code,name,type,value,scope,sku_id,min_total,active,note,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('v_choco5', branch_id, 'CHOCO5', 'Promo SKU giảm 5K', 'amount', 5000, 'sku', choco.id, 0, 1, 'Promo mẫu gán SKU', ts, ts);
  }
}
