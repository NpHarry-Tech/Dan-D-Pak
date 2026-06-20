# Dan-D-Pak POS/ERP

Dan-D-Pak is a POS/ERP system for FnB, retail, iPad self-order, cashier POS, KDS, warehouse/inventory, payments, reports, realtime dashboards, device workflows, and future integrations.

This repository is a real business system. Orders, invoices, customers, reports, payments, inventory, devices, and audit logs are protected assets.

## Stack Truth

Temporary demo stack:

- Frontend: Vercel static hosting for `web/`
- Backend: Render Node service for `server/`
- Database/realtime: Supabase may be used through future adapters
- Source control: GitHub

Current local stack:

- Frontend and backend served by one Express server
- SQLite database at `server/store.db`
- Socket.IO realtime from the Node backend
- Static HTML pages in `web/`

Final target stack:

- VPS or cloud VM running Ubuntu Linux
- Caddy or Nginx reverse proxy with HTTPS
- Node.js backend
- PostgreSQL database
- WebSocket or Socket.IO realtime
- Local or S3-compatible storage
- Automated backups, firewall, logs, monitoring, and GitHub-based deploys

## Architecture Summary

The target shape is a modular monolith. The current code already has service modules under `server/services/*`; this pass adds provider/config seams without moving critical business logic.

```text
server/
  index.js                 Express entrypoint, static web, health check
  api.js                   Current REST API router
  db.js                    Current SQLite schema and live migrations
  realtime.js              Current Socket.IO hub
  config/                  Env, CORS, runtime, provider config
  core/                    Errors, logger, HTTP helpers
  adapters/                Database/realtime/storage provider scaffolds
  services/                Current business services
  modules/                 Protected target module zones
  db/                      Future repositories zone
  migrations/              Future migration files zone
web/
  *.html                   Device and workflow screens
  shared/                  Existing shared frontend runtime
  js/core/                 API/realtime/config utility layer
  runtime-config.js        Runtime frontend configuration
  assets/                  Brand/UI/product/demo asset folders
deploy/vps/                VPS Docker/Caddy/scripts scaffold
docs/                      Architecture, workflows, safety, deployment docs
```

## Protected Data And AI Safety Rules

Never delete or overwrite protected data silently. Never reset production tables without explicit user approval. Never replace real data with mock/demo data. Never expose service-role or secret keys to frontend code. Never commit `.env` files, local database files, backups, exports, or private storage data.

Protected files include:

- `server/store.db`, `server/store.db-shm`, `server/store.db-wal`
- `server/db.sqlite`, `*.db`, `*.sqlite`, `*.sqlite3`
- `server/permanent-storage/**` data snapshots
- `backups/`, database dumps, exported reports, invoice exports, customer exports, payment reconciliation files
- `.env`, `.env.*` except `.env.example`

If protected files are tracked by git, remove them from the git index only. Do not delete them from disk.

See [docs/DATA_SAFETY.md](docs/DATA_SAFETY.md), [docs/PROTECTED_ZONES.md](docs/PROTECTED_ZONES.md), and [docs/CHANGELOG_WORKFLOW.md](docs/CHANGELOG_WORKFLOW.md).

## Module Map

Active service areas today:

- Auth/users/permissions: `server/services/auth.js`
- Menu/catalog: `server/services/catalog.js`
- Orders/tables/KDS: `server/services/orders.js`
- Payments/shift/cash drawer: `server/services/payments.js`, `server/services/shifts.js`, `server/services/cashDrawer.js`
- Inventory/warehouse/SKU: `server/services/inventory.js`
- Retail checkout/refund: `server/services/retail.js`
- Customers: `server/services/customers.js`
- Invoices/MISA: `server/services/invoices.js`, `server/services/misa.js`
- Reports/audit/archive: `server/services/reports.js`, `server/services/reportCenter.js`, `server/services/archive.js`
- Printing: `server/services/printing.js`
- Online channels: `server/services/online.js`

See [docs/MODULE_MAP.md](docs/MODULE_MAP.md).

## Device Workflow Map

