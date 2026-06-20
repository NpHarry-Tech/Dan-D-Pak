# Data Ownership & Security Boundary

Last updated: 2026-06-20

Dan-D-Pak runs in two deployment zones with a hard boundary between them.

## 1. Public VPS zone (gateway, NOT source of truth)

The VPS is public-facing. It **may** contain:

- public web frontend / app shell (static HTML/CSS/JS/assets)
- HTTPS/SSL termination
- reverse proxy / API gateway
- WebSocket / Socket.IO proxy
- a **temporary encrypted event buffer** (1–7 days, default 7)
- version manifest, health status, non-sensitive monitoring

The VPS **must NOT** be the source of truth and **must NOT** permanently store:

- real orders, customers, staff, payments, invoices, inventory, reports
- bank account credentials, real audit logs, private restaurant settings

If the VPS holds anything business-related, it is **temporary, encrypted, and
expiring**, only as a relay while the company server is unreachable. See
[VPS_TEMPORARY_BUFFER.md](VPS_TEMPORARY_BUFFER.md).

## 2. Private company server zone (the source of truth)

The company server owns all real business data:

- backend API, PostgreSQL production database, realtime service
- authentication / authorization, users / staff / customers
- restaurant settings, menu / pricing / version history
- orders / order items / kitchen tickets
- payments / payment lines / cash in-out / bank account linking / app-web linking
- inventory movements / purchase / sales / stock logs
- invoices, print jobs / reprint logs, integration tokens
- reports, audit logs, sync worker, backups

The company server is the **only** place real data lives permanently.

## Ownership matrix

| Data | VPS may hold? | Company server owns? |
| --- | --- | --- |
| Static frontend assets | Yes | Build source |
| TLS / public routing | Yes | No |
| Real orders / payments / invoices | Temp encrypted only | **Yes (permanent)** |
| Customers / staff / users | **No** | **Yes** |
| Bank credentials / payment secrets | **No** | **Yes (encrypted)** |
| Inventory ledger | Temp encrypted event only | **Yes** |
| Audit logs | Buffer attempt logs only | **Yes (permanent)** |
| Restaurant settings + history | **No** | **Yes** |
| PostgreSQL access | **Never** | **Yes (private only)** |

## Hard rules

- PostgreSQL is never exposed publicly. The company backend only accepts traffic
  from LAN devices, the VPS VPN/tunnel IP, and approved admin access.
- The VPS never connects directly to the database.
- The VPS auto-deletes temporary data on sync success or TTL expiry.
- No plaintext sensitive business data is stored on the VPS unless explicitly
  approved and documented.

See [SECURITY_BOUNDARIES.md](SECURITY_BOUNDARIES.md),
[VPS_GATEWAY.md](VPS_GATEWAY.md), and
[COMPANY_DATA_SERVER.md](COMPANY_DATA_SERVER.md).
