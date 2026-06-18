# VPS Backup And Restore

Last updated: 2026-06-18

## Backup Targets

- PostgreSQL database after migration.
- SQLite database while current runtime remains SQLite.
- `server/permanent-storage` or mounted storage volume.
- User uploads/private storage.
- `.env` stored securely outside git.

## PostgreSQL Backup

```bash
cd deploy/vps
./scripts/backup-db.sh
```

Store copies off-server. Keep retention aligned with `BACKUP_RETENTION_DAYS`.

## SQLite Backup

While SQLite remains live, stop writes or use a SQLite-safe backup procedure. Copy `store.db`, `store.db-shm`, and `store.db-wal` together, or use SQLite backup tooling.

## Restore Rules

- Restore to staging first.
- Confirm target environment before overwriting data.
- Keep the pre-restore backup.
- Verify `/health`, order history, payment reports, inventory snapshot, invoices, and audit logs after restore.

## Restore Command

```bash
cd deploy/vps
./scripts/restore-db.sh backups/postgres_YYYYMMDD_HHMMSS.dump
```

Do not run restore against production without explicit approval and a verified backup.
