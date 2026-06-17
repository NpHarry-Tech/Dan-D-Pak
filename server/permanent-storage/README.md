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
