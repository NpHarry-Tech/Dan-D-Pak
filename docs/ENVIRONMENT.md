# Environment

Last updated: 2026-06-18

## Root/Backend Variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` or `production` |
| `PORT` | Backend listen port |
| `APP_URL` | Public app URL |
| `API_BASE_URL` | Public API base URL where needed |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins |
| `DEPLOYMENT_TARGET` | `local`, `vercel-render-supabase`, or `vps` |
| `DATABASE_PROVIDER` | `sqlite`, `supabase`, or `postgres` |
| `DATABASE_URL` | PostgreSQL/Supabase connection URL when implemented |
| `SQLITE_PATH` | Future override for SQLite path |
| `SUPABASE_URL` | Temporary Supabase URL |
| `SUPABASE_ANON_KEY` | Public Supabase anon key, frontend-safe only if used |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only secret |
| `REALTIME_PROVIDER` | `socketio`, `websocket`, or `supabase` |
| `STORAGE_PROVIDER` | `local` or `s3` |
| `STORAGE_PATH` | Local storage path |
| `JWT_SECRET` | Future auth signing secret |
| `SESSION_SECRET` | Future session secret |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` |
| `BACKUP_RETENTION_DAYS` | Backup retention policy |

## Frontend Runtime Config

`web/runtime-config.js` defines `window.APP_CONFIG`.

Important values:

- `API_BASE_URL`
- `REALTIME_URL`
- `DEPLOYMENT_TARGET`
- `DEMO_MODE`

Never put service-role keys or backend secrets in frontend config.
