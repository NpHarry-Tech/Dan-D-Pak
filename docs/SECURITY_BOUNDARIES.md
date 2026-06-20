# Security Boundaries

Last updated: 2026-06-20

## Never commit

- `.env`, `.env.*` (except `.env.example`)
- real database files (`*.db`, `*.sqlite`, `*.sqlite3`, `store.db*`)
- database dumps, backups, exports (`*.dump`, `*.backup`, `backups/`)
- customer, staff, or payment data
- bank secrets, integration secrets, service/API tokens

These are enforced by `.gitignore`. See [DATA_SAFETY.md](DATA_SAFETY.md).

## Secret handling

- Passwords and PINs: **hashed only**, never plaintext.
- Bank credentials / payment provider secrets: **encrypted at rest** or held in an
  environment / secret manager. Never logged in full.
- Card data: never store PAN/CVV. Bank account numbers are **masked** in UI.
- Integration tokens: encrypted; creation / rotation / deletion is audited; full
  token value is never written to logs.

## Network boundaries

- PostgreSQL is **never** public.
- Company backend accepts only: LAN devices, VPS VPN/tunnel IP, approved admin.
- VPS terminates TLS, proxies `/api` and WebSocket, and never touches the DB.
- VPS avoids logging sensitive request/response bodies.

## Access control

- Role-based permissions on every sensitive action.
- Append-only logs for sensitive changes (prices, settings, bank config, tokens).
- Every privileged action writes an audit log — see [AUDIT_LOGGING.md](AUDIT_LOGGING.md).

## Append-only / non-destructive principles

- Orders are cancelled/voided with a reason and actor, never deleted.
- Prices are versioned; old orders keep their original price snapshot.
- Inventory changes go through movement records, never direct quantity edits.
- Payments are reversed via refund/void records, never deleted.
- Settings and bank config changes create version/history rows.

## Frontend rules

- No hardcoded IPs or API hosts. `API_BASE_URL` / `REALTIME_URL` are configurable
  via `web/runtime-config.js`, `window.APP_CONFIG`, `VITE_*`, or localStorage,
  falling back to same-origin `/api`.
- No direct database connection from the browser.
- No secret keys in frontend code.
- No fake success when data is only pending — UI shows pending/synced/failed
  states honestly (see [OFFLINE_FIRST_ARCHITECTURE.md](OFFLINE_FIRST_ARCHITECTURE.md)).
