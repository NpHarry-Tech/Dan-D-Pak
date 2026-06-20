# Company Server Schema (PostgreSQL target)

This folder holds the **planned**, additive PostgreSQL schema for the company
server (the source of truth). See `docs/DATABASE_SCHEMA.md` and
`docs/COMPANY_DATABASE_MEMORY.md`.

## Safety rules

- These files are **append-only / additive**: `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`. No `DROP`/`TRUNCATE`
  of business tables.
- They are **planned**: the live runtime today is SQLite (`server/db.js`). These
  are NOT auto-run against production. They define the PostgreSQL target and the
  new history/ledger/sync tables to be applied during the SQLite→PostgreSQL phase
  through a reviewed migration runner.
- Applying them must be explicit and reviewed (see `server/migrations/`).

## Files

- `0001_planned_company_server.sql` — new history/versioning, device & app-web
  linking, bank/payment config history, KDS timing, printing/reprint logs,
  sync (VPS buffer + company sync), and expanded audit tables.
