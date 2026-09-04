// SQLite layer facade for the Local Store Server.
// Heavy DB concerns live in server/db/*; keep this file as the stable import surface.
import { ensurePermanentStorage } from './services/archive.js';
import { env } from './config/env.js';
import { db, DB_PATH, DB_WAS_EMPTY, ROOT } from './db/connection.js';
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
import { inTransaction } from './db/transaction.js';
import { CRITICAL_RELATIONS } from './db/integrity.js';

export {
  db, DB_PATH, DB_WAS_EMPTY, ROOT, now, uid, audit, encryptCompress, decryptDecompress,
  reconcileAuditFromArchive, compactAuditToMonthly, rehydrateAuditMonths, rehydrateAuditForQuery,
  purgeAuditBeyondRetention, defaultWarehouseIds, defaultWarehouseId,
  bootstrapBranchDefaults, bootstrapWarehouseDefaults, bootstrapTableDefaults,
  backupDatabase, listBackups, inTransaction,
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
    branch_id TEXT NOT NULL DEFAULT 'sala',
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
    branch_id TEXT NOT NULL DEFAULT 'sala',
    category_id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT,
    image TEXT,
    description TEXT,
    price INTEGER NOT NULL,
    price_includes_vat INTEGER NOT NULL DEFAULT 1,
    vat_rate REAL NOT NULL DEFAULT 8,
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
    price_includes_vat INTEGER NOT NULL DEFAULT 1,
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
    item_name TEXT,
    item_code TEXT,
    item_barcode TEXT,
    unit_snapshot TEXT,
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
    item_name TEXT,
    item_code TEXT,
    item_barcode TEXT,
    unit_snapshot TEXT,
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
    item_name TEXT,
    item_code TEXT,
    item_barcode TEXT,
    unit_snapshot TEXT,
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
    goods_amount INTEGER NOT NULL DEFAULT 0,
    vat_amount INTEGER NOT NULL DEFAULT 0,
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
    linked_printer_id TEXT,
    client_request_id TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT,
    sku_id TEXT,
    item_code TEXT,
    item_barcode TEXT,
    unit_snapshot TEXT,
    name TEXT NOT NULL,
    emoji TEXT,
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    vat_rate REAL NOT NULL DEFAULT 0,
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
    idempotency_key TEXT,
    cashier TEXT,
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_lines (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    tendered_amount INTEGER,
    reference TEXT
  );

  CREATE TABLE IF NOT EXISTS sale_snapshots (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    payment_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    pricing_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    paid_at TEXT NOT NULL,
    business_timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    business_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sale_snapshots_branch_paid
    ON sale_snapshots(branch_id, paid_at DESC);
  CREATE TRIGGER IF NOT EXISTS trg_sale_snapshots_immutable_update
    BEFORE UPDATE ON sale_snapshots BEGIN
      SELECT RAISE(ABORT, 'sale snapshot is immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS trg_sale_snapshots_immutable_delete
    BEFORE DELETE ON sale_snapshots BEGIN
      SELECT RAISE(ABORT, 'sale snapshot is immutable');
    END;

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
    printed_at TEXT,
    idempotency_key TEXT
  );

  CREATE TABLE IF NOT EXISTS receipt_print_outbox (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    payment_id TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    device_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_receipt_print_outbox_status
    ON receipt_print_outbox(status, created_at);

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
  CREATE INDEX IF NOT EXISTS idx_einv_order ON e_invoices(order_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_einv_idempotency ON e_invoices(idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_einv_status ON e_invoices(invoice_status, next_retry_at);
  CREATE INDEX IF NOT EXISTS idx_einv_branch ON e_invoices(branch_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS invoice_allocations (
    id TEXT PRIMARY KEY,
    e_invoice_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    order_item_id TEXT,
    qty REAL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inv_alloc_invoice ON invoice_allocations(e_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_inv_alloc_order ON invoice_allocations(order_id);

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
    synced_at TEXT,
    hub_id TEXT,
    sequence INTEGER,
    operation TEXT NOT NULL DEFAULT 'upsert',
    payload_json TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_hub_state (
    id INTEGER PRIMARY KEY CHECK(id=1),
    hub_id TEXT NOT NULL,
    next_sequence INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO sync_hub_state(id,hub_id,next_sequence)
    VALUES(1,'unconfigured',0);

  CREATE TABLE IF NOT EXISTS sync_inbox (
    event_id TEXT PRIMARY KEY,
    hub_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    payload_hash TEXT NOT NULL,
    received_at TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    UNIQUE(hub_id,sequence)
  );
  CREATE TABLE IF NOT EXISTS sync_apply_state (
    id INTEGER PRIMARY KEY CHECK(id=1),
    remote_apply INTEGER NOT NULL DEFAULT 0 CHECK(remote_apply IN (0,1))
  );
  INSERT OR IGNORE INTO sync_apply_state(id,remote_apply) VALUES(1,0);
  CREATE TABLE IF NOT EXISTS sync_hub_cursors (
    hub_id TEXT PRIMARY KEY,
    last_sequence INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalogue_snapshot_state (
    branch_id TEXT PRIMARY KEY,
    snapshot_hash TEXT NOT NULL,
    source_generated_at TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    branch_id TEXT,
    actor TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_branch_created ON audit_log(branch_id, created_at DESC);

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
    item_code TEXT,
    item_barcode TEXT,
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
  // MÃ ĐỐI SOÁT CHUYỂN KHOẢN — cấp NGAY khi mở đơn, khác hẳn số bill.
  //
  // Trước đây `bill_no` gánh HAI việc: vừa là số hoá đơn, vừa là nội dung
  // chuyển khoản để khớp tiền về. Vì phải có sẵn lúc khách quét QR nên nó bị
  // cấp ngay lúc mở đơn — và đơn HUỶ vẫn chiếm số, làm thủng dãy số hoá đơn
  // (vấn đề sổ sách/thuế thật, báo về 04/08/2026).
  //
  // Tách đôi: `pay_ref` cấp lúc mở đơn và chỉ dùng cho QR + đối soát ngân hàng;
  // `bill_no` để TRỐNG cho tới khi thanh toán xong. Huỷ đơn chưa trả tiền thì
  // không tiêu số nào cả.
  addColumnIfMissing('orders', 'pay_ref', 'TEXT');
  // Chỉnh giá TỪNG DÒNG (cần PIN Quản lý): unit_price = giá đã đổi; orig_price =
  // giá niêm yết gốc lúc bán → bill in được cả "giá gốc → giá sau đổi".
  addColumnIfMissing('order_items', 'orig_price', 'INTEGER');
  addColumnIfMissing('order_items', 'item_code', 'TEXT');
  addColumnIfMissing('order_items', 'item_barcode', 'TEXT');
  addColumnIfMissing('order_items', 'unit_snapshot', 'TEXT');
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
  addColumnIfMissing('menu_items', 'branch_id', "TEXT NOT NULL DEFAULT 'sala'");
  addColumnIfMissing('categories', 'branch_id', "TEXT NOT NULL DEFAULT 'sala'");
  addColumnIfMissing('orders', 'note', 'TEXT');
  addColumnIfMissing('menu_items', 'description', 'TEXT');
  addColumnIfMissing('menu_items', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('menu_items', 'deleted_at', 'TEXT');
  addColumnIfMissing('menu_items', 'ingredients_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('menu_items', 'allergens_json', `TEXT DEFAULT '[]'`);
  addColumnIfMissing('menu_items', 'schedule_json', `TEXT DEFAULT '{"mode":"always"}'`);
  addColumnIfMissing('menu_items', 'addons_json', `TEXT DEFAULT '[]'`);   // combos & extras
  addColumnIfMissing('menu_items', 'translations_json', `TEXT DEFAULT '{}'`);
  // NHÓM TÙY CHỌN hợp nhất (size/đá + topping + combo) cho Self-Order: mảng
  // [{key,name,position:top|bottom,min,max,options:[{name,price,type,ref_item_id}]}].
  addColumnIfMissing('menu_items', 'option_groups_json', `TEXT DEFAULT '[]'`);
  // Ẩn RIÊNG khỏi Tablet Self-Order (vẫn hiện ở F&B POS) — menu khách khác nội bộ.
  addColumnIfMissing('menu_items', 'self_order_hidden', 'INTEGER NOT NULL DEFAULT 0');

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
  // Giới thiệu sản phẩm — đoạn văn khách đọc trên màn catalogue ngoài quầy
  // (thành phần, xuất xứ, cách dùng). Khác `note` nội bộ: cái này KHÁCH đọc.
  addColumnIfMissing('skus', 'description', 'TEXT');
  addColumnIfMissing('skus', 'units_json', `TEXT DEFAULT '[]'`);          // alt units of measure
  // KiotViet product-list parity (Kho BCM): mã hàng, giá trước thuế, %VAT, thương hiệu, nhóm hàng, thời gian tạo.
  addColumnIfMissing('skus', 'code', 'TEXT');                             // Mã hàng (KiotViet SP…)
  addColumnIfMissing('skus', 'price_pre_tax', 'INTEGER');                 // Giá bán trước thuế
  addColumnIfMissing('skus', 'vat', 'REAL');                             // VAT hàng bán (%) — null = KCT
  addColumnIfMissing('skus', 'price_includes_vat', 'INTEGER NOT NULL DEFAULT 1');
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
  addColumnIfMissing('stock_movements', 'item_name', 'TEXT');
  addColumnIfMissing('stock_movements', 'item_code', 'TEXT');
  addColumnIfMissing('stock_movements', 'item_barcode', 'TEXT');
  addColumnIfMissing('stock_movements', 'unit_snapshot', 'TEXT');
  addColumnIfMissing('inventory_document_lines', 'item_name', 'TEXT');
  addColumnIfMissing('inventory_document_lines', 'item_code', 'TEXT');
  addColumnIfMissing('inventory_document_lines', 'item_barcode', 'TEXT');
  addColumnIfMissing('inventory_document_lines', 'unit_snapshot', 'TEXT');
  addColumnIfMissing('stocktake_lines', 'item_name', 'TEXT');
  addColumnIfMissing('stocktake_lines', 'item_code', 'TEXT');
  addColumnIfMissing('stocktake_lines', 'item_barcode', 'TEXT');
  addColumnIfMissing('stocktake_lines', 'unit_snapshot', 'TEXT');
  addColumnIfMissing('purchase_order_lines', 'item_code', 'TEXT');
  addColumnIfMissing('purchase_order_lines', 'item_barcode', 'TEXT');
  // Legacy rows can only be backfilled from today's catalogue once. New writes
  // always persist these fields at transaction time and never depend on this join.
  // migrate() is intentionally rerunnable. On the second boot the immutable
  // trigger already exists, so temporarily remove it while this startup-only
  // backfill runs; it is recreated below before the server accepts traffic.
  db.exec(`DROP TRIGGER IF EXISTS trg_paid_order_items_facts_immutable;`);
  db.exec(`UPDATE order_items SET
    item_code=COALESCE(item_code,(SELECT code FROM skus WHERE skus.id=order_items.sku_id)),
    item_barcode=COALESCE(item_barcode,(SELECT barcode FROM skus WHERE skus.id=order_items.sku_id)),
    unit_snapshot=COALESCE(unit_snapshot,
      (SELECT unit FROM skus WHERE skus.id=order_items.sku_id),
      CASE WHEN sku_id IS NOT NULL THEN 'cái' ELSE 'phần' END)
    WHERE item_code IS NULL OR item_barcode IS NULL OR unit_snapshot IS NULL;`);

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
  addColumnIfMissing('orders', 'client_request_id', 'TEXT');
  addColumnIfMissing('orders', 'goods_amount', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('orders', 'vat_amount', 'INTEGER NOT NULL DEFAULT 0');
  // Dấu "đã in tạm tính" cho đơn còn mở — sơ đồ bàn POS hiện trạng thái này.
  addColumnIfMissing('orders', 'prebill_printed_at', 'TEXT');
  addColumnIfMissing('payments', 'shift_id', 'TEXT');
  addColumnIfMissing('payments', 'idempotency_key', 'TEXT');
  // Ai THỰC SỰ bấm thanh toán dòng này — KHÁC với shifts.user_name (người MỞ ca).
  // Một ca có thể nhiều người dùng chung (BR-SHIFT-001); trước đây receipt/audit
  // join qua shifts.user_name nên mọi giao dịch trong ca hiện sai thành tên người mở ca.
  addColumnIfMissing('payments', 'cashier', 'TEXT');
  addColumnIfMissing('print_jobs', 'idempotency_key', 'TEXT');
  addColumnIfMissing('sale_snapshots', 'business_timezone', `TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh'`);
  addColumnIfMissing('sale_snapshots', 'business_date', `TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
    ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_shift_created ON payments(shift_id, created_at DESC, order_id);
    CREATE INDEX IF NOT EXISTS idx_payment_lines_payment ON payment_lines(payment_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_idempotency
      ON print_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS receipt_print_outbox (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      payment_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      device_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_print_outbox_status
      ON receipt_print_outbox(status, created_at);
    CREATE TABLE IF NOT EXISTS sale_snapshots (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      payment_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      pricing_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      paid_at TEXT NOT NULL,
      business_timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
      business_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sale_snapshots_branch_paid
      ON sale_snapshots(branch_id, paid_at DESC);
    CREATE TRIGGER IF NOT EXISTS trg_sale_snapshots_immutable_update
      BEFORE UPDATE ON sale_snapshots BEGIN
        SELECT RAISE(ABORT, 'sale snapshot is immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_sale_snapshots_immutable_delete
      BEFORE DELETE ON sale_snapshots BEGIN
        SELECT RAISE(ABORT, 'sale snapshot is immutable');
      END;
  `);
  addColumnIfMissing('payment_lines', 'tendered_amount', 'INTEGER');
  db.prepare(`UPDATE payment_lines SET tendered_amount=amount WHERE tendered_amount IS NULL`).run();
  db.exec(`
    DROP INDEX IF EXISTS idx_einv_order;
    CREATE INDEX IF NOT EXISTS idx_einv_order ON e_invoices(order_id);
    CREATE INDEX IF NOT EXISTS idx_einv_branch_order_created
      ON e_invoices(branch_id, order_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS invoice_allocations (
      id TEXT PRIMARY KEY,
      e_invoice_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      order_item_id TEXT,
      qty REAL,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inv_alloc_invoice ON invoice_allocations(e_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_inv_alloc_order ON invoice_allocations(order_id);
  `);
  const overpaidPayments = db.prepare(`
    SELECT p.id, p.total, COALESCE(SUM(pl.amount),0) paid
    FROM payments p JOIN payment_lines pl ON pl.payment_id=p.id
    GROUP BY p.id HAVING paid>p.total`).all();
  const reduceApplied = db.prepare(`UPDATE payment_lines SET amount=amount-? WHERE id=?`);
  for (const payment of overpaidPayments) {
    let excess = Math.max(0, Number(payment.paid) - Number(payment.total));
    if (!excess) continue;
    const lines = db.prepare(`SELECT id,amount FROM payment_lines WHERE payment_id=? AND amount>0 ORDER BY method='cash' DESC,rowid DESC`).all(payment.id);
    for (const line of lines) {
      const reduction = Math.min(excess, Number(line.amount));
      reduceApplied.run(reduction, line.id);
      excess -= reduction;
      if (!excess) break;
    }
  }
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
  addColumnIfMissing('order_items', 'vat_rate', 'REAL');
  addColumnIfMissing('menu_items', 'price_includes_vat', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('menu_items', 'vat_rate', 'REAL NOT NULL DEFAULT 8');
  db.prepare(`UPDATE order_items SET vat_rate=COALESCE(
    (SELECT m.vat_rate FROM menu_items m WHERE m.id=order_items.menu_item_id),
    (SELECT s.vat FROM skus s WHERE s.id=order_items.sku_id), 0)
    WHERE vat_rate IS NULL AND order_id IN (SELECT id FROM orders WHERE status='open')`).run();
  addColumnIfMissing('order_items', 'kds_dismissed', 'INTEGER DEFAULT 0');
  // SƠ ĐỒ BÀN kéo-thả: vị trí theo LƯỚI (ô x,y) + kích thước ô (w,h). -1 = CHƯA
  // xếp vị trí (nằm trong khay "bàn chưa xếp"). Khu vực là bảng RIÊNG (zones) để
  // tạo khu vực rỗng vẫn hiện, không phụ thuộc có bàn hay không.
  addColumnIfMissing('tables', 'pos_x', 'INTEGER NOT NULL DEFAULT -1');
  addColumnIfMissing('tables', 'pos_y', 'INTEGER NOT NULL DEFAULT -1');
  addColumnIfMissing('tables', 'grid_w', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('tables', 'grid_h', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('tables', 'zone_id', 'TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS zones (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_zones_branch ON zones(branch_id, sort);`);

  // ── ERP (Microsoft Dynamics 365 Business Central) — OUTBOX + MAPPING ────────
  // OUTBOX PATTERN (mission #12): POS commit thanh toán XONG mới ghi 1 sự kiện ở
  // đây; worker nền đẩy sang BC. BC down → POS VẪN BÁN, sự kiện nằm 'pending' rồi
  // retry. Idempotency bằng external_id UNIQUE: gửi 20 lần vẫn 1 document.
  db.exec(`CREATE TABLE IF NOT EXISTS erp_outbox (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    event_id TEXT,
    external_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    entity_id TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_class TEXT,
    last_error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    nav_document_no TEXT,
    nav_entry_no TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_outbox_external ON erp_outbox(external_id);
  CREATE INDEX IF NOT EXISTS idx_erp_outbox_due ON erp_outbox(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_erp_outbox_branch ON erp_outbox(branch_id, status, created_at);

  CREATE TABLE IF NOT EXISTS erp_mapping (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    pos_key TEXT NOT NULL,
    nav_value TEXT,
    extra_json TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_mapping_key ON erp_mapping(branch_id, kind, pos_key);`);
  // SEED zones từ các `tables.zone` đang có (mỗi tên khu vực → một zone) và gắn
  // zone_id cho bàn, để dữ liệu cũ tự lên mô hình mới mà không mất khu vực.
  try {
    const distinctZones = db.prepare(
      `SELECT DISTINCT branch_id, zone FROM tables WHERE zone IS NOT NULL AND TRIM(zone)<>''`).all();
    let seedSort = 0;
    for (const { branch_id: bz, zone } of distinctZones) {
      const name = String(zone).trim();
      let z = db.prepare(`SELECT id FROM zones WHERE branch_id=? AND name=?`).get(bz, name);
      if (!z) {
        const zid = 'zone_' + Math.random().toString(36).slice(2, 10);
        db.prepare(`INSERT INTO zones (id,branch_id,name,sort) VALUES (?,?,?,?)`)
          .run(zid, bz, name, seedSort++);
        z = { id: zid };
      }
      db.prepare(`UPDATE tables SET zone_id=? WHERE branch_id=? AND zone=? AND (zone_id IS NULL OR zone_id='')`)
        .run(z.id, bz, name);
    }
  } catch { /* seed best-effort, không chặn khởi động */ }
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
      branch_id TEXT NOT NULL DEFAULT 'sala',
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
    const branchId = b.branch_id || 'sala';
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_branch_history
    ON orders(branch_id, COALESCE(paid_at,created_at) DESC)
    WHERE status IN ('paid','void');`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_online_ref ON orders(branch_id, online_channel, online_ref) WHERE online_ref IS NOT NULL AND online_ref!='';`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_bill_no ON orders(branch_id, bill_no) WHERE bill_no IS NOT NULL;`);
  // MÃ ĐỐI SOÁT PHẢI DUY NHẤT. Hai đơn trùng pay_ref thì một khoản tiền chuyển
  // vào sẽ khớp nhầm đơn — khách trả tiền bàn này, hệ thống đóng bill bàn kia.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pay_ref ON orders(branch_id, pay_ref) WHERE pay_ref IS NOT NULL;`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_request ON orders(branch_id, client_request_id) WHERE client_request_id IS NOT NULL;`);
  // order_items: KDS gọi mỗi vài giây; pending_confirm polling
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status, created_at);`);
  // Once a bill is final, transaction facts answer "what was sold then" and
  // cannot follow later catalogue edits. Kitchen lifecycle fields remain mutable.
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_paid_order_items_facts_immutable
    BEFORE UPDATE ON order_items
    WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.order_id AND o.status IN ('paid','void'))
      AND (NEW.name IS NOT OLD.name OR NEW.qty IS NOT OLD.qty
        OR NEW.unit_price IS NOT OLD.unit_price OR NEW.orig_price IS NOT OLD.orig_price
        OR NEW.vat_rate IS NOT OLD.vat_rate OR NEW.item_code IS NOT OLD.item_code
        OR NEW.item_barcode IS NOT OLD.item_barcode OR NEW.unit_snapshot IS NOT OLD.unit_snapshot
        OR NEW.menu_item_id IS NOT OLD.menu_item_id OR NEW.sku_id IS NOT OLD.sku_id
        OR NEW.mods_json IS NOT OLD.mods_json OR NEW.promo_json IS NOT OLD.promo_json)
    BEGIN SELECT RAISE(ABORT, 'paid order item facts are immutable'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_paid_order_items_no_delete
    BEFORE DELETE ON order_items
    WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.order_id AND o.status IN ('paid','void'))
    BEGIN SELECT RAISE(ABORT, 'paid order items cannot be deleted'); END;`);
  // stock_movements: báo cáo kho lọc theo chi nhánh + thời gian
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_created ON stock_movements(branch_id, created_at DESC);`);
  // stock_lots: FEFO (First Expire First Out) consumption
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_lots_fefo ON stock_lots(warehouse_id, item_type, item_id, qty_on_hand, expiry_date ASC);`);
  // audit_log: sync engine query mỗi 6 giây
  // SQLite có thể quét cùng B-tree theo cả hai chiều; bản cũ tạo thêm index
  // `(branch_id,created_at)` dưới tên idx_audit_branch_time nên mọi INSERT audit
  // phải cập nhật hai cây giống nhau. Giữ một index canonical.
  db.exec(`DROP INDEX IF EXISTS idx_audit_branch_time;`);
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

  CREATE TABLE IF NOT EXISTS payment_reference_counters (
    tenant_id TEXT NOT NULL,
    payment_account_id TEXT NOT NULL,
    business_date TEXT NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,payment_account_id,business_date)
  );
  CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    payment_account_id TEXT NOT NULL,
    payment_account_number TEXT NOT NULL,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    prefix_snapshot TEXT NOT NULL,
    transfer_reference TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'WAITING',
    expires_at TEXT,
    client_request_id TEXT,
    provider TEXT,
    provider_transaction_id TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_reference
    ON payment_intents(tenant_id,payment_account_id,transfer_reference);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_client_request
    ON payment_intents(tenant_id,client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_payment_intent_order ON payment_intents(branch_id,order_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_payment_intent_waiting ON payment_intents(payment_account_id,state,created_at);
  `);

  addColumnIfMissing('bank_transactions', 'tenant_id', "TEXT NOT NULL DEFAULT 'default'");
  addColumnIfMissing('bank_transactions', 'payment_account_id', 'TEXT');
  addColumnIfMissing('bank_transactions', 'currency', "TEXT NOT NULL DEFAULT 'VND'");
  addColumnIfMissing('bank_transactions', 'content_normalized', 'TEXT');
  addColumnIfMissing('bank_transactions', 'occurred_at', 'TEXT');
  addColumnIfMissing('bank_transactions', 'matched_payment_intent_id', 'TEXT');
  addColumnIfMissing('bank_transactions', 'match_status', 'TEXT');
  addColumnIfMissing('bank_transactions', 'match_method', 'TEXT');
  addColumnIfMissing('payment_intents', 'order_revision', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('payment_intents', 'snapshot_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('payment_intents', 'created_by_user_id', 'TEXT');
  addColumnIfMissing('payment_intents', 'created_by_device_id', 'TEXT');
  addColumnIfMissing('payment_intents', 'created_by_register_id', 'TEXT');
  addColumnIfMissing('payment_intents', 'confirmation_source', 'TEXT');
  addColumnIfMissing('payment_intents', 'confirmed_by', 'TEXT');
  addColumnIfMissing('payment_intents', 'payment_id', 'TEXT');
  addColumnIfMissing('payment_intents', 'payment_line_id', 'TEXT');
  addColumnIfMissing('payment_intents', 'bill_no', 'TEXT');
  addColumnIfMissing('payment_intents', 'superseded_by', 'TEXT');
  addColumnIfMissing('payment_intents', 'cancelled_at', 'TEXT');
  addColumnIfMissing('payment_intents', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_intent_provider_tx
      ON payment_intents(provider,provider_transaction_id)
      WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_payment_intent_reference_search
      ON payment_intents(branch_id,transfer_reference);
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

  // ── Kênh ngoài / Haravan (gộp từ hệ migration có version cũ v1–v3) ──────────
  // Trước đây 3 migration này sống ở db/migrations.js (một CƠ CHẾ schema thứ hai
  // song song). Đã gộp về đây thành MỘT đường DDL idempotent duy nhất: fresh DB
  // tạo bảng đủ cột shop_domain ngay; DB cũ (migrate dở) được addColumnIfMissing
  // + DROP/CREATE index bù — mọi đường hội tụ về cùng schema. shop_domain đặt
  // CUỐI mỗi bảng để khớp đúng thứ tự cột mà ALTER ADD COLUMN (v3) sinh ra.
  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created ON sync_queue(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_done_synced    ON sync_queue(status, synced_at, created_at);

  CREATE TABLE IF NOT EXISTS external_orders (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_order_id TEXT NOT NULL,
    internal_order_id TEXT,
    external_order_code TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    raw_payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    shop_domain TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS external_customers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_customer_id TEXT NOT NULL,
    internal_customer_id TEXT,
    raw_payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    shop_domain TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS external_products (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_product_id TEXT NOT NULL,
    external_variant_id TEXT NOT NULL DEFAULT '',
    internal_product_id TEXT,
    internal_variant_id TEXT,
    sku TEXT,
    raw_payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    shop_domain TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sync_logs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    topic TEXT,
    external_id TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    raw_payload TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL,
    shop_domain TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS haravan_shops (
    id TEXT PRIMARY KEY,
    shop_domain TEXT NOT NULL UNIQUE,
    org_id TEXT,
    branch_id TEXT NOT NULL DEFAULT 'ONLINE',
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    scope TEXT,
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    expires_at TEXT,
    location_id TEXT,
    api_base TEXT NOT NULL DEFAULT 'https://apis.haravan.com',
    installed_at TEXT NOT NULL,
    updated_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    raw_payload TEXT
  );
  CREATE TABLE IF NOT EXISTS haravan_sync_state (
    id TEXT PRIMARY KEY,
    shop_domain TEXT NOT NULL,
    resource TEXT NOT NULL,
    cursor TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(shop_domain, resource)
  );
  CREATE TABLE IF NOT EXISTS online_order_state (
    order_id TEXT PRIMARY KEY,
    workflow_status TEXT NOT NULL DEFAULT 'pending',
    assignee_user_id TEXT,
    locked_at TEXT,
    last_action TEXT,
    last_action_by TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_online_order_state_workflow
    ON online_order_state(workflow_status, updated_at DESC);

  -- Dan D Pak Omni is the channel-neutral interaction domain. Providers such
  -- as Harasocial, Zalo OA or Facebook only adapt into these canonical tables;
  -- orders, customers and products remain owned by their existing domains.
  CREATE TABLE IF NOT EXISTS omni_channels (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id,provider,external_account_id)
  );
  CREATE TABLE IF NOT EXISTS omni_identities (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES omni_channels(id) ON DELETE CASCADE,
    external_user_id TEXT NOT NULL,
    customer_id TEXT,
    display_name TEXT,
    avatar_url TEXT,
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(channel_id,external_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_omni_identity_customer ON omni_identities(customer_id);
  CREATE TABLE IF NOT EXISTS omni_conversations (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    channel_id TEXT NOT NULL REFERENCES omni_channels(id) ON DELETE CASCADE,
    identity_id TEXT REFERENCES omni_identities(id) ON DELETE SET NULL,
    external_conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    assignee_user_id TEXT,
    note TEXT,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(channel_id,external_conversation_id)
  );
  CREATE INDEX IF NOT EXISTS idx_omni_inbox ON omni_conversations(branch_id,status,last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_omni_assignee ON omni_conversations(branch_id,assignee_user_id,status);
  CREATE TABLE IF NOT EXISTS omni_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES omni_conversations(id) ON DELETE CASCADE,
    external_message_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    sender_type TEXT NOT NULL DEFAULT 'customer',
    message_type TEXT NOT NULL DEFAULT 'text',
    body TEXT,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    delivery_status TEXT NOT NULL DEFAULT 'received',
    sent_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(conversation_id,external_message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_omni_messages_time ON omni_messages(conversation_id,sent_at,id);
  CREATE TABLE IF NOT EXISTS omni_tags (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color_token TEXT NOT NULL DEFAULT 'neutral',
    created_at TEXT NOT NULL,
    UNIQUE(branch_id,name)
  );
  CREATE TABLE IF NOT EXISTS omni_conversation_tags (
    conversation_id TEXT NOT NULL REFERENCES omni_conversations(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES omni_tags(id) ON DELETE CASCADE,
    PRIMARY KEY(conversation_id,tag_id)
  );
  CREATE TABLE IF NOT EXISTS omni_canned_replies (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    shortcut TEXT NOT NULL,
    body TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id,shortcut)
  );
  CREATE TABLE IF NOT EXISTS omni_conversation_orders (
    conversation_id TEXT NOT NULL REFERENCES omni_conversations(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    linked_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(conversation_id,order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_omni_order_link ON omni_conversation_orders(order_id);
  CREATE TABLE IF NOT EXISTS omni_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    event_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    UNIQUE(provider,event_key)
  );
  CREATE TABLE IF NOT EXISTS customer_purchase_ledger (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    source_order_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    reversed_at TEXT,
    UNIQUE(branch_id, source_order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_customer_purchase_ledger_customer
    ON customer_purchase_ledger(branch_id,customer_id,created_at DESC);
  `);
  // Job in được GIỮ CHỖ cho đúng một máy. Không có hai cột này thì nhiều Hardware
  // Agent cùng lấy một job và cùng in — mỗi phiếu ra hai lần. Xem pendingAgentJobs.
  addColumnIfMissing('print_jobs', 'claimed_by', 'TEXT');
  addColumnIfMissing('print_jobs', 'claimed_at', 'TEXT');
  // Đếm số lần đăng nhập sai — LƯU DB để không bị xoá sạch mỗi lần restart server,
  // và theo cả hai chiều (scope='user' | 'ip') để chặn kiểu rải đều qua nhiều tài khoản.
  db.exec(`
  CREATE TABLE IF NOT EXISTS login_failures (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    last_fail_ms INTEGER NOT NULL DEFAULT 0,
    until_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, key)
  );
  `);
  // Phiên đăng nhập gắn với THIẾT BỊ: token bị copy sang máy khác sẽ bị từ chối.
  // Cột rỗng = phiên cũ (tạo trước bản này) → gắn thiết bị ở lần dùng đầu tiên.
  addColumnIfMissing('auth_sessions', 'device_id', 'TEXT');
  // DB tạo external_*/sync_logs ở thời v2 (chưa multi-shop) sẽ thiếu shop_domain.
  addColumnIfMissing('external_orders', 'shop_domain', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('external_customers', 'shop_domain', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('external_products', 'shop_domain', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('sync_logs', 'shop_domain', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('sync_logs', 'direction', "TEXT NOT NULL DEFAULT 'inbound'");
  addColumnIfMissing('sync_logs', 'session_id', 'TEXT');
  addColumnIfMissing('sync_queue', 'hub_id', 'TEXT');
  addColumnIfMissing('sync_queue', 'sequence', 'INTEGER');
  addColumnIfMissing('sync_queue', 'operation', "TEXT NOT NULL DEFAULT 'upsert'");
  addColumnIfMissing('sync_queue', 'payload_json', 'TEXT');
  addColumnIfMissing('sync_queue', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('sync_queue', 'last_attempt_at', 'TEXT');
  addColumnIfMissing('sync_queue', 'last_error', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_hub_state (
      id INTEGER PRIMARY KEY CHECK(id=1),
      hub_id TEXT NOT NULL,
      next_sequence INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO sync_hub_state(id,hub_id,next_sequence)
      VALUES(1,'unconfigured',0);
    CREATE TABLE IF NOT EXISTS sync_inbox (
      event_id TEXT PRIMARY KEY,
      hub_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT,
      payload_hash TEXT NOT NULL,
      received_at TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      UNIQUE(hub_id,sequence)
    );
    CREATE TABLE IF NOT EXISTS sync_apply_state (
      id INTEGER PRIMARY KEY CHECK(id=1),
      remote_apply INTEGER NOT NULL DEFAULT 0 CHECK(remote_apply IN (0,1))
    );
    INSERT OR IGNORE INTO sync_apply_state(id,remote_apply) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS sync_hub_cursors (
      hub_id TEXT PRIMARY KEY,
      last_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalogue_snapshot_state (
      branch_id TEXT PRIMARY KEY,
      snapshot_hash TEXT NOT NULL,
      source_generated_at TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_hub_sequence
      ON sync_queue(hub_id,sequence) WHERE hub_id IS NOT NULL AND sequence IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sync_inbox_hub_sequence ON sync_inbox(hub_id,sequence);
  `);
  const configuredHubId = String(process.env.EDGE_HUB_ID || '').trim();
  if (configuredHubId) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(configuredHubId)) {
      throw new Error('EDGE_HUB_ID must be 3-64 safe identifier characters');
    }
    const storedHubId = String(db.prepare(`SELECT hub_id FROM sync_hub_state WHERE id=1`).get().hub_id);
    if (storedHubId !== 'unconfigured' && storedHubId !== configuredHubId) {
      throw new Error(`EDGE_HUB_ID cannot change after initialization (${storedHubId} -> ${configuredHubId})`);
    }
    db.prepare(`UPDATE sync_hub_state SET hub_id=? WHERE id=1`).run(configuredHubId);
  }
  let nextSequence = Number(db.prepare(`SELECT next_sequence FROM sync_hub_state WHERE id=1`).get().next_sequence || 0);
  const legacySyncRows = db.prepare(
    `SELECT id FROM sync_queue WHERE hub_id IS NULL OR sequence IS NULL ORDER BY created_at,rowid`,
  ).all();
  const backfillSyncRow = db.prepare(
    `UPDATE sync_queue SET hub_id=(SELECT hub_id FROM sync_hub_state WHERE id=1),sequence=? WHERE id=?`,
  );
  for (const row of legacySyncRows) backfillSyncRow.run(++nextSequence, row.id);
  db.prepare(`UPDATE sync_hub_state SET next_sequence=? WHERE id=1`).run(nextSequence);
  // Unique key external_* chuyển sang shop-scoped: gỡ index cũ (nếu còn) rồi tạo bản mới.
  db.exec(`
  DROP INDEX IF EXISTS uniq_external_order;
  DROP INDEX IF EXISTS uniq_external_customer;
  DROP INDEX IF EXISTS uniq_external_product_variant;
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_order_shop           ON external_orders(provider, shop_domain, external_order_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_customer_shop        ON external_customers(provider, shop_domain, external_customer_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_product_variant_shop ON external_products(provider, shop_domain, external_product_id, external_variant_id);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_provider_created       ON sync_logs(provider, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_queue                  ON sync_logs(provider, status, next_retry_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_provider_shop_created  ON sync_logs(provider, shop_domain, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_webhook_dedupe         ON sync_logs(provider, shop_domain, topic, external_id, created_at DESC);
  DROP INDEX IF EXISTS idx_haravan_sync_state_shop_resource;
  `);

  // Token đẩy thông báo (Firebase Cloud Messaging) — 1 dòng/thiết bị (khớp
  // device_id đã dùng ở system_logs/request headers). Token đổi (app cài lại,
  // xoá dữ liệu…) thì UPSERT theo device_id, không tích luỹ rác.
  db.exec(`
  CREATE TABLE IF NOT EXISTS device_tokens (
    id         TEXT PRIMARY KEY,
    branch_id  TEXT NOT NULL,
    device_id  TEXT NOT NULL,
    user_id    TEXT,
    platform   TEXT NOT NULL,
    fcm_token  TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(device_id)
  );
  CREATE INDEX IF NOT EXISTS idx_device_tokens_branch ON device_tokens(branch_id);
  `);

  migrateStockLotDateIdentity(db);

  if (isMaster) {
    dropSyncTriggers(db);
    migrateLegacySalaBranch(db);
    cleanupLegacyBranchSamples(db);
    initScopeGuards(db);
    ensurePermanentStorage();
    // Dữ liệu mẫu chi nhánh gốc (branch 'sala' "Dan D Pak Sala" + kho BCM + bàn)
    // là ĐẶC THÙ CỦA TENANT PRODUCTION (Chuỗi A), KHÔNG phải bất biến toàn hệ
    // thống. Tenant review (và mọi tenant mới) KHÔNG được tự sinh cấu trúc này —
    // review tự seed tối thiểu ở reviewSeed.js (branch Shopee Review Store, không
    // kho/bàn/nhân sự production-like). Tránh vi phạm cách ly tenant (§16/§42).
    if (!env.isReview) {
      bootstrapBranchDefaults();
      // Chỉ chi nhánh gốc có dữ liệu mẫu; mọi chi nhánh tạo sau phải bắt đầu trống.
      bootstrapWarehouseDefaults('sala');
      bootstrapTableDefaults('sala');
    }
    initSyncTriggers(db);
  }

  // Document registry v8 — MỞ RỘNG DMS hiện có (document_files) để trở thành chỉ
  // mục tập trung THẬT SỰ của mọi file/ảnh hệ thống tiếp nhận. Thêm cột additive:
  //  • storage_kind : 'file' = nội dung đã copy vào uploads/documents (như cũ);
  //                   'reference' = TRỎ tới cột nguồn (vd expenses.invoice_image)
  //                   để index ẢNH INLINE mà KHÔNG nhân bản blob ra đĩa.
  //  • ref_locator  : "module:field:recordId" — chỉ giải phía server, whitelist.
  //  • source_screen: nhãn màn hình/nghiệp vụ đã upload (yêu cầu §4).
  //  • is_legacy    : dữ liệu backfill thiếu metadata lịch sử → đánh dấu.
  // CREATE cột-nếu-thiếu chạy mỗi lần khởi động → additive & idempotent; DB v7
  // đang chạy tự có cột khi deploy, b169 client bỏ qua nên tương thích ngược.
  addColumnIfMissing('document_files', 'storage_kind', "TEXT NOT NULL DEFAULT 'file'");
  addColumnIfMissing('document_files', 'ref_locator', 'TEXT');
  addColumnIfMissing('document_files', 'source_screen', 'TEXT');
  addColumnIfMissing('document_files', 'is_legacy', 'INTEGER NOT NULL DEFAULT 0');
  // Trạng thái file (yêu cầu §4): 'available' | 'missing' (nội dung nguồn không
  // còn giải được). Đặt lúc đăng ký/backfill; endpoint tải cũng trả 410 khi mất.
  addColumnIfMissing('document_files', 'status', "TEXT NOT NULL DEFAULT 'available'");
  // Idempotency của backfill/upload-hook KHÔNG dùng ràng buộc UNIQUE (một bản ghi
  // nguồn có thể có nhiều file hợp lệ, và UNIQUE có thể vỡ khi tạo trên dữ liệu cũ
  // đã trùng → chặn khởi động). Thay vào đó dùng chỉ mục thường để tra "đã có
  // document cho bản ghi nguồn này chưa" rồi bỏ qua nếu có (xử lý ở tầng code).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docfiles_related
    ON document_files(branch_id, related_type, related_id);`);

  // Một authority phiên bản duy nhất cho schema hợp nhất. Bảng schema_migrations
  // cũ (nếu DB production có) chỉ còn là lịch sử; không còn runner thứ hai đọc nó.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO schema_meta(key,value,updated_at) VALUES('canonical_version','8',datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    PRAGMA user_version = 8;
  `);
  initCriticalIntegrityGuards(db);
}

function migrateStockLotDateIdentity(targetDb) {
  // SQLite rewrites trigger bodies that reference a table when ALTER TABLE ...
  // RENAME is used. The legacy uniqueness rebuild below therefore leaves the
  // integrity guard triggers pointing at the temporary table after it is
  // dropped. Remove those guards both before a fresh rebuild and when healing
  // a database left half-migrated by an interrupted v7 startup; the canonical
  // guards are recreated by initCriticalIntegrityGuards() immediately after
  // this migration.
  const staleGuards = targetDb.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='trigger' AND sql LIKE '%stock_lots_legacy_v7%'
  `).all();
  for (const { name } of staleGuards) {
    const safeName = String(name || '').replace(/"/g, '""');
    targetDb.exec(`DROP TRIGGER IF EXISTS "${safeName}"`);
  }
  const sql = String(targetDb.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_lots'`).get()?.sql || '');
  if (!/UNIQUE\s*\(\s*warehouse_id\s*,\s*item_type\s*,\s*item_id\s*,\s*lot_no\s*\)/i.test(sql)) {
    targetDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_lots_identity_date
      ON stock_lots(warehouse_id,item_type,item_id,lot_no,COALESCE(expiry_date,''),COALESCE(mfg_date,''));`);
    return;
  }
  inTransaction(() => {
    const lotGuards = targetDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='trigger' AND sql LIKE '%stock_lots%'
    `).all();
    for (const { name } of lotGuards) {
      const safeName = String(name || '').replace(/"/g, '""');
      targetDb.exec(`DROP TRIGGER IF EXISTS "${safeName}"`);
    }
    targetDb.exec(`
      ALTER TABLE stock_lots RENAME TO stock_lots_legacy_v7;
      CREATE TABLE stock_lots (
        id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, warehouse_id TEXT NOT NULL,
        item_type TEXT NOT NULL, item_id TEXT NOT NULL, lot_no TEXT NOT NULL,
        mfg_date TEXT, expiry_date TEXT, received_at TEXT NOT NULL,
        qty_on_hand REAL NOT NULL DEFAULT 0, unit_cost REAL DEFAULT 0,
        supplier TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
      );
      INSERT INTO stock_lots
        (id,branch_id,warehouse_id,item_type,item_id,lot_no,mfg_date,expiry_date,received_at,qty_on_hand,unit_cost,supplier,status,created_at)
      SELECT id,branch_id,warehouse_id,item_type,item_id,lot_no,mfg_date,expiry_date,received_at,qty_on_hand,unit_cost,supplier,status,created_at
      FROM stock_lots_legacy_v7;
      DROP TABLE stock_lots_legacy_v7;
      CREATE UNIQUE INDEX idx_stock_lots_identity_date
        ON stock_lots(warehouse_id,item_type,item_id,lot_no,COALESCE(expiry_date,''),COALESCE(mfg_date,''));
      CREATE INDEX IF NOT EXISTS idx_stock_lots_fefo
        ON stock_lots(warehouse_id,item_type,item_id,qty_on_hand,expiry_date ASC);
      CREATE INDEX IF NOT EXISTS idx_stock_lots_branch_warehouse_item
        ON stock_lots(branch_id,warehouse_id,item_type,item_id);
    `);
  });
}

function initCriticalIntegrityGuards(targetDb) {
  // Giai đoạn chuyển tiếp trước khi rebuild các bảng lớn để khai báo FOREIGN KEY:
  // chặn orphan MỚI ngay tại SQLite. Orphan lịch sử được scan/report riêng, không
  // tự xoá hay tự nối nhầm dữ liệu production.
  for (const [child, childKey, parent, parentKey] of CRITICAL_RELATIONS) {
    const safe = `${child}_${childKey}`.replace(/[^a-z0-9_]/gi, '');
    const message = `integrity:${child}.${childKey}->${parent}.${parentKey}`;
    targetDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_integrity_ins_${safe}
      BEFORE INSERT ON "${child}"
      WHEN NEW."${childKey}" IS NOT NULL AND TRIM(CAST(NEW."${childKey}" AS TEXT))!=''
        AND NOT EXISTS (SELECT 1 FROM "${parent}" WHERE "${parentKey}"=NEW."${childKey}")
      BEGIN SELECT RAISE(ABORT,'${message}'); END;
      CREATE TRIGGER IF NOT EXISTS trg_integrity_upd_${safe}
      BEFORE UPDATE OF "${childKey}" ON "${child}"
      WHEN NEW."${childKey}" IS NOT NULL AND TRIM(CAST(NEW."${childKey}" AS TEXT))!=''
        AND NOT EXISTS (SELECT 1 FROM "${parent}" WHERE "${parentKey}"=NEW."${childKey}")
      BEGIN SELECT RAISE(ABORT,'${message}'); END;
      CREATE TRIGGER IF NOT EXISTS trg_integrity_parent_del_${safe}
      BEFORE DELETE ON "${parent}"
      WHEN EXISTS (SELECT 1 FROM "${child}" WHERE "${childKey}"=OLD."${parentKey}")
      BEGIN SELECT RAISE(ABORT,'${message}:parent-delete'); END;
      CREATE TRIGGER IF NOT EXISTS trg_integrity_parent_upd_${safe}
      BEFORE UPDATE OF "${parentKey}" ON "${parent}"
      WHEN NEW."${parentKey}" IS NOT OLD."${parentKey}"
        AND EXISTS (SELECT 1 FROM "${child}" WHERE "${childKey}"=OLD."${parentKey}")
      BEGIN SELECT RAISE(ABORT,'${message}:parent-update'); END;
    `);
  }
}

function migrateLegacySalaBranch(targetDb) {
  if (!targetDb.prepare(`SELECT 1 FROM branches WHERE id='br1'`).get()) return;
  if (targetDb.prepare(`SELECT 1 FROM branches WHERE id='sala'`).get()) {
    throw new Error(`Không thể đổi branch_id br1 thành sala vì ID sala đã tồn tại.`);
  }

  targetDb.exec('BEGIN IMMEDIATE');
  try {
    const tables = targetDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='branches'
    `).all();
    for (const { name } of tables) {
      const columns = targetDb.prepare(`PRAGMA table_info("${String(name).replaceAll('"', '""')}")`).all();
      if (!columns.some(column => column.name === 'branch_id')) continue;
      targetDb.prepare(`UPDATE "${String(name).replaceAll('"', '""')}" SET branch_id='sala' WHERE branch_id='br1'`).run();
    }
    targetDb.prepare(`UPDATE branches SET id='sala', code='SALA' WHERE id='br1'`).run();

    for (const user of targetDb.prepare(`SELECT id,branch_access_json FROM users WHERE branch_access_json LIKE '%br1%'`).all()) {
      let access;
      try { access = JSON.parse(user.branch_access_json || '[]'); } catch { continue; }
      if (!Array.isArray(access)) continue;
      const migrated = [...new Set(access.map(id => id === 'br1' ? 'sala' : id))];
      targetDb.prepare(`UPDATE users SET branch_access_json=? WHERE id=?`).run(JSON.stringify(migrated), user.id);
    }
    targetDb.exec('COMMIT');
  } catch (error) {
    targetDb.exec('ROLLBACK');
    throw error;
  }
}

function cleanupLegacyBranchSamples(targetDb) {
  for (const { id: branchId } of targetDb.prepare(`SELECT id FROM branches WHERE id!='sala'`).all()) {
    const prefix = String(branchId).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    targetDb.prepare(`
      DELETE FROM tables
      WHERE branch_id=? AND id LIKE ?
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.table_id=tables.id)
        AND NOT EXISTS (SELECT 1 FROM staff_calls s WHERE s.table_id=tables.id)`)
      .run(branchId, `${prefix}_t_%`);

    for (const warehouseId of [
      `${prefix}_wh_kitchen`,
      `${prefix}_wh_retail`,
      `${prefix}_wh_showroom_bcm`,
    ]) {
      const used = targetDb.prepare(`
        SELECT
          EXISTS(SELECT 1 FROM inventory_items WHERE warehouse_id=?) OR
          EXISTS(SELECT 1 FROM skus WHERE warehouse_id=?) OR
          EXISTS(SELECT 1 FROM stock_lots WHERE warehouse_id=?) OR
          EXISTS(SELECT 1 FROM stock_movements WHERE warehouse_id=?) OR
          EXISTS(SELECT 1 FROM inventory_documents WHERE warehouse_id=? OR to_warehouse_id=?) OR
          EXISTS(SELECT 1 FROM stocktake_sessions WHERE warehouse_id=?) used`)
        .get(warehouseId, warehouseId, warehouseId, warehouseId, warehouseId, warehouseId, warehouseId).used;
      if (!used) targetDb.prepare(`DELETE FROM warehouses WHERE id=? AND branch_id=?`).run(warehouseId, branchId);
    }
  }
}

function initScopeGuards(targetDb) {
  const orphanBranches = targetDb.prepare(`
    SELECT DISTINCT m.branch_id
    FROM menu_items m
    LEFT JOIN categories c ON c.id=m.category_id AND c.branch_id=m.branch_id
    WHERE c.id IS NULL`).all();
  for (const { branch_id } of orphanBranches) {
    const categoryId = `uncategorized_${String(branch_id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
    targetDb.prepare(`INSERT OR IGNORE INTO categories (id,branch_id,name,icon,sort) VALUES (?,?,?,'🍽️',9999)`)
      .run(categoryId, branch_id, 'Chưa phân loại');
    targetDb.prepare(`
      UPDATE menu_items SET category_id=?
      WHERE branch_id=? AND NOT EXISTS (
        SELECT 1 FROM categories c WHERE c.id=menu_items.category_id AND c.branch_id=menu_items.branch_id)`)
      .run(categoryId, branch_id);
  }
  const guards = [
    ['menu_items_category', 'menu_items',
      `NEW.category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM categories c WHERE c.id=NEW.category_id AND c.branch_id=NEW.branch_id)`],
    ['skus_warehouse', 'skus',
      `NEW.warehouse_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM warehouses w WHERE w.id=NEW.warehouse_id AND w.branch_id=NEW.branch_id AND w.type='retail')`],
    ['inventory_items_warehouse', 'inventory_items',
      `NEW.warehouse_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM warehouses w WHERE w.id=NEW.warehouse_id AND w.branch_id=NEW.branch_id AND w.type='kitchen')`],
    ['stock_lots_warehouse', 'stock_lots',
      `NOT EXISTS (
        SELECT 1 FROM warehouses w WHERE w.id=NEW.warehouse_id AND w.branch_id=NEW.branch_id)`],
    ['inventory_documents_warehouse', 'inventory_documents',
      `(NEW.warehouse_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM warehouses w WHERE w.id=NEW.warehouse_id AND w.branch_id=NEW.branch_id))
       OR (NEW.to_warehouse_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM warehouses w WHERE w.id=NEW.to_warehouse_id AND w.branch_id=NEW.branch_id))`],
    ['stocktake_sessions_warehouse', 'stocktake_sessions',
      `NOT EXISTS (
        SELECT 1 FROM warehouses w WHERE w.id=NEW.warehouse_id AND w.branch_id=NEW.branch_id)`],
    ['orders_table', 'orders',
      `NEW.table_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM tables t WHERE t.id=NEW.table_id AND t.branch_id=NEW.branch_id)`],
  ];
  for (const [name, table, condition] of guards) {
    for (const operation of ['INSERT', 'UPDATE']) {
      const suffix = operation === 'INSERT' ? 'ins' : 'upd';
      targetDb.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_scope_${suffix}_${name}
        BEFORE ${operation} ON ${table}
        WHEN ${condition}
        BEGIN
          SELECT RAISE(ABORT, 'Dữ liệu không thuộc cùng chi nhánh');
        END;
      `);
    }
  }
  targetDb.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_warehouses_branch_code ON warehouses(branch_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_tables_branch_code ON tables(branch_id, code);
    CREATE INDEX IF NOT EXISTS idx_stock_lots_branch_warehouse_item
      ON stock_lots(branch_id, warehouse_id, item_type, item_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_warehouse_item
      ON stock_movements(branch_id, warehouse_id, item_type, inventory_item_id);
  `);
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
  // SAFETY: migration must never delete a pending mutation. Legacy databases
  // may contain several pending rows for one entity; keep their hub sequence
  // until each exact payload receives a durable ACK. The trigger's NOT EXISTS
  // guard below prevents new duplicates without destructive deduplication.
  // Một thực thể chỉ cần MỘT công việc pending. Trước đây ID ngẫu nhiên khiến
  // INSERT OR IGNORE không bao giờ chống trùng, tạo hàng trăm queue row dư khi
  // cùng bill/job được UPDATE liên tiếp.
  targetDb.exec(`
    DROP INDEX IF EXISTS idx_sync_queue_pending_entity;
    CREATE INDEX IF NOT EXISTS idx_sync_queue_pending_entity
      ON sync_queue(branch_id,kind,COALESCE(ref,'')) WHERE status='pending';
  `);
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
    { name: 'sale_snapshots', key: 'id' },
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
  const edgePayloadTables = new Set([
    'orders', 'order_items', 'payments', 'payment_lines',
    'sale_snapshots', 'stock_movements', 'shifts', 'customers',
    'skus', 'inventory_items', 'stock_lots',
    'cash_drawer_entries', 'cash_drawer_reimbursement_allocations',
    'tables',
  ]);

  for (const t of tables) {
    // Only complete payloads can ever be transported to Edge/VPS. Legacy
    // payload-less markers were never consumable and grew without a bound.
    if (!edgePayloadTables.has(t.name)) {
      targetDb.exec(`DROP TRIGGER IF EXISTS trg_sync_ins_${t.name};`);
      targetDb.exec(`DROP TRIGGER IF EXISTS trg_sync_upd_${t.name};`);
      continue;
    }
    const isAudit = t.name === 'audit_log';
    
    let hasBranchCol = false;
    try {
      const cols = targetDb.prepare(`PRAGMA table_info(${t.name})`).all();
      hasBranchCol = cols.some(c => c.name === 'branch_id');
    } catch {}

    let branchSql = 'COALESCE(NEW.branch_id, \'sala\')';
    if (t.name === 'branches') {
      branchSql = 'NEW.id';
    } else if (t.hasBranch === false || !hasBranchCol) {
      if (t.orderRef) {
        branchSql = `COALESCE((SELECT branch_id FROM orders WHERE id = NEW.${t.orderRef}), 'sala')`;
      } else if (t.paymentRef) {
        branchSql = `COALESCE((SELECT branch_id FROM orders WHERE id = (SELECT order_id FROM payments WHERE id = NEW.${t.paymentRef})), 'sala')`;
      } else if (t.poRef) {
        branchSql = `COALESCE((SELECT branch_id FROM purchase_orders WHERE id = NEW.${t.poRef}), 'sala')`;
      } else if (t.prRef) {
        branchSql = `COALESCE((SELECT branch_id FROM purchase_returns WHERE id = NEW.${t.prRef}), 'sala')`;
      } else {
        branchSql = `'sala'`;
      }
    }

    let refSql = '';
    if (t.key) {
      refSql = `NEW.${t.key}`;
    } else if (t.composite) {
      refSql = t.composite.map(c => `NEW.${c}`).join(` || ':' || `);
    }

    const payloadSql = edgePayloadTables.has(t.name)
      ? `json_object(${targetDb.prepare(`PRAGMA table_info(${t.name})`).all()
        .flatMap((column) => [`'${column.name}'`, `NEW.${column.name}`]).join(',')})`
      : 'NULL';
    const edgeEnabledSql = edgePayloadTables.has(t.name) ? `hub_id!='unconfigured'` : '1=1';

    const triggerBody = `
        UPDATE sync_hub_state SET next_sequence=next_sequence+1
        WHERE id=1 AND ${edgeEnabledSql} AND NOT EXISTS (
          SELECT 1 FROM sync_queue
          WHERE branch_id=${branchSql} AND kind='${t.name}'
            AND COALESCE(ref,'')=COALESCE(${refSql},'') AND status='pending'
        );
        INSERT INTO sync_queue (
          id,branch_id,kind,ref,status,created_at,hub_id,sequence,operation,payload_json
        )
        SELECT
          'sq_' || hex(randomblob(8)) || strftime('%s', 'now'),
          ${branchSql},'${t.name}',${refSql},'pending',datetime('now'),
          hub_id,next_sequence,'upsert',${payloadSql}
        FROM sync_hub_state WHERE id=1 AND ${edgeEnabledSql}
          AND NOT EXISTS (
            SELECT 1 FROM sync_queue
            WHERE branch_id=${branchSql} AND kind='${t.name}'
              AND COALESCE(ref,'')=COALESCE(${refSql},'') AND status='pending'
          );
        UPDATE sync_queue
        SET payload_json=${payloadSql},operation='upsert',created_at=datetime('now'),
            last_error=NULL
        WHERE branch_id=${branchSql} AND kind='${t.name}'
          AND COALESCE(ref,'')=COALESCE(${refSql},'') AND status='pending';`;

    targetDb.exec(`DROP TRIGGER IF EXISTS trg_sync_ins_${t.name};`);
    targetDb.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_sync_ins_${t.name} AFTER INSERT ON ${t.name}
      WHEN (SELECT remote_apply FROM sync_apply_state WHERE id=1)=0
      BEGIN
        ${triggerBody}
      END;
    `);

    if (!isAudit) {
      targetDb.exec(`DROP TRIGGER IF EXISTS trg_sync_upd_${t.name};`);
      targetDb.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_sync_upd_${t.name} AFTER UPDATE ON ${t.name}
        WHEN (SELECT remote_apply FROM sync_apply_state WHERE id=1)=0
        BEGIN
          ${triggerBody}
        END;
      `);
    }
  }
}
