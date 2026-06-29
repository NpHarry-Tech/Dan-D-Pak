# Company Server Schema (PostgreSQL target)

This folder holds the planned, additive PostgreSQL schema for the private company
server, which is the source of truth. See `docs/DATABASE_SCHEMA.md` and
`docs/COMPANY_DATABASE_MEMORY.md`.

## Safety rules

- These files are append-only/additive: `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, and future `ADD COLUMN IF NOT EXISTS`.
- They contain no `DROP` or `TRUNCATE` of business tables.
- They are planned schema files only. The live runtime today is SQLite in
  `server/db.js`.
- They are not auto-run against production. Applying them must be explicit,
  reviewed, backed up, and handled through the future migration runner.

## Files

- `0001_planned_company_server.sql` - history/versioning, device/app linking,
  bank/payment config history, KDS timing, print/reprint logs,
  company-side sync, and expanded audit tables.
- `0002_planned_company_memory_tables.sql` - broader canonical PostgreSQL table
  groups A-O: organization, auth, devices, customers, menu/pricing, orders, KDS,
  printing, payments/cash/bank, invoices, inventory, reports, integrations,
  sync/offline, and audit/system logs.

The public VPS temporary buffer schema is intentionally separate at
`vps-gateway/temp-buffer/schema.sql` because the VPS is not the company source of
truth.
