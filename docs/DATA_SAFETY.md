# Data Safety

Last updated: 2026-06-18

## Protected Business Domains

Orders, order items, kitchen tickets, payments, payment lines, refunds, voids, invoices, MISA invoice data, customers, customer contact information, reports, cashbook entries, shift data, inventory movements, stock counts, stock transfers, product/SKU master data, menu data, pricing history, discount/promotion history, voucher history, audit logs, user/role/permission data, device pairing data, and branch/store configuration are protected.

## Protected File Patterns

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
- Never expose service-role keys in client code.
- Never commit local database files or `.env` files.
- If protected files are tracked, remove them from git index only and keep them on disk.
- Any change touching protected data logic must be documented in README and `docs/CHANGELOG_WORKFLOW.md`.

## Current Safety Finding

The repository currently contains tracked local database/archive data. The safe remediation is to expand `.gitignore` and run `git rm --cached` on those protected files only. Do not delete them from disk.