- iPad: customer self-order, staff unlock, invoice choice after payment
- POS: table order, staff confirmation, bill split, split payment, cash drawer
- KDS: kitchen/bar/salad station tickets and item states
- Retail: barcode/SKU checkout and refund
- Warehouse: receive, issue, transfer, stocktake, lots/expiry
- Admin: dashboard, menu, users, permissions, reports, settings, integrations
- Printers: connected device status, print history, reprint review, LAN/OS printer dispatch, and cash drawer control

See [docs/DEVICE_WORKFLOWS.md](docs/DEVICE_WORKFLOWS.md) and [docs/WORKFLOWS.md](docs/WORKFLOWS.md).

## Environment Variables

Root `.env.example` documents local/demo/VPS values. Key provider switches:

- `DATABASE_PROVIDER=sqlite|supabase|postgres`
- `REALTIME_PROVIDER=supabase|websocket|socketio`
- `STORAGE_PROVIDER=local|s3`
- `DEPLOYMENT_TARGET=local|vercel-render-supabase|vps`

Frontend runtime priority:

1. `window.APP_CONFIG.API_BASE_URL`
2. `VITE_API_BASE_URL` where a build tool exists
3. Local storage key `dan_d_pak_api_base_url`
4. Same-origin `/api`, with `http://localhost:3000` only for `file://` local use

See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Local Development

```bash
npm install
npm start
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/ipad`
- `http://localhost:3000/pos`
- `http://localhost:3000/kds`
- `http://localhost:3000/admin`
- `http://localhost:3000/retail`
- `http://localhost:3000/warehouse`
- `http://localhost:3000/printers`

Demo PINs remain documented for local/demo use: admin `1234`, manager `2222`, cashier `1111`, kitchen `3333`, warehouse `4444`.

## Store Hardware Runtime

Real receipt printers, kitchen/bar printers, cash drawers, POS stations, KDS screens, and warehouse devices must talk to a store-local backend running on the same LAN when hardware commands are needed.

- LAN/IP printers use the printer's local IP and ESC/POS port, usually `9100`.
- OS printers use the printer driver installed on the device running the backend.
- Browser printers open the system print dialog from the web page for review/reprint.
- Cash drawers usually connect to the bill printer and open through an ESC/POS drawer pulse.
- Cloud hosting such as Render cannot directly reach private LAN addresses like `192.168.x.x`; for production stores, keep a local store server/agent online and let cloud sync handle cross-store data.

## Deployment Workflows

Temporary demo:

- Host `web/` on Vercel.
- Host Node backend on Render.
- Configure `web/runtime-config.js` or Vercel runtime env so `API_BASE_URL` points to the Render backend.
- Keep secrets only on the backend.

Final VPS:

- Use [deploy/vps](deploy/vps/README.md) and [docs/VPS_DEPLOYMENT.md](docs/VPS_DEPLOYMENT.md).
- Current code still uses SQLite at runtime; PostgreSQL adapter/migration work is scaffolded and documented as a required next phase.

## Testing Checklist

- `npm start` boots without syntax errors.
- `GET /health` returns JSON.
- `GET /api/ping` returns JSON.
- Admin/POS/iPad/KDS pages load from the local server.
- iPad order appears in POS/KDS without reload.
- Payment updates table/dashboard without reload.
- Inventory movement updates warehouse/admin state.
- Missing API route returns JSON, not HTML.
- No `.env`, DB, backup, or permanent-storage data is newly committed.

## Known Issues

- Tracked protected data existed before this pass and must be untracked from git index only.
- PostgreSQL, Supabase, S3, and WebSocket adapters are scaffolds, not live replacements yet.
- Large HTML screens still contain mixed UI/business workflow code and need gradual extraction.
- Some existing delete actions physically delete setup records; production-safe append-only behavior needs a dedicated data-model pass.

See [docs/KNOWN_CASES.md](docs/KNOWN_CASES.md).

## AI Agent Rules

- Inspect before editing.
- Keep changes incremental.
- Do not move or rewrite business-critical flows casually.
- Do not delete protected files.
- Document every data-impacting change.
- If a change touches orders, payments, invoices, inventory, reports, customers, users, permissions, devices, or audit logs, update safety docs and changelog notes.

## Changelog Workflow

Use [docs/CHANGELOG_WORKFLOW.md](docs/CHANGELOG_WORKFLOW.md) for all future changes. Record scope, files touched, protected domains touched, testing, deployment impact, rollback path, and warnings.
