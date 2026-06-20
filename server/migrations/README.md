# Migrations

Migration files must be append-only, reversible where practical, and reviewed before touching production data.

The PostgreSQL company-server target schema is planned in `server/db/schema/`
(additive, idempotent, no destructive statements). It is NOT auto-run against
production; apply it only through a reviewed migration runner during the
SQLite → PostgreSQL phase. See `docs/DATABASE_SCHEMA.md`.

AI/Agent Safety:
This folder contains business-critical logic or data. Do not delete, reset, rewrite, or migrate destructively without documenting impact and warning the user first.
