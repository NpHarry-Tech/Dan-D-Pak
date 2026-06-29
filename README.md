# Dan D Pak POS/ERP

Dan D Pak is now a local-store backend plus native Flutter apps. The Node server owns the business data and exposes REST/Socket.IO APIs; the POS, tablet, KDS, and backoffice experiences live under `flutter-apps/`.

## Current Runtime

- Backend: `server/index.js` with Express REST APIs and Socket.IO realtime.
- Database: SQLite through Node `node:sqlite`, WAL mode.
- Native apps: `flutter-apps/dandpak_pos`, `flutter-apps/dandpak_tablet`, `flutter-apps/dandpak_backoffice`, and prototype `flutter-apps/dandpak_kds`.
- Shared Flutter client code: `flutter-apps/dandpak_core`.
- Hardware/server-side printing: `server/services/printing.js` plus `hardware-agent/` where needed.

## Run Backend

```bash
npm install
npm start
```

Useful checks:

```bash
node --check server/index.js
node --check server/api.js
npm audit
```

Health endpoints:

- `GET /health`
- `GET /api/ping`

The root route `/` returns JSON metadata. UI routes are not served by the Node server.

## Flutter Apps

Install Flutter/Dart locally, then run the app you need:

```bash
cd flutter-apps/dandpak_pos
flutter pub get
flutter analyze
flutter run
```

Repeat from `flutter-apps/dandpak_tablet` or `flutter-apps/dandpak_backoffice` as needed.

## Demo Accounts

Seed/demo accounts are defined in `server/seed.js`.

| Role | Username | PIN |
| --- | --- | --- |
| Owner | `admin` | `1234` in development/test only |
| Manager | `manager` | `2222` |
| Cashier | `cashier` | `1111` |
| Kitchen | `kitchen` | `3333` |
| Warehouse | `warehouse` | `4444` |

## Security Notes

- Tokens are sent with `Authorization: Bearer <token>` or `x-auth-token`.
- Staff APIs are permission-gated in `server/api.js` through `guard()` and `guardAny()`.
- Public API surface is intentionally small: health/ping/branch discovery, public tax lookup, and external provider webhooks with rate limiting.
- `CONFIG_SEED_URL` is SSRF-hardened: private/local targets are blocked unless explicitly allowed by environment override.
- Production refuses to create `admin/1234` on an empty database. Set `DANDPAK_ADMIN_RESET_PIN=<4 digits>` for the first startup, then remove it.
- Do not commit `.env`, SQLite databases, backups, uploaded files, or private storage folders.

## Important Paths

- `server/`: backend, services, DB schema/migrations, config, realtime.
- `flutter-apps/`: native app code.
- `hardware-agent/`: local hardware integration support.
- `deploy/company-server/`: deployment scaffolding.
- `docs/`: architecture, workflow, backup, and operational documentation.
