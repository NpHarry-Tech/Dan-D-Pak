# Migrations

Migration files must be append-only, reversible where practical, and reviewed before touching production data.

Runtime SQLite migrations live in `server/db/migrations.js`. They are applied
automatically at startup and must remain additive/idempotent. Apply any
destructive data migration only through a reviewed migration runner during the
SQLite → PostgreSQL phase. See `docs/DATABASE_SCHEMA.md`.

AI/Agent Safety:
This folder contains business-critical logic or data. Do not delete, reset, rewrite, or migrate destructively without documenting impact and warning the user first.
