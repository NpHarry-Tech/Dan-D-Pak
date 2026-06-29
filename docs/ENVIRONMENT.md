# Environment

Last updated: 2026-06-29

## Backend Variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` or `production` |
| `PORT` | Backend listen port |
| `APP_URL` | Public app URL when used by callbacks or docs |
| `API_BASE_URL` | Public API base URL where needed |
| `CORS_ORIGIN` | Comma-separated allowed native-shell or trusted tool origins |
| `DEPLOYMENT_TARGET` | `local`, `tablet`, or `vps` |
| `DATABASE_PROVIDER` | `sqlite`, `supabase`, or `postgres` |
| `DATABASE_URL` | PostgreSQL/Supabase connection URL when implemented |
| `SQLITE_PATH` | SQLite path override |
| `SUPABASE_URL` | Temporary Supabase URL |
| `SUPABASE_ANON_KEY` | Supabase anon key if used |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only secret |
| `REALTIME_PROVIDER` | `socketio`, `websocket`, or `supabase` |
| `STORAGE_PROVIDER` | `local` or `s3` |
| `STORAGE_PATH` | Local storage path |
| `JWT_SECRET` | Auth signing secret |
| `SESSION_SECRET` | Session secret |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` |
| `BACKUP_RETENTION_DAYS` | Backup retention policy |

## Secret Rules

- Never commit `.env`, database files, service-role keys, or signing secrets.
- Native clients receive only connection targets and user-scoped tokens.
- Backend provider secrets stay in server environment variables.
