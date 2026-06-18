# Architecture

Last updated: 2026-06-18

## Current Architecture

The app is a Node/Express modular monolith serving both API and static frontend files.

- Entry: `server/index.js`
- API router: `server/api.js`
- Database: SQLite through `server/db.js`
- Realtime: Socket.IO through `server/realtime.js`
- Business logic: `server/services/*`
- Frontend: static HTML pages in `web/`
- Shared frontend runtime: `web/shared/client.js`

## Target Architecture

The target remains a modular monolith before any microservice split.

Provider seams:

- Database: `sqlite`, `supabase`, `postgres`
- Realtime: `socketio`, `websocket`, `supabase`
- Storage: `local`, `s3`
- Deployment: `local`, `vercel-render-supabase`, `vps`

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
