# Architecture

Last updated: 2026-06-29

## Current Shape

Dan D Pak is now a backend API plus native Flutter applications.

- Backend entry: `server/index.js`
- API router: `server/api.js`
- Database: SQLite through `server/db.js`
- Realtime: Socket.IO through `server/realtime.js`
- Business logic: `server/services/*`
- Native apps: `flutter-apps/*`
- Shared Flutter API/realtime client: `flutter-apps/dandpak_core`

The backend no longer serves UI assets. `/` returns a small JSON service
descriptor, `/health` returns health data, and application features are exposed
through authenticated `/api/*` routes plus Socket.IO.

## Deployment Zones

The private company server is the source of truth. It owns auth, branches,
orders, payments, inventory, invoices, printing, reporting, audit logs, sync, and
backups.

An optional VPS or LAN reverse proxy may expose the API and realtime endpoints,
but it must not own business data.

## Provider State

- `sqlite`: live
- `socketio`: live
- `local archive storage`: live through `server/services/archive.js`
- `postgres`, `supabase`, `websocket`, `s3`: scaffolded or planned

## Boundaries

Flutter apps call the backend through `dandpak_core` wrappers. Backend code keeps
infrastructure details behind `server/config/*` and `server/adapters/*` as the
codebase migrates toward provider-based storage and realtime.

No business data may be embedded in mobile/desktop client config. Secrets stay
backend-only.

## Schema Roadmap

- Live runtime today: SQLite in `server/db.js`.
- Planned company memory: additive PostgreSQL schema in `server/db/schema/`.

All migrations must be additive, reviewed, backed up, and reversible at the
deployment level. Destructive migrations against business data are not allowed.
