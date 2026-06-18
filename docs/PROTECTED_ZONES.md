# Protected Zones

Last updated: 2026-06-18

## Backend

- `server/db.js`: live SQLite schema and migrations.
- `server/store.db*`, `server/db.sqlite`: local database files.
- `server/permanent-storage/**`: archived orders, payments, staff, audit, reports, cash drawer, customers, invoices.
- `server/services/orders.js`: order and KDS state transitions.
- `server/services/payments.js`: payment posting and inventory deduction.
- `server/services/inventory.js`: stock ledger, lots, stocktake, transfers.
- `server/services/invoices.js`, `server/services/misa.js`: invoice lifecycle.
- `server/services/reports.js`, `server/services/reportCenter.js`: reporting and exports.
- `server/services/auth.js`: users, roles, permissions, sessions.
- `server/services/archive.js`: permanent archive writes.

## Frontend

- `web/shared/client.js`: auth, API, realtime, login gate.
- `web/pos.html`: table order/payment workflows.
- `web/ipad.html`: customer order/invoice flow.
- `web/kds.html`: kitchen status flow.
- `web/admin.html`: settings, reporting, menu, permissions.
- `web/warehouse.html`: stock operations.
- `web/retail.html`: retail checkout/refunds.

## Agent Rule

Any edit in a protected zone must answer:

- What data can be created, updated, deleted, or emitted?
- Is the change append-only?
- What audit event exists?
- What backup/rollback path exists?
- What manual test proves the workflow still works?
