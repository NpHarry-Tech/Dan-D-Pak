# Database Schema

Last updated: 2026-06-20

This is the company-server (PostgreSQL) target schema, organized by table group.
It is **append-only / history-aware** by design — see
[COMPANY_DATABASE_MEMORY.md](COMPANY_DATABASE_MEMORY.md).

- **Current**: the live SQLite schema in `server/db.js` already implements a subset
  (branches, tables, categories, warehouses, menu_items, skus, inventory_items,
  recipes, stock_lots, inventory_documents/lines, stocktake_sessions/lines,
  stock_movements, orders, order_items, vouchers, customers, payments,
  payment_lines, users, auth_sessions, print_jobs, invoices, sync_queue,
  audit_log, app_settings, shifts, cash_drawer_entries, purchase_orders/lines,
  expenses, bank_transactions).
- **Planned**: the full group list below, applied **additively** (new tables /
  new history tables). Planned PostgreSQL DDL lives in `server/db/schema/*.sql`.
- No destructive migration. New history/ledger tables are added alongside existing
  tables; renames are mapped, not dropped.

## A. Organization / Branch / Restaurant settings
organizations, branches, restaurant_profiles, restaurant_settings,
restaurant_setting_versions, table_areas, tables, table_layout_versions,
business_hours, tax_settings, service_charge_settings, receipt_templates,
kitchen_routing_rules, station_settings

## B. Users / Staff / Auth / Permissions
users, staff_profiles, roles, permissions, role_permissions, user_roles,
user_sessions, login_events, pin_credentials, password_reset_events, access_tokens,
device_sessions
> Never store plaintext password/PIN. Hash both. Audit login + permission changes.

## C. Devices / App-Web linking
devices, device_pairing_requests, device_authorizations, device_heartbeats,
device_roles, device_route_assignments, app_web_links, app_web_link_tokens,
app_web_sessions, client_installations

## D. Customers
customers, customer_contacts, customer_addresses, customer_notes,
customer_loyalty_accounts, customer_voucher_usage, customer_activity_logs

## E. Menu / Products / SKU / Pricing
menu_categories, menu_items, menu_item_options, menu_item_option_groups,
menu_item_variants, products, skus, units, recipes, recipe_items, price_books,
price_versions, price_items, price_change_logs, promotions, promotion_rules,
vouchers, voucher_redemptions, menu_availability_logs
> Price is versioned. Old orders keep old price. Do not recalc closed orders.

## F. Orders
orders, order_items, order_item_modifiers, order_status_history,
order_item_status_history, order_notes, order_discounts, order_tax_lines,
order_service_charge_lines, order_source_links, order_audit_events
> Order source: ipad_self_order, cashier_pos, web_order, grab, shopeefood,
> manual_admin, temporary_vps_buffer, offline_device_queue.

## G. KDS / Kitchen / Bar / Salad
kitchen_tickets, kitchen_ticket_items, station_queues, station_status_history,
preparation_timing_logs, kds_events

## H. Printing / Reprint logs
printers, print_jobs, print_job_items, print_templates, print_attempts,
reprint_logs
> Every print and reprint is logged.

## I. Payments / Cashbook / Bank accounts
payments, payment_lines, payment_methods, payment_status_history, refunds, voids,
cash_drawers, cash_shifts, cash_in_out, cash_count_logs, bank_accounts,
bank_account_links, bank_transfer_records, payment_terminal_configs,
payment_reconciliation_logs, payment_provider_tokens
> No bank password, no raw card data, no CVV. Encrypt bank/provider secrets. Mask
> account numbers in UI. Audit every bank/payment config change.

## J. Invoices / Tax / MISA
invoices, invoice_lines, invoice_status_history, misa_invoice_links,
invoice_exports, invoice_corrections, invoice_voids

## K. Inventory / In / Out / Stock / Purchase
warehouses, stock_locations, suppliers, purchase_orders, purchase_order_items,
goods_receipts, goods_receipt_items, inventory_movements, inventory_movement_items,
stocktake_sessions, stocktake_items, stock_adjustments, stock_transfers,
stock_transfer_items, inventory_snapshots, inventory_cost_layers
> Ledger-based. No direct quantity edit. Movement types: PURCHASE_IN, SALE_OUT,
> TRANSFER_OUT, TRANSFER_IN, STOCKTAKE_ADJUSTMENT, WASTE, DAMAGE, RETURN_IN,
> RETURN_OUT, MANUAL_ADJUSTMENT, RECIPE_CONSUMPTION.

## L. Reports / Dashboard
report_snapshots, dashboard_snapshots, sales_daily_summaries,
payment_daily_summaries, inventory_daily_summaries, kds_timing_summaries,
shift_reports
> Realtime dashboard may compute live. Official reports are based on closed
> shifts / day locks.

## M. Integrations
integrations, integration_connections, integration_tokens, integration_event_logs,
integration_sync_jobs, integration_mapping_rules, integration_webhook_logs
> Tokens/secrets encrypted. Never log full token. Audit create/rotate/delete.

## N. Offline / Sync / VPS temp buffer
VPS buffer: temporary_events, temporary_event_attempts,
temporary_event_cleanup_logs
Company server: sync_events, processed_event_ids, sync_batches, sync_conflicts,
sync_acknowledgements, offline_device_actions
> Event statuses: LOCAL_PENDING, VPS_PENDING, SYNCED, SYNC_FAILED, CONFLICT,
> EXPIRED. Event fields: event_id, branch_id, device_id, event_type,
> payload_encrypted, payload_hash, created_at, expires_at, sync_status,
> retry_count, last_sync_attempt_at, acknowledged_at. Idempotency via
> processed_event_ids.

## O. Audit / Logs / System events
audit_logs, security_logs, system_logs, data_change_logs, permission_change_logs,
config_change_logs, error_logs
> Captures who/what/when/device/IP/old-summary/new-summary/entity/reason.

## Migration safety

- Migrations are **additive**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN`, new
  history tables. No `DROP`/`TRUNCATE` of business tables.
- See `server/db/schema/` for planned DDL and `server/migrations/` for the
  migration runner plan.
