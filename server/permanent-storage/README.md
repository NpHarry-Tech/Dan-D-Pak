Permanent storage snapshots live here.

SQLite remains the live database. The server also writes JSON/NDJSON snapshots
into these folders for important records:

- customers
- orders
- invoices
- payments
- reports
- audit
- staff

Do not delete this folder in production unless you have a verified backup.

AI/Agent Safety:
This folder contains business-critical archive data. Do not delete, reset, rewrite, migrate, redact, or replace files in this folder without documenting impact and warning the user first.
