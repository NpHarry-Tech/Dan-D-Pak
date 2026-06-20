# Backup & Restore

Last updated: 2026-06-20

Backups protect the company server's source-of-truth data.

## What is backed up

- PostgreSQL production database (full + incremental as configured)
- restaurant settings and configuration history
- audit logs

## Rules

- Backups are **encrypted**.
- Backups and dumps are **never committed to git** (`.gitignore` enforces this).
- Restores are tested periodically (restore drill).
- Every restore writes an audit log (who, when, which backup, why).
- Retention is configurable (`BACKUP_RETENTION_DAYS`, default 14).

## Backup workflow

1. Scheduled job dumps the company database to an encrypted artifact.
2. Artifact is stored off-host (separate disk / object storage / offsite).
3. Old artifacts beyond retention are pruned.

## Restore workflow

1. Stop or quiesce writes (maintenance window) if doing a full restore.
2. Restore the encrypted backup into PostgreSQL.
3. Verify integrity (row counts, key business tables, last audit entries).
4. Record a restore audit log.
5. Resume operations; if the VPS buffer holds newer events, run sync-back.

## Current implementation

`deploy/vps/scripts/backup-db.sh` and `restore-db.sh` provide the scaffold;
[VPS_BACKUP_RESTORE.md](VPS_BACKUP_RESTORE.md) covers the VPS-side details. The
PostgreSQL target uses `pg_dump`/`pg_restore` in place of the SQLite copy used in
the current local stack.
