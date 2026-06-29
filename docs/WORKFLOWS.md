# Workflow Map

Last updated: 2026-06-29

## Core Runtime

| Workflow | Actor | API/realtime | Success | Failure to watch |
| --- | --- | --- | --- | --- |
| Login | Staff | `POST /api/login`, `GET /api/me` | Token and effective permissions loaded | inactive user, wrong PIN, permission drift |
| Branch selection | Staff/device | `GET /api/branches` | Device uses explicit branch | cross-branch data leak |
| Menu load | POS/Tablet | `GET /api/menu`, `GET /api/categories` | Branch menu visible after auth | stale cache, missing permission |
| Floor load | POS/Tablet | `GET /api/zones`, `GET /api/tables` | Tables scoped to branch | table from another branch |
| Staff order | POS | `POST /api/orders` | order persisted, KDS refresh emitted | permission bypass, invalid item payload |
| Table order | Tablet | `POST /api/orders` | order persisted under selected table | unauthenticated write, item contract mismatch |
| KDS workflow | Kitchen | `GET /api/kds/:station`, item status routes | item state advances with audit trail | station leakage, branch mismatch |
| Payment | Cashier | payment routes under `/api/orders/:id/*` | payment recorded and order closed | fake success, provider mismatch |
| Inventory movement | Warehouse | warehouse/inventory routes | ledger movement created | direct stock mutation |
| Backoffice reporting | Manager | dashboard/report routes | branch-scoped metrics | broken access control |
| Printing | Server/agent | print routes, hardware agent | print attempt logged | unaudited reprint, agent token missing |
| Backup/restore | DevOps | deploy scripts | verified backup/restore | restoring wrong DB |

## Security Workflow Rules

- No public staff write path.
- Tablet/customer ordering still goes through authenticated device/session flow.
- Every mutation validates branch, user permission, and input shape.
- Payment/provider callbacks remain public only where the provider requires it,
  and must verify provider identity before mutating state.
- Offline/pending events never show as official success before backend ack.

## Smoke Checklist

- `/health` returns JSON and reflects database failure.
- Unknown `/api/*` returns JSON 404.
- Login, menu, floor, order, KDS, payment, and dashboard flows work from native
  apps.
- Realtime reconnects after server restart.
- Backups are created before migrations or provider changes.
