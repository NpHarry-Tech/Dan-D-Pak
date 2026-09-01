# Database Zone

Source code only:

- `../db.js`: opens the single live SQLite database and runs migrations.
- `backup.js`: creates backup snapshots.
- `schema/`: planned schema notes/migrations.

Live DB locations:

- Local/dev: `runtime/server-data/store.db`
- VPS Docker: `/app/server-data/store.db`

`store.db-shm` and `store.db-wal` are SQLite sidecar files for the same DB, not extra databases.
Backups live in `backups/` and are snapshots only.

AI/Agent Safety:
This folder contains business-critical logic. Do not delete, reset, rewrite, or migrate destructively without documenting impact and warning the user first.
