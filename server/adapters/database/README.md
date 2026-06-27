# Database Adapters

Current live mode is SQLite through `server/db.js`. This folder is the provider boundary for moving toward:

- `sqlite` for local/demo store-server mode.
- `postgres` for the final VPS target.

AI/Agent Safety:
This folder touches business-critical persistence. Do not delete, reset, rewrite, or migrate destructively without documenting impact and warning the user first.
