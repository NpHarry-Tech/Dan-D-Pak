# VPS Migration Plan

Last updated: 2026-06-18

## Phase 0: Protect Data

- Expand `.gitignore`.
- Remove DB/archive files from git index only.
- Create verified backup of SQLite and permanent storage.
- Document current schema and route behavior.

## Phase 1: VPS Scaffold

- Deploy current Node app behind Caddy.
- Keep current SQLite mode until Postgres adapter is implemented.
- Verify health, API, native-app connectivity, and Socket.IO.

## Phase 2: PostgreSQL Schema

- Create migrations for branches, devices, users, roles, permissions, role_permissions, user_roles, menu_items, products, inventory_movements, orders, order_items, payments, kitchen_tickets, customers, invoices, audit_logs, reports_snapshots, price_versions, promotions, and vouchers.
- Preserve append-safe rules for orders, payments, invoices, inventory movements, and audit logs.

## Phase 3: Data Migration

- Export SQLite data from a backup copy.
- Transform into PostgreSQL schema.
- Import to staging Postgres.
- Reconcile counts and totals.
- Run workflow tests.

## Phase 4: Provider Switch

- Set `DATABASE_PROVIDER=postgres` only after adapter tests pass.
- Deploy to staging first.
- Run end-to-end iPad/POS/KDS/payment/report tests.
- Take final production backup before cutover.

## Phase 5: Production Cutover

- Freeze writes briefly.
- Backup SQLite and permanent storage.
- Run migration.
- Switch env.
- Start app.
- Verify health and business workflows.
- Keep rollback plan ready.
