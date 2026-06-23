-- Dan-D-Pak company server - PLANNED full company-memory schema (PostgreSQL target)
-- Source of truth: private company server only.
--
-- SAFETY: additive/idempotent only. No DROP, TRUNCATE, destructive rename, or
-- production auto-run. This file fills the canonical table groups from
-- docs/DATABASE_SCHEMA.md so PostgreSQL can become the permanent memory of the
-- restaurant during the reviewed migration phase.

BEGIN;

-- ===========================================================================
-- A. Organization / Branch / Restaurant settings
-- ===========================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  code TEXT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS restaurant_profiles (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  logo_ref TEXT,
  theme_json JSONB,
  profile_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS restaurant_settings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_settings_branch_key
  ON restaurant_settings (branch_id, setting_key);

CREATE TABLE IF NOT EXISTS table_areas (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  area_id TEXT,
  code TEXT NOT NULL,
  name TEXT,
  seats INTEGER,
  status TEXT NOT NULL DEFAULT 'free',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_branch_code
  ON tables (branch_id, code);

CREATE TABLE IF NOT EXISTS business_hours (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  open_time TEXT,
  close_time TEXT,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_settings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  tax_name TEXT,
  tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  included BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_charge_settings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  charge_name TEXT,
  rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_templates (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  template_type TEXT NOT NULL,
  name TEXT NOT NULL,
  body_json JSONB NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kitchen_routing_rules (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  source_type TEXT,
  category_id TEXT,
  item_id TEXT,
  station TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS station_settings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  station TEXT NOT NULL,
  label TEXT,
  printer_id TEXT,
  sla_seconds INTEGER,
  config_json JSONB,
  status TEXT NOT NULL DEFAULT 'active'
);

-- ===========================================================================
-- B. Users / Staff / Auth / Permissions
-- ===========================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  branch_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
  ON users (username);

CREATE TABLE IF NOT EXISTS staff_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  employee_code TEXT,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  title TEXT,
  region_scope_json JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT DEFAULT 'branch',
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_code
  ON roles (code);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  module TEXT,
  description TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_code
  ON permissions (code);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  granted_by TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  branch_id TEXT,
  granted_by TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_active_scope
  ON user_roles (user_id, role_id, (COALESCE(branch_id, 'global')))
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  branch_id TEXT,
  device_id TEXT,
  token_hash TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS login_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT,
  branch_id TEXT,
  device_id TEXT,
  result TEXT NOT NULL,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pin_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'argon2id',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS password_reset_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT,
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scope_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- ===========================================================================
-- C. Devices / App-Web linking
-- ===========================================================================
CREATE TABLE IF NOT EXISTS device_authorizations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  authorized_role TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  permissions_json JSONB
);

CREATE TABLE IF NOT EXISTS device_route_assignments (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  route_type TEXT NOT NULL,
  route_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_web_sessions (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  device_id TEXT,
  branch_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_installations (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  install_fingerprint_hash TEXT,
  app_version TEXT,
  platform TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

-- ===========================================================================
-- D. Customers
-- ===========================================================================
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_code TEXT,
  company TEXT,
  privacy_flags_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  label TEXT,
  address TEXT NOT NULL,
  ward TEXT,
  district TEXT,
  city TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_loyalty_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  points_balance INTEGER NOT NULL DEFAULT 0,
  tier TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_voucher_usage (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  voucher_id TEXT,
  order_id TEXT,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_activity_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id TEXT,
  branch_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- E. Menu / Products / SKU / Pricing
-- ===========================================================================
CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  category_id TEXT,
  name TEXT NOT NULL,
  sku_id TEXT,
  station TEXT,
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS menu_item_option_groups (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_item_options (
  id TEXT PRIMARY KEY,
  option_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_delta NUMERIC(14,2) NOT NULL DEFAULT 0,
  sku_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS menu_item_variants (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sku_id TEXT,
  price_delta NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'stock',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  ratio_to_base NUMERIC(14,6) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS skus (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  code TEXT NOT NULL,
  barcode TEXT,
  unit_id TEXT,
  cost_method TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_skus_barcode ON skus (barcode);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  yield_qty NUMERIC(14,4) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty NUMERIC(14,4) NOT NULL,
  unit_id TEXT
);

CREATE TABLE IF NOT EXISTS price_books (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_items (
  id TEXT PRIMARY KEY,
  price_book_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  price NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  config_json JSONB
);

CREATE TABLE IF NOT EXISTS promotion_rules (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  rule_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  branch_id TEXT,
  value_type TEXT,
  value NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers (code);

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL,
  order_id TEXT,
  customer_id TEXT,
  redeemed_by TEXT,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_availability_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  branch_id TEXT,
  availability TEXT NOT NULL,
  reason TEXT,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- F. Orders
-- ===========================================================================
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  order_no TEXT NOT NULL,
  table_id TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  customer_id TEXT,
  staff_id TEXT,
  device_id TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  service_charge_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_branch_no ON orders (branch_id, order_no);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  menu_item_id TEXT,
  sku_id TEXT,
  name_snapshot TEXT NOT NULL,
  price_snapshot NUMERIC(14,2) NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  station TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL,
  option_id TEXT,
  name_snapshot TEXT NOT NULL,
  price_delta_snapshot NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_notes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_discounts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_tax_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  tax_name TEXT NOT NULL,
  tax_rate NUMERIC(8,4) NOT NULL,
  amount NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS order_service_charge_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  charge_name TEXT NOT NULL,
  rate NUMERIC(8,4) NOT NULL,
  amount NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS order_source_links (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  device_id TEXT,
  reason TEXT,
  summary_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- G. KDS / Kitchen / Bar / Salad
-- ===========================================================================
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  station TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS station_queues (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  station TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS station_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station TEXT NOT NULL,
  branch_id TEXT,
  status TEXT NOT NULL,
  device_id TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kds_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id TEXT,
  station TEXT,
  ticket_id TEXT,
  event_type TEXT NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- H. Printing / Reprint logs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS printers (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  name TEXT NOT NULL,
  route TEXT,
  connection_type TEXT NOT NULL,
  connection_json JSONB,
  cash_drawer_enabled BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_templates (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  template_type TEXT NOT NULL,
  name TEXT NOT NULL,
  body_json JSONB NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  printer_id TEXT,
  job_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json JSONB,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS print_job_items (
  id TEXT PRIMARY KEY,
  print_job_id TEXT NOT NULL,
  item_type TEXT,
  item_id TEXT,
  payload_json JSONB
);

-- ===========================================================================
-- I. Payments / Cashbook / Bank accounts
-- ===========================================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT,
  config_json JSONB,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_lines (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  method TEXT NOT NULL,
  provider TEXT,
  amount NUMERIC(14,2) NOT NULL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT,
  order_id TEXT,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voids (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  voided_by TEXT,
  voided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_drawers (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  printer_id TEXT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  drawer_id TEXT,
  opened_by TEXT,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by TEXT,
  closing_cash NUMERIC(14,2),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cash_in_out (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_count_logs (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  counted_by TEXT,
  denominations_json JSONB,
  expected_amount NUMERIC(14,2),
  counted_amount NUMERIC(14,2),
  variance NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_account_links (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bank_transfer_records (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  provider TEXT,
  external_id TEXT,
  account_masked TEXT,
  amount NUMERIC(14,2) NOT NULL,
  content TEXT,
  matched_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched',
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transfer_provider_ext
  ON bank_transfer_records (provider, external_id);

CREATE TABLE IF NOT EXISTS payment_terminal_configs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  terminal_label TEXT,
  config_encrypted BYTEA,
  metadata_json JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_reconciliation_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id TEXT,
  provider TEXT,
  payment_id TEXT,
  bank_transfer_id TEXT,
  result TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- J. Invoices / Tax / MISA
-- ===========================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  branch_id TEXT NOT NULL,
  invoice_no TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  tax_code TEXT,
  buyer_name TEXT,
  buyer_email TEXT,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,2) NOT NULL,
  tax_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  status TEXT NOT NULL,
  changed_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS misa_invoice_links (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  misa_ref TEXT,
  lookup_code TEXT,
  status TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_exports (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  provider TEXT,
  export_status TEXT NOT NULL,
  exported_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_corrections (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  correction_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  corrected_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_voids (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  voided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- K. Inventory / In / Out / Stock / Purchase
-- ===========================================================================
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  warehouse_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS stock_locations (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_code TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  supplier_id TEXT,
  po_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  supplier_id TEXT,
  purchase_order_id TEXT,
  receipt_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  received_by TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id TEXT PRIMARY KEY,
  goods_receipt_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  unit_cost NUMERIC(14,2),
  lot_no TEXT,
  expiry_date DATE
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT,
  movement_type TEXT NOT NULL,
  reason TEXT,
  reference_type TEXT,
  reference_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_movement_items (
  id TEXT PRIMARY KEY,
  movement_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  unit_id TEXT,
  before_qty NUMERIC(14,3),
  after_qty NUMERIC(14,3),
  lot_no TEXT,
  expiry_date DATE
);

CREATE TABLE IF NOT EXISTS stocktake_sessions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_by TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by TEXT,
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  expected_qty NUMERIC(14,3),
  counted_qty NUMERIC(14,3),
  variance_qty NUMERIC(14,3),
  counted_by TEXT,
  counted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  movement_id TEXT,
  reason TEXT NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  from_warehouse_id TEXT NOT NULL,
  to_warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  warehouse_id TEXT,
  sku_id TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_cost_layers (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  source_movement_item_id TEXT,
  qty_in NUMERIC(14,3) NOT NULL DEFAULT 0,
  qty_remaining NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- L. Reports / Dashboard
-- ===========================================================================
CREATE TABLE IF NOT EXISTS report_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_daily_summaries (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  gross_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_daily_summaries (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  method TEXT NOT NULL,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_daily_summaries (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  sku_id TEXT NOT NULL,
  opening_qty NUMERIC(14,3),
  in_qty NUMERIC(14,3),
  out_qty NUMERIC(14,3),
  closing_qty NUMERIC(14,3)
);

CREATE TABLE IF NOT EXISTS kds_timing_summaries (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  station TEXT NOT NULL,
  avg_seconds INTEGER,
  late_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shift_reports (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  closed_by TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- M. Integrations
-- ===========================================================================
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  integration_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  integration_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  config_json JSONB,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_tokens (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  token_encrypted BYTEA,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_event_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id TEXT,
  event_type TEXT NOT NULL,
  result TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS integration_mapping_rules (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  local_entity TEXT NOT NULL,
  external_entity TEXT NOT NULL,
  mapping_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS integration_webhook_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id TEXT,
  provider TEXT,
  event_id TEXT,
  event_type TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  result TEXT,
  body_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- N. Offline / Sync / Company-side device queue
-- ===========================================================================
CREATE TABLE IF NOT EXISTS sync_batches (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  event_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sync_acknowledgements (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offline_device_actions (
  id TEXT PRIMARY KEY,
  branch_id TEXT,
  device_id TEXT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'LOCAL_PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ
);

-- ===========================================================================
-- O. Audit / Logs / System events
-- ===========================================================================
CREATE TABLE IF NOT EXISTS security_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id TEXT,
  actor TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  ip TEXT,
  device_id TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_change_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  actor TEXT,
  old_summary TEXT,
  new_summary TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service TEXT,
  error_code TEXT,
  message TEXT NOT NULL,
  stack_hash TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
