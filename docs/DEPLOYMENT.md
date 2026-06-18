# Deployment

Last updated: 2026-06-18

## Temporary Demo

Frontend:

- Deploy `web/` to Vercel.
- Add `web/vercel.json` rewrites for static routes like `/admin`.
- Set `window.APP_CONFIG.API_BASE_URL` through `runtime-config.js` or generated config so the frontend calls the Render backend.

Backend:

- Deploy Node app to Render.
- Run `npm install` then `npm start`.
- Set `PORT`, `NODE_ENV`, `CORS_ORIGIN`, provider flags, and secrets only in backend environment variables.

Database/realtime:

- Current local code uses SQLite and Socket.IO.
- Supabase provider integration is scaffolded/planned and must keep service-role keys backend-only.

## Final VPS

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
