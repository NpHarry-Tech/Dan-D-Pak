# Enterprise Storage

This folder stores readable JSON backup files for selected configuration data.
It is not the live database.

Single source of truth:

- Local/dev DB: `runtime/server-data/store.db`
- VPS Docker DB: `/app/server-data/store.db`

Use this folder only for read-only recovery/audit copies created by server APIs.
Do not edit JSON files here by hand.
