# Repository Structure

Last updated: 2026-06-20

This document maps the **target architecture** (public VPS zone vs. private company
server zone) onto the **current repository layout**. A full directory rename of a
live business system is risky, so the current names are kept and the mapping is
documented here. Renames will happen incrementally and safely.

## Target vs. current mapping

| Target zone | Target folder | Current folder | Status |
| --- | --- | --- | --- |
| Public web (served by VPS) | `public-web/` | `web/` | Keep current name; same role |
| VPS gateway (proxy/buffer/relay) | `vps-gateway/` | `deploy/vps/` + planned `vps-gateway/` | Deploy scaffold exists; relay/buffer planned |
| Private company server (source of truth) | `company-server/` | `server/` | Keep current name; same role |
| Deploy definitions | `deploy/` | `deploy/` | Exists (`deploy/vps`) |
| Documentation | `docs/` | `docs/` | Exists |

> **Rule:** `web/` is the public, non-sensitive shell. `server/` is the private
> source of truth. The VPS never owns business data — see
> [DATA_OWNERSHIP.md](DATA_OWNERSHIP.md).

## Current layout

```text
Dan-D-Pak/
  web/                         => target public-web/ (public VPS shell)
    index.html admin.html pos.html ipad.html kds.html retail.html ...
    runtime-config.js          configurable API_BASE_URL / REALTIME_URL (no hardcoded IPs)
    js/core/                   apiClient, realtimeClient, config, eventBus, storage
    shared/                    shared frontend runtime
    assets/                    brand/UI/product assets

  server/                      => target company-server/ (private source of truth)
    index.js api.js db.js      Express entry, REST router, live SQLite schema
    realtime.js                Socket.IO hub
    config/                    env, cors, runtime, providers
    core/                      logger, errors, http helpers
    services/                  current business logic (orders, payments, inventory ...)
    modules/                   protected target module zones (orders, payments, ...)
    adapters/                  database/realtime/storage provider seams
    db/                        repositories + PostgreSQL schema (planned)
      schema/                  planned additive PostgreSQL schema (company server)
    migrations/                migration files zone
    permanent-storage/         archived business snapshots (gitignored data)

  deploy/
    vps/                       VPS Docker/Caddy/scripts scaffold (gateway zone)

  docs/                        architecture, workflows, data-ownership, runbooks
```

## Target company-server module zones

The target module layout under `server/modules/` (mapped from `server/services/*`):

```text
server/modules/
  auth/ users/ staff/ customers/ branches/ devices/
  restaurant-settings/ menu/ pricing/
  orders/ payments/ cashbook/ bank-accounts/ app-web-links/
  kds/ inventory/ purchase/ invoices/ print/
  reports/ integrations/ sync/ audit/
```

See [MODULE_MAP.md](MODULE_MAP.md) for the service-to-module mapping and
[ERP_MODULE_ROADMAP.md](ERP_MODULE_ROADMAP.md) for sequencing.

## Why no big-bang rename

- `web/` and `server/` are referenced by `package.json`, deploy scripts,
  `render.yaml`, and import paths across the frontend.
- A rename would touch deploy pipelines and risk an outage on a live system.
- The role separation (public shell vs. private data owner) is already true in
  code; this document makes it explicit. Renames are a later, isolated PR.
