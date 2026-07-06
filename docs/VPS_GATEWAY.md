# VPS Gateway

Last updated: 2026-06-20

The VPS is a **public gateway and temporary encrypted relay only**. It is never the
business database. See [DATA_OWNERSHIP.md](DATA_OWNERSHIP.md).

## Responsibilities

The VPS must:

- serve `public-web` (`web/`) static assets
- terminate HTTPS / SSL
- proxy `/api` to the company server through a VPN / secure tunnel
- proxy WebSocket / Socket.IO to the company server
- detect company server health
- enter **temporary buffer mode** if the company server is offline
- store only temporary **encrypted** events while buffering
- auto-delete temporary data after sync success or TTL expiry
- expose version manifest, health status, non-sensitive monitoring

The VPS must NOT:

- expose PostgreSQL
- become the permanent business database
- store real orders/customers/staff/payments/invoices/inventory/reports
- log sensitive request/response bodies
- hold plaintext sensitive business data

## Topology

```text
[ Public Internet ]
        |
        v  HTTPS (Caddy/Nginx)
[ VPS Gateway ] -- static public-web
        |
        |  /api + /socket.io proxied over VPN/tunnel
        v
[ Company Server (private) ] -- API + PostgreSQL + realtime (source of truth)
```

When the tunnel is healthy, the VPS is a thin proxy. When the company server is
unreachable, the VPS switches the affected write paths to the temporary buffer.

## Health detection

- The gateway polls a company-server health endpoint (e.g. `GET /health`).
- On repeated failure it marks the upstream **offline** and enables buffer mode.
- On recovery it disables buffer mode and triggers the sync-back flow.

## Temporary retention

- Configurable 1–7 days; **default 7 days**.
- A cleanup job purges expired and already-synced events. See
  [VPS_TEMPORARY_BUFFER.md](VPS_TEMPORARY_BUFFER.md).

## Current implementation

`deploy/vps/` holds the Docker/Caddy scaffold (`Caddyfile`, `docker-compose.yml`,
`scripts/`). The proxy + health termination are deployable today; the
encrypted temporary buffer and sync relay are documented as the next build phase
(`vps-gateway/temp-buffer/`, `sync-relay/`, `cleanup-job/`).
