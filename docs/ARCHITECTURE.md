# Architecture

Last updated: 2026-06-20

## Core Decision

Dan-D-Pak is split into two deployment zones:

1. **Public VPS zone**: serves the public web shell, terminates HTTPS, proxies
   `/api` and Socket.IO, exposes non-sensitive health/version endpoints, and can
   hold an encrypted temporary event buffer for 1-7 days.
2. **Private company server zone**: owns the backend API, PostgreSQL production
   database, realtime service, auth, settings, orders, payments, inventory,
   invoices, printing, integrations, reports, audit logs, sync worker, and
   backups.

The company server is the source of truth. The VPS is a gateway/relay only. The
VPS never permanently stores real business data and never exposes PostgreSQL.

## Current Architecture

The app is a Node/Express modular monolith serving both API and static frontend files.

- Entry: `server/index.js`
- API router: `server/api.js`
- Database: SQLite through `server/db.js`
- Realtime: Socket.IO through `server/realtime.js`
- Business logic: `server/services/*`
- Frontend: static HTML pages in `web/`
- Shared frontend runtime: `web/shared/client.js`

Current folder mapping:

- `web/` maps to target `public-web/`
- `server/` maps to target `company-server/`
- `deploy/vps/` plus `vps-gateway/` map to target `vps-gateway/`

## Target Architecture

The target remains a modular monolith before any microservice split.

Provider seams:

- Database: `sqlite`, `supabase`, `postgres`
- Realtime: `socketio`, `websocket`, `supabase`
- Storage: `local`, `s3`
- Deployment: `local`, `vercel-render-supabase`, `vps`

Target request path:

```text
Browser / POS / iPad / KDS
  -> Public VPS HTTPS gateway, or direct LAN company server
  -> company server API + Socket.IO
  -> private PostgreSQL source of truth
```

If the company server is unavailable, write actions become `LOCAL_PENDING` or
`VPS_PENDING`; the UI must not show official success until the event is synced
and acknowledged by the company server.

## Current Provider State

- `sqlite`: live
- `socketio`: live
- `local archive storage`: live through `server/services/archive.js`
- `postgres`, `supabase`, `websocket`, `s3`: scaffolded/planned

## Boundaries

Frontend must call backend APIs through `web/js/core/apiClient.js` and the existing `api()` export from `web/shared/client.js`.

Backend must keep infrastructure details behind `server/config/*` and `server/adapters/*` as the codebase migrates toward VPS/PostgreSQL.

## No-Large-Refactor Rule

Large HTML screens and service modules should be extracted gradually. Do not move order, payment, invoice, inventory, audit, or report logic without focused tests and a rollback path.

## Schema Roadmap

- Live runtime today: SQLite in `server/db.js`.
- Planned company memory: additive PostgreSQL schema in `server/db/schema/`.
- Planned VPS buffer: `vps-gateway/temp-buffer/schema.sql`.

All migrations must be additive and reviewed. No destructive migration is allowed
against business data.
