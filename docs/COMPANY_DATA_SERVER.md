# Company Data Server

Last updated: 2026-06-20

The company server is the **source of truth**. It owns all real business data and
all business rules.

## Responsibilities

- run the backend API
- run PostgreSQL (production database)
- run WebSocket / Socket.IO realtime
- own all real business data
- handle authentication and authorization
- enforce all business rules
- handle print jobs
- maintain the inventory **ledger**
- maintain payment records
- handle bank / app integrations securely (encrypted secrets)
- pull / accept sync events from the VPS buffer
- acknowledge synced events (idempotently)
- record audit logs
- run backup jobs

## Network policy

The company backend accepts traffic **only** from:

- LAN devices (POS, iPad, KDS, printer agents, warehouse)
- the VPS VPN / tunnel IP
- approved admin access over a secure tunnel

PostgreSQL is never exposed publicly.

## Source-of-truth guarantees

- All permanent writes happen here, never on the VPS.
- The database remembers history, not just latest state — see
  [COMPANY_DATABASE_MEMORY.md](COMPANY_DATABASE_MEMORY.md).
- Idempotency: a processed `event_id` is recorded so duplicate synced events never
  create duplicate orders/payments/inventory rows — see
  [SYNC_BACK_TO_COMPANY_SERVER.md](SYNC_BACK_TO_COMPANY_SERVER.md).

## Current implementation

Today the company server runs as a Node/Express modular monolith
(`server/index.js`, `server/api.js`) with a live SQLite database (`server/db.js`)
and Socket.IO (`server/realtime.js`). The PostgreSQL production target is scaffolded
via `server/adapters/database/postgres.adapter.js` and the planned schema in
`server/db/schema/` (see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)). Migration from
SQLite to PostgreSQL is an additive, non-destructive phase.
