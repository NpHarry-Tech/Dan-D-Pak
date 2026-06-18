# Storage Adapters

Current archive snapshots are written by `server/services/archive.js` into `server/permanent-storage`. This folder is the future boundary for:

- `local` storage on the VPS.
- `s3` compatible object storage for uploads, exports, and backups.

AI/Agent Safety:
Business/customer uploads, exports, invoices, and payment reconciliation files must not be mixed with UI assets or deleted without verified backup.
