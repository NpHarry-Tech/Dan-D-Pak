# VPS Deployment Scaffold

Last updated: 2026-06-18

This folder contains the VPS deployment scaffold for the final target stack:

- Caddy reverse proxy with HTTPS
- Node backend
- PostgreSQL service
- Redis placeholder for future queue/cache
- Static frontend served by Caddy
- Local storage and backup volumes

Important: the current application runtime still uses SQLite. PostgreSQL is included as the target database service and must not be treated as a completed migration until the Postgres adapter, schema migration, data migration, and verification steps are finished.

## Files

- `docker-compose.yml`: service topology
- `.env.example`: VPS env template
- `Caddyfile`: HTTPS/static/reverse proxy config
- `Dockerfile.backend`: backend image build
- `scripts/deploy.sh`: pull/build/start/health
- `scripts/backup-db.sh`: PostgreSQL backup scaffold
- `scripts/restore-db.sh`: PostgreSQL restore scaffold
- `scripts/restart.sh`: restart services
- `scripts/healthcheck.sh`: health probe

## First Deploy Summary

1. Provision Ubuntu VPS.
2. Configure DNS to point to the VPS.
3. Install Docker and Docker Compose plugin.
4. Copy `.env.example` to `.env` and change every secret/password/domain.
5. Run `./scripts/deploy.sh`.
6. Verify `https://your-domain/health`.
7. Verify frontend, API, and realtime device flows.
