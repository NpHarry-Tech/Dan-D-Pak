# Deployment

Last updated: 2026-06-29

## Supported Targets

Local/company server:

- Run one Node/Express backend that exposes `/api`, `/socket.io`, `/health`, and
  a JSON service descriptor at `/`.
- Run `npm install` then `npm start` for local backend development.
- Set `PORT`, `NODE_ENV`, `CORS_ORIGIN`, provider flags, and secrets only in
  backend environment variables.
- Point Flutter apps at the backend base URL.

Database/realtime:

- Current local code uses SQLite and Socket.IO.
- PostgreSQL/WebSocket provider integration is scaffolded/planned and must keep
  secrets backend-only.

## Company Server

Use `deploy/company-server/` for Docker/Caddy deployment:

- `docker-compose.yml` builds the backend container.
- `Caddyfile` reverse-proxies API, realtime, health, and service descriptor
  traffic to the backend.
- `scripts/backup-db.sh` and `scripts/restore-db.sh` handle SQLite backups.

## Deployment Safety

- Do not deploy with committed `.env` or DB files.
- Verify `GET /health`.
- Verify API errors return JSON.
- Verify realtime from Flutter POS, Tablet, KDS, and Backoffice.
- Verify backup before migration.
