# Deployment

Last updated: 2026-06-27

## Supported Targets

Local/company server:

- Run one Node/Express app that serves both `web/` and `/api`.
- Use same-origin API calls by default; override `API_BASE_URL` only when a gateway/proxy requires it.
- Run `npm install` then `npm start` for local development.
- Set `PORT`, `NODE_ENV`, `CORS_ORIGIN`, provider flags, and secrets only in backend environment variables.

Database/realtime:

- Current local code uses SQLite and Socket.IO.
- PostgreSQL/WebSocket provider integration is scaffolded/planned and must keep secrets backend-only.

## VPS / Company Server

Use `deploy/vps/` and the VPS docs:

- [VPS deployment](VPS_DEPLOYMENT.md)
- [VPS migration plan](VPS_MIGRATION_PLAN.md)
- [VPS security checklist](VPS_SECURITY_CHECKLIST.md)
- [VPS backup/restore](VPS_BACKUP_RESTORE.md)

## Deployment Safety

- Do not deploy with committed `.env` or DB files.
- Verify `GET /health`.
- Verify API errors return JSON.
- Verify realtime across iPad/POS/KDS.
- Verify backup before migration.
