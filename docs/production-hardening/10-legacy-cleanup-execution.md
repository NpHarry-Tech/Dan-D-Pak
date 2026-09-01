# Legacy cleanup execution — 2026-08-09

## Phạm vi

Đã loại đúng 46 file tồn tại trên VPS/image nhưng không còn trong source local. Không dùng wildcard và không xóa database, configuration, uploads, releases hoặc Docker volume.

## Recovery artifacts

- Archive: `/opt/dan-d-pak-legacy-backups/legacy-46-20260809-004456.tar.gz`
- Archive files: 46
- Archive bytes: 4.362.839
- Archive SHA-256: `c63ef342e0e729f33bccad8de6accc3029a052b150f676907169de929388e520`
- File manifest: `/opt/dan-d-pak-legacy-backups/legacy-46-20260809-004456.sha256`
- Pre-restart DB backup: `/app/backups/pre-legacy-cleanup-20260809-004605.db`
- DB backup bytes: 110.227.456
- DB backup SHA-256: `f42eb24910db499c1e3b9558df56ca8dea07ea7f72cd11c083ab5f30906ef8f6`
- DB backup integrity: `ok`
- Rollback image tag: `company-server-app:pre-legacy-cleanup-20260809-004605`

## Deployment result

- Previous image: `sha256:3d64ddefa5af433c0a5074ac85bec9edcb9d825ad0e19b02194b2ce1654f5c59`
- Clean image: `sha256:e21651e94b8e32082d2315419089d61518d19baaffd2df6d5058aaf489ed182e`
- Exact legacy paths remaining in clean image: 0/46
- Container state: `running/healthy`
- Internal and public health: application `ok`, database `ok`
- Post-restart SQLite `PRAGMA quick_check`: `ok`
- Health warnings/provider issues: 0/0

## Restart maintenance effects

Backend startup executed its existing maintenance routines:

- pruned 17 expired print jobs;
- voided 20 stale retail draft orders;
- wrote a new encrypted scheduled database backup.

These are startup lifecycle effects, not direct targets of the legacy-file deletion. They are recorded explicitly for production auditability.

## Recovery

If rollback is required, retag `company-server-app:pre-legacy-cleanup-20260809-004605` as `company-server-app:latest` and recreate only the `app` service. The legacy archive can restore the exact 46 paths with their original content.
