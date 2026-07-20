// SQLite layer facade for the Local Store Server.
// Heavy DB concerns live in server/db/*; keep this file as the stable import surface.
import { ensurePermanentStorage } from './services/archive.js';
import { db, DB_PATH, ROOT } from './db/connection.js';
import { now, uid } from './db/ids.js';
import {
  audit, encryptCompress, decryptDecompress, reconcileAuditFromArchive, compactAuditToMonthly,
  rehydrateAuditMonths, rehydrateAuditForQuery, purgeAuditBeyondRetention,
} from './db/audit.js';
import {
  defaultWarehouseIds, defaultWarehouseId, bootstrapBranchDefaults,
  bootstrapWarehouseDefaults, bootstrapTableDefaults,
} from './db/bootstrap.js';
import { backupDatabase, listBackups } from './db/maintenance.js';
import { runMigrations } from './db/migrations.js';

export {
  db, DB_PATH, ROOT, now, uid, audit, encryptCompress, decryptDecompress,
  reconcileAuditFromArchive, compactAuditToMonthly, rehydrateAuditMonths, rehydrateAuditForQuery,
  purgeAuditBeyondRetention, defaultWarehouseIds, defaultWarehouseId,
  bootstrapBranchDefaults, bootstrapWarehouseDefaults, bootstrapTableDefaults,
  backupDatabase, listBackups,
};
const globalDb = db;
export function migrate(targetDb = globalDb) {
  const isMaster = (targetDb === globalDb);
  const db = targetDb;
  function addColumnIfMissing(table, col, type) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`);
  }

  db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    address_detail TEXT,
    address_ward TEXT,
    address_province TEXT,
    ward_code TEXT,
    province_code TEXT,
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
    translations_json TEXT DEFAULT '{}',
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
    voucher_code TEXT,
    linked_pos_device TEXT,
    linked_printer_id TEXT
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
    lot_no TEXT,
    min_total INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    schedule_json TEXT DEFAULT '{}',
    scope_json TEXT DEFAULT '{}',
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_branch_active ON vouchers(branch_id, active, scope);

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    code TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    avatar TEXT,
    tax_code TEXT,
    company TEXT,
    address TEXT,
    address_detail TEXT,
    address_ward TEXT,
    address_province TEXT,
    ward_code TEXT,
    province_code TEXT,
    perk_type TEXT NOT NULL DEFAULT 'none',
    perk_value INTEGER NOT NULL DEFAULT 0,
    auto_invoice INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    loyalty_points INTEGER NOT NULL DEFAULT 0,
    loyalty_tier TEXT,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    last_visit_at TEXT,
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
    avatar TEXT,
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

  -- E-Invoice queue: hóa đơn điện tử gắn với order, xử lý bất đồng bộ.
  -- Tuân thủ NĐ 70/2025/NĐ-CP & TT 32/2025/TT-BTC.
  CREATE TABLE IF NOT EXISTS e_invoices (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'local',
    invoice_status TEXT NOT NULL DEFAULT 'NOT_CREATED',
    invoice_template TEXT,
    invoice_series TEXT,
    invoice_no TEXT,
    provider_invoice_id TEXT,
    tax_authority_code TEXT,
    lookup_code TEXT,
    lookup_url TEXT,
    pdf_url TEXT,
    xml_url TEXT,
    qr_data TEXT,
    idempotency_key TEXT NOT NULL,
    customer_mode TEXT NOT NULL DEFAULT 'WALK_IN',
    buyer_name TEXT,
    buyer_tax_code TEXT,
    buyer_address TEXT,
    buyer_email TEXT,
    buyer_phone TEXT,
    issued_at TEXT,
    last_sync_at TEXT,
    error_code TEXT,
    error_message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    request_snapshot TEXT,
    response_snapshot TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_einv_order ON e_invoices(order_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_einv_idempotency ON e_invoices(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_einv_status ON e_invoices(invoice_status, next_retry_at);
  CREATE INDEX IF NOT EXISTS idx_einv_branch ON e_invoices(branch_id, created_at DESC);

  -- Audit log bất biến cho mọi thao tác HĐĐT. Không cho sửa/xóa từ UI.
  CREATE TABLE IF NOT EXISTS invoice_audit_logs (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    e_invoice_id TEXT,
    actor_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    reason TEXT,
    payload_snapshot TEXT,
    response_snapshot TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inv_audit_order ON invoice_audit_logs(order_id, created_at);

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

  -- Nhật ký HỆ THỐNG hợp nhất (crash/api_error/socket/printer/payment/sync…).
  -- Khác audit_log (vệt thao tác người dùng, mã hóa + lưu 36 tháng): bảng này
  -- là log kỹ thuật giàu cột để lọc/truy vết nhanh, giữ ngắn hạn (~60 ngày).
  -- Ghi qua services/systemLogs.js — KHÔNG insert tay để đảm bảo che dữ liệu
  -- nhạy cảm (PIN/token/số thẻ) trước khi xuống đĩa.
  CREATE TABLE IF NOT EXISTS system_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    user_id TEXT,
    username TEXT,
    branch_id TEXT,
    branch_name TEXT,
    device_id TEXT,
    device_name TEXT,
    app_version TEXT,
    build_number TEXT,
    platform TEXT,
    os_version TEXT,
    screen TEXT,
    action TEXT,
    endpoint TEXT,
    method TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    request_id TEXT,
    correlation_id TEXT,
    order_id TEXT,
    table_id TEXT,
    payment_id TEXT,
    exception_type TEXT,
    stack_trace TEXT,
    extra_json TEXT,
    is_resolved INTEGER DEFAULT 0,
    resolved_at TEXT,
    resolved_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
  CREATE INDEX IF NOT EXISTS idx_system_logs_event_type ON system_logs(event_type);
  CREATE INDEX IF NOT EXISTS idx_system_logs_source ON system_logs(source);
  CREATE INDEX IF NOT EXISTS idx_system_logs_device ON system_logs(device_id);
  CREATE INDEX IF NOT EXISTS idx_system_logs_branch ON system_logs(branch_id);
  CREATE INDEX IF NOT EXISTS idx_system_logs_correlation ON system_logs(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_system_logs_resolved ON system_logs(is_resolved);

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

  -- Trả hàng nhập (KiotViet PurchaseReturns): trả hàng đã nhập về lại NCC.
  -- status: draft (Phiếu tạm) -> returned (Đã trả hàng) | cancelled (Đã hủy).
  -- Khi returned: xuất kho các dòng hàng (1 phiếu kho type 'purchase_return').
  CREATE TABLE IF NOT EXISTS purchase_returns (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    code TEXT,
    supplier_id TEXT,
    supplier_name TEXT,
    po_id TEXT,
    warehouse_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    note TEXT,
    subtotal INTEGER NOT NULL DEFAULT 0,
    vat_refund INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    refund_received INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    returned_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pr_branch ON purchase_returns(branch_id);

  CREATE TABLE IF NOT EXISTS purchase_return_lines (
    id TEXT PRIMARY KEY,
    pr_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    name TEXT,
    unit TEXT,
    qty REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0,
    lot_id TEXT,
    lot_no TEXT,
    expiry_date TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_prl_pr ON purchase_return_lines(pr_id);

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
  addColumnIfMissing('branches', 'address_detail', 'TEXT');
  addColumnIfMissing('branches', 'address_ward', 'TEXT');
  addColumnIfMissing('branches', 'address_province', 'TEXT');
  addColumnIfMissing('branches', 'ward_code', 'TEXT');
  addColumnIfMissing('branches', 'province_code', 'TEXT');
  addColumnIfMissing('users', 'avatar', 'TEXT');
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
  addColumnIfMissing('menu_items', 'translations_json', `TEXT DEFAULT '{}'`);

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
  // KiotViet product-list parity (Kho BCM): mã hàng, giá trước thuế, %VAT, thương hiệu, nhóm hàng, thời gian tạo.
  addColumnIfMissing('skus', 'code', 'TEXT');                             // Mã hàng (KiotViet SP…)
  addColumnIfMissing('skus', 'price_pre_tax', 'INTEGER');                 // Giá bán trước thuế
  addColumnIfMissing('skus', 'vat', 'REAL');                             // VAT hàng bán (%) — null = KCT
  addColumnIfMissing('skus', 'brand', 'TEXT');                            // Thương hiệu
  addColumnIfMissing('skus', 'group_path', 'TEXT');                       // Nhóm hàng (3 cấp, "A>>B>>C")
  addColumnIfMissing('skus', 'weight', 'REAL');                           // Trọng lượng
  addColumnIfMissing('skus', 'sellable', 'INTEGER NOT NULL DEFAULT 1');   // Được bán trực tiếp
  addColumnIfMissing('skus', 'created_at', 'TEXT');                       // Thời gian tạo (ISO)
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
  // E-invoice compliance (NĐ 70/2025): trạng thái HĐĐT trên order để query nhanh
  addColumnIfMissing('orders', 'einvoice_id', 'TEXT');
  addColumnIfMissing('orders', 'einvoice_status', `TEXT DEFAULT 'NOT_CREATED'`);
  addColumnIfMissing('orders', 'locked_at', 'TEXT');
  addColumnIfMissing('orders', 'voucher_id', 'TEXT');
  addColumnIfMissing('orders', 'voucher_code', 'TEXT');
  addColumnIfMissing('orders', 'linked_pos_device', 'TEXT');
  addColumnIfMissing('orders', 'linked_printer_id', 'TEXT');
  // Dấu "đã in tạm tính" cho đơn còn mở — sơ đồ bàn POS hiện trạng thái này.
  addColumnIfMissing('orders', 'prebill_printed_at', 'TEXT');
  addColumnIfMissing('payments', 'shift_id', 'TEXT');
  // Thanh toán thẻ qua máy POS (VCB SmartPOS...): lưu mã giao dịch để ĐỐI SOÁT
  // với sao kê acquirer. mode = auto (native bridge) | manual (thu ngân nhập tay) | mock.
  addColumnIfMissing('payment_lines', 'card_txn_id', 'TEXT');   // mã giao dịch của máy/acquirer
  addColumnIfMissing('payment_lines', 'card_rrn', 'TEXT');      // Retrieval Reference Number
  addColumnIfMissing('payment_lines', 'card_approval', 'TEXT'); // approval / auth code
  addColumnIfMissing('payment_lines', 'card_mask', 'TEXT');     // 4 số cuối thẻ đã che
  addColumnIfMissing('payment_lines', 'card_scheme', 'TEXT');   // VISA | MASTERCARD | NAPAS...
  addColumnIfMissing('payment_lines', 'card_terminal', 'TEXT'); // TID / tên máy
  addColumnIfMissing('payment_lines', 'card_mode', 'TEXT');     // auto | manual | mock
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
  addColumnIfMissing('customers', 'avatar', 'TEXT');
  addColumnIfMissing('customers', 'preferences', 'TEXT');
  addColumnIfMissing('customers', 'allergies', 'TEXT');
  addColumnIfMissing('customers', 'favorite_items_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('customers', 'last_profiled_at', 'TEXT');
  addColumnIfMissing('customers', 'code', 'TEXT');
  addColumnIfMissing('customers', 'address_detail', 'TEXT');
  addColumnIfMissing('customers', 'address_ward', 'TEXT');
  addColumnIfMissing('customers', 'address_province', 'TEXT');
  addColumnIfMissing('customers', 'ward_code', 'TEXT');
  addColumnIfMissing('customers', 'province_code', 'TEXT');
  addColumnIfMissing('customers', 'loyalty_points', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('customers', 'loyalty_tier', 'TEXT');
  addColumnIfMissing('customers', 'last_visit_at', 'TEXT');
  // Contacts/Partners: one directory shared by sales (customer) and purchasing (supplier).
  addColumnIfMissing('customers', 'partner_type', `TEXT NOT NULL DEFAULT 'customer'`); // customer | supplier | both
  addColumnIfMissing('customers', 'contact_person', 'TEXT'); // người liên hệ (chủ yếu cho NCC)
  addColumnIfMissing('customers', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('customers', 'auto_invoice', 'INTEGER NOT NULL DEFAULT 0');
  // Purchase payments: support paying a supplier straight from the cash drawer.
  addColumnIfMissing('purchase_payments', 'source', `TEXT NOT NULL DEFAULT 'direct'`); // drawer | direct
  addColumnIfMissing('purchase_payments', 'drawer_entry_id', 'TEXT');
  // ── Kho KiotViet hoàn thiện (2026-07-15) ────────────────────────────────────
  // Kiểm kho theo phiếu: nháp (Phiếu tạm) -> cân bằng kho (approved) | hủy.
  addColumnIfMissing('stocktake_sessions', 'code', 'TEXT');        // Mã kiểm kho KK000001
  addColumnIfMissing('stocktake_sessions', 'note', 'TEXT');
  addColumnIfMissing('stocktake_sessions', 'created_by', 'TEXT');
  addColumnIfMissing('stocktake_sessions', 'cancelled_at', 'TEXT');
  addColumnIfMissing('stocktake_lines', 'lot_no', 'TEXT');         // kiểm theo lô (file mẫu Lô 1/Lô 2…)
  addColumnIfMissing('stocktake_lines', 'expiry_date', 'TEXT');
  addColumnIfMissing('stocktake_lines', 'note', 'TEXT');
  // Phiếu kho có mã đọc được (PN/XK/CH/KK/XDNB/THN…) thay vì chỉ doc_xxx.
  addColumnIfMissing('inventory_documents', 'code', 'TEXT');
  addColumnIfMissing('inventory_documents', 'note', 'TEXT');
  addColumnIfMissing('inventory_documents', 'created_by', 'TEXT');
  // Nhập hàng: VAT nhập hàng + lô/HSD khai ngay trên dòng phiếu.
  addColumnIfMissing('purchase_orders', 'vat_amount', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('purchase_orders', 'received_at', 'TEXT');
  addColumnIfMissing('purchase_orders', 'created_by', 'TEXT');
  // Số hóa đơn đầu vào của NCC (KiotViet: "Số hóa đơn đầu vào").
  addColumnIfMissing('purchase_orders', 'invoice_no', 'TEXT');
  addColumnIfMissing('purchase_order_lines', 'lot_no', 'TEXT');
  addColumnIfMissing('purchase_order_lines', 'expiry_date', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'invoice_image', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'reimburses_entry_id', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'actor_id', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'actor_name', 'TEXT');
  addColumnIfMissing('cash_drawer_entries', 'balance_before', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('cash_drawer_entries', 'balance_after', 'INTEGER NOT NULL DEFAULT 0');

  // BẢNG GIÁ (KiotViet): nhiều bảng giá bán song song "Bảng giá chung" (=
  // skus.price). Bảng giá tạo/sửa trong Cài đặt → Kho & kênh bán; giá riêng
  // từng SKU lưu ở price_book_items — SKU không có dòng thì dùng giá chung.
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_books (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL DEFAULT 'br1',
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS price_book_items (
      book_id TEXT NOT NULL,
      sku_id TEXT NOT NULL,
      price INTEGER NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (book_id, sku_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pbi_book ON price_book_items(book_id);
  `);

  const customerBranches = db.prepare(`SELECT DISTINCT branch_id FROM customers`).all();
  const codeUpd = db.prepare(`UPDATE customers SET code=? WHERE id=? AND branch_id=?`);
  for (const b of customerBranches) {
    const branchId = b.branch_id || 'br1';
    let seq = Number(db.prepare(`
      SELECT COALESCE(MAX(CAST(SUBSTR(code, 3) AS INTEGER)), 0) AS n
      FROM customers WHERE branch_id=? AND code GLOB 'DC[0-9]*'`).get(branchId)?.n) || 0;
    const missing = db.prepare(`
      SELECT id FROM customers
      WHERE branch_id=? AND (code IS NULL OR TRIM(code)='')
      ORDER BY created_at, rowid`).all(branchId);
    for (const row of missing) codeUpd.run(`DC${String(++seq).padStart(6, '0')}`, row.id, branchId);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(branch_id, code);`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_branch_code_unique ON customers(branch_id, code) WHERE code IS NOT NULL AND code!='';`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_reimburses ON cash_drawer_entries(reimburses_entry_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_alloc_expense ON cash_drawer_reimbursement_allocations(expense_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_alloc_reimbursement ON cash_drawer_reimbursement_allocations(reimbursement_id);`);

  // ── Performance indexes — tránh full-table-scan trên các bảng hot ───────────
  // orders: tìm kiếm theo trạng thái, thời gian, chi nhánh (KDS, báo cáo, sync)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders(branch_id, status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON orders(branch_id, created_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_branch_paid ON orders(branch_id, status, paid_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_online_ref ON orders(branch_id, online_channel, online_ref) WHERE online_ref IS NOT NULL AND online_ref!='';`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_bill_no ON orders(branch_id, bill_no) WHERE bill_no IS NOT NULL;`);
  // order_items: KDS gọi mỗi vài giây; pending_confirm polling
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status, created_at);`);
  // stock_movements: báo cáo kho lọc theo chi nhánh + thời gian
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_created ON stock_movements(branch_id, created_at DESC);`);
  // stock_lots: FEFO (First Expire First Out) consumption
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_lots_fefo ON stock_lots(warehouse_id, item_type, item_id, qty_on_hand, expiry_date ASC);`);
  // audit_log: sync engine query mỗi 6 giây
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_branch_created ON audit_log(branch_id, created_at DESC);`);
  // Cold-tier lifecycle: hot_until marks a rehydrated old row (kept hot for 7 days
  // after a lookup, then re-compacted). NULL = naturally-hot recent row.
  addColumnIfMissing('audit_log', 'hot_until', 'TEXT');
  addColumnIfMissing('vouchers', 'lot_no', 'TEXT');
  addColumnIfMissing('vouchers', 'schedule_json', `TEXT DEFAULT '{}'`);
  addColumnIfMissing('vouchers', 'scope_json', `TEXT DEFAULT '{}'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_hot_until ON audit_log(hot_until);`);
  // Client log delivery is retried after lost HTTP responses. Its stable evt_ key
  // makes those retries idempotent without merging separate, real incidents.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_system_logs_client_event
    ON system_logs(COALESCE(branch_id,''), request_id)
    WHERE request_id LIKE 'evt_%';`);
  // shifts: báo cáo, dashboard
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shifts_branch_opened ON shifts(branch_id, opened_at DESC, status);`);
  // cash_drawer_entries: báo cáo két, ca
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_drawer_branch_occurred ON cash_drawer_entries(branch_id, occurred_at DESC);`);
  // print_jobs: bảng tăng vô hạn (mỗi bill/tem/ticket = 1 dòng). Thiếu 2 index này
  // thì listJobs (Phiếu in) + agent poll phải full-scan + sort cả bảng → chậm hàng
  // chục giây. idx branch+created cho danh sách; idx branch+status cho agent poll.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_branch_created ON print_jobs(branch_id, created_at DESC);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_branch_status ON print_jobs(branch_id, status, created_at);`);

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

  -- Auto-confirm thanh toán: mọi giao dịch tiền-về từ webhook ngân hàng/cổng
  -- (SePay, Casso, payOS) được ghi lại đây để (1) chống xử lý trùng, (2) đối soát.
  CREATE TABLE IF NOT EXISTS bank_transactions (
    id             TEXT PRIMARY KEY,
    provider       TEXT NOT NULL,            -- sepay | casso | payos
    external_id    TEXT,                     -- mã giao dịch của nhà cung cấp (idempotency)
    branch_id      TEXT,
    amount         INTEGER NOT NULL DEFAULT 0,
    content        TEXT,                     -- nội dung chuyển khoản / mô tả
    account_number TEXT,
    reference      TEXT,                     -- mã đối soát đã khớp (DANBILL...)
    order_id       TEXT,                     -- bill đã khớp (null nếu chưa khớp)
    status         TEXT NOT NULL DEFAULT 'received', -- received|paid|unmatched|underpaid|error|duplicate
    raw_json       TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_provider_ext ON bank_transactions(provider, external_id);
  CREATE INDEX IF NOT EXISTS idx_bank_tx_order ON bank_transactions(order_id);
  CREATE INDEX IF NOT EXISTS idx_bank_tx_time ON bank_transactions(branch_id, created_at);
  `);

  // ── Document Management System (DMS) ────────────────────────────────────────
  db.exec(`
  CREATE TABLE IF NOT EXISTS document_files (
    id              TEXT PRIMARY KEY,
    branch_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    original_name   TEXT NOT NULL,
    stored_name     TEXT NOT NULL,
    mime_type       TEXT,
    file_size       INTEGER NOT NULL DEFAULT 0,
    category        TEXT NOT NULL DEFAULT 'other',
    source          TEXT NOT NULL DEFAULT 'manual',
    related_id      TEXT,
    related_type    TEXT,
    tags_json       TEXT NOT NULL DEFAULT '[]',
    description     TEXT,
    uploaded_by     TEXT NOT NULL,
    uploaded_by_name TEXT,
    is_archived     INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_docfiles_branch   ON document_files(branch_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_docfiles_category ON document_files(branch_id, category, created_at);
  CREATE INDEX IF NOT EXISTS idx_docfiles_source   ON document_files(branch_id, source, created_at);
  `);
  addColumnIfMissing('document_files', 'content_hash', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_docfiles_content_hash ON document_files(branch_id, content_hash) WHERE content_hash IS NOT NULL AND is_archived=0;`);

  runMigrations(db);

  if (isMaster) {
    dropSyncTriggers(db);
    ensurePermanentStorage();
    bootstrapBranchDefaults();
    for (const b of db.prepare(`SELECT id FROM branches WHERE active=1 ORDER BY sort,name`).all()) {
      bootstrapWarehouseDefaults(b.id);
      bootstrapTableDefaults(b.id);
    }
    initSyncTriggers(db);
  }
}
function dropSyncTriggers(targetDb) {
  const triggers = targetDb
    .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_sync_%'`)
    .all();
  for (const { name } of triggers) {
    if (/^trg_sync_(ins|upd)_[a-z0-9_]+$/i.test(name)) {
      targetDb.exec(`DROP TRIGGER IF EXISTS ${name};`);
    }
  }
}

function initSyncTriggers(targetDb) {
  const tables = [
    { name: 'branches', key: 'id' },
    { name: 'tables', key: 'id' },
    { name: 'users', key: 'id' },
    { name: 'categories', key: 'id' },
    { name: 'menu_items', key: 'id' },
    { name: 'recipes', composite: ['menu_item_id', 'inventory_item_id'] },
    { name: 'inventory_items', key: 'id' },
    { name: 'skus', key: 'id' },
    { name: 'stock_lots', key: 'id' },
    { name: 'stock_movements', key: 'id' },
    { name: 'warehouses', key: 'id' },
    { name: 'stocktake_sessions', key: 'id' },
    { name: 'stocktake_lines', key: 'id' },
    { name: 'inventory_documents', key: 'id' },
    { name: 'inventory_document_lines', key: 'id' },
    { name: 'vouchers', key: 'id' },
    { name: 'customers', key: 'id' },
    { name: 'payments', key: 'id', hasBranch: false, orderRef: 'order_id' },
    { name: 'payment_lines', key: 'id', hasBranch: false, paymentRef: 'payment_id' },
    { name: 'orders', key: 'id' },
    { name: 'order_items', key: 'id', hasBranch: false, orderRef: 'order_id' },
    { name: 'staff_calls', key: 'id' },
    { name: 'invoices', key: 'id' },
    { name: 'e_invoices', key: 'id' },
    { name: 'invoice_audit_logs', key: 'id' },
    { name: 'audit_log', key: 'id' },
    { name: 'app_settings', composite: ['branch_id', 'key'] },
    { name: 'shifts', key: 'id' },
    { name: 'cash_drawer_entries', key: 'id' },
    { name: 'cash_drawer_reimbursement_allocations', key: 'id' },
    { name: 'purchase_orders', key: 'id' },
    { name: 'purchase_order_lines', key: 'id', hasBranch: false, poRef: 'po_id' },
    { name: 'purchase_payments', key: 'id' },
    { name: 'purchase_returns', key: 'id' },
    { name: 'purchase_return_lines', key: 'id', hasBranch: false, prRef: 'pr_id' },
    { name: 'expense_categories', key: 'id' },
    { name: 'expenses', key: 'id' },
    { name: 'enterprise_storage', composite: ['scope', 'scope_id', 'key'] },
    { name: 'user_preferences', composite: ['user_id', 'key'], hasBranch: false },
    { name: 'bank_transactions', key: 'id' },
    { name: 'print_jobs', key: 'id' },
    { name: 'document_files', key: 'id' }
  ];

  for (const t of tables) {
    const isAudit = t.name === 'audit_log';
    
    let hasBranchCol = false;
    try {
      const cols = targetDb.prepare(`PRAGMA table_info(${t.name})`).all();
      hasBranchCol = cols.some(c => c.name === 'branch_id');
    } catch {}

    let branchSql = 'COALESCE(NEW.branch_id, \'br1\')';
    if (t.name === 'branches') {
      branchSql = 'NEW.id';
    } else if (t.hasBranch === false || !hasBranchCol) {
      if (t.orderRef) {
        branchSql = `COALESCE((SELECT branch_id FROM orders WHERE id = NEW.${t.orderRef}), 'br1')`;
      } else if (t.paymentRef) {
        branchSql = `COALESCE((SELECT branch_id FROM orders WHERE id = (SELECT order_id FROM payments WHERE id = NEW.${t.paymentRef})), 'br1')`;
      } else if (t.poRef) {
        branchSql = `COALESCE((SELECT branch_id FROM purchase_orders WHERE id = NEW.${t.poRef}), 'br1')`;
      } else if (t.prRef) {
        branchSql = `COALESCE((SELECT branch_id FROM purchase_returns WHERE id = NEW.${t.prRef}), 'br1')`;
      } else {
        branchSql = `'br1'`;
      }
    }

    let refSql = '';
    if (t.key) {
      refSql = `NEW.${t.key}`;
    } else if (t.composite) {
      refSql = t.composite.map(c => `NEW.${c}`).join(` || ':' || `);
    }

    targetDb.exec(`DROP TRIGGER IF EXISTS trg_sync_ins_${t.name};`);
    targetDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_sync_ins_${t.name} AFTER INSERT ON ${t.name}
      BEGIN
        INSERT OR IGNORE INTO sync_queue (id, branch_id, kind, ref, status, created_at)
        VALUES (
          'sq_' || hex(randomblob(8)) || strftime('%s', 'now'),
          ${branchSql},
          '${t.name}',
          ${refSql},
          'pending',
          datetime('now')
        );
      END;
    `);

    if (!isAudit) {
      targetDb.exec(`DROP TRIGGER IF EXISTS trg_sync_upd_${t.name};`);
      targetDb.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_sync_upd_${t.name} AFTER UPDATE ON ${t.name}
        BEGIN
          INSERT OR IGNORE INTO sync_queue (id, branch_id, kind, ref, status, created_at)
          VALUES (
            'sq_' || hex(randomblob(8)) || strftime('%s', 'now'),
            ${branchSql},
            '${t.name}',
            ${refSql},
            'pending',
            datetime('now')
          );
        END;
      `);
    }
  }
}
