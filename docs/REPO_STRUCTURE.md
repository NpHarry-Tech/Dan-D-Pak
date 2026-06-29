# Repository Structure

Last updated: 2026-06-29

## Current Layout

```text
Dan-D-Pak/
  server/
    index.js api.js db.js      Express entry, REST router, live SQLite schema
    realtime.js                Socket.IO hub
    config/                    env, cors, runtime, providers
    core/                      logger, errors, http helpers
    services/                  business logic
    modules/                   protected module zones
    adapters/                  database/realtime/storage provider seams
    db/schema/                 planned additive PostgreSQL schema
    migrations/                migration files zone
    permanent-storage/         archived business snapshots

  flutter-apps/
    dandpak_core/              shared API/realtime/defaults
    dandpak_pos/               staff POS app
    dandpak_tablet/            table/customer ordering app
    dandpak_kds/               kitchen display app
    dandpak_backoffice/        admin/backoffice app

  deploy/
    company-server/            Docker/Caddy/scripts for backend deployment

  hardware-agent/              native Windows USB printer/cash-drawer bridge
  docs/                        architecture, workflows, data, runbooks
```

## Module Direction

The target module layout under `server/modules/` maps from current
`server/services/*`:

```text
server/modules/
  auth/ users/ staff/ customers/ branches/ devices/
  restaurant-settings/ menu/ pricing/
  orders/ payments/ cashbook/ bank-accounts/
  kds/ inventory/ purchase/ invoices/ print/
  reports/ integrations/ sync/ audit/
```

See `docs/MODULE_MAP.md` for the service-to-module mapping and
`docs/ERP_MODULE_ROADMAP.md` for sequencing.
