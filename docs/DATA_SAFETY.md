# Data Safety

Last updated: 2026-06-18

## Protected Business Domains

Orders, order items, kitchen tickets, payments, payment lines, refunds, voids, invoices, MISA invoice data, customers, customer contact information, reports, cashbook entries, shift data, inventory movements, stock counts, stock transfers, product/SKU master data, menu data, pricing history, discount/promotion history, voucher history, audit logs, user/role/permission data, device pairing data, and branch/store configuration are protected.

## Protected File Patterns

- `runtime/server-data/store.db`
- `runtime/server-data/store.db-shm`
- `runtime/server-data/store.db-wal`
- `server/store.db`
- `server/store.db-shm`
- `server/store.db-wal`
- `server/db.sqlite`
- `*.db`
- `*.sqlite`
- `*.sqlite3`
- `.env`
- `.env.*`
- `backups/`
- `server/permanent-storage/**` data files
- database dumps, exported reports, invoice exports, customer exports, payment reconciliation files

## Rules

- Never delete protected files silently.
- Never overwrite protected files without backup.
- Never reset database tables without warning and approval.
- Never replace real data with mock/demo data.
- Never expose service-role keys in frontend code.
- Never commit local database files or `.env` files.
- If protected files are tracked, remove them from git index only and keep them on disk.
- Any change touching protected data logic must be documented in README and `docs/CHANGELOG_WORKFLOW.md`.

## Current Layout

The source tree keeps code in `server/`. Local runtime database files live under
`runtime/server-data/` and are ignored. VPS Docker stores the same single live DB
at `/app/server-data/store.db`.
