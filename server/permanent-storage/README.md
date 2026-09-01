Permanent storage archives live here.

SQLite remains the only live database. The server also writes JSON/NDJSON archive
files into these folders for important records:

- customers
- orders
- invoices
- payments
- reports
- audit
- staff

This folder is not a second database and must not contain extra `.db` files.
Do not delete this folder in production unless you have a verified backup.

AI/Agent Safety:
This folder contains business-critical archive data. Do not delete, reset, rewrite, migrate, redact, or replace files in this folder without documenting impact and warning the user first.
