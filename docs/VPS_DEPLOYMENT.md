# VPS Deployment

Last updated: 2026-06-18

## Server Requirements

- Ubuntu Linux LTS
- 2 CPU / 4 GB RAM minimum for demo, more for production
- 40 GB+ disk with backup storage
- Docker Engine and Docker Compose plugin
- DNS A/AAAA record pointing to the VPS

## Firewall Ports

- `80/tcp` HTTP
- `443/tcp` HTTPS
- SSH on a locked-down port
- PostgreSQL and Redis must not be public
- Backend should stay internal behind Caddy/Nginx

## First Deploy

1. SSH into the server with key-based auth.
2. Install Docker.
3. Clone the GitHub repository.
4. `cd deploy/vps`
5. `cp .env.example .env`
6. Edit domain, passwords, secrets, CORS origin, and provider values.
7. Run `./scripts/deploy.sh`.
8. Open `https://your-domain/health`.
9. Test native apps, API, and realtime devices.

## Logs And Restart

```bash
docker compose logs -f backend
docker compose logs -f caddy
./scripts/restart.sh
```

## Rollback

1. Record current commit and database backup.
2. `git checkout <previous-known-good-commit>`
3. `docker compose build && docker compose up -d`
4. Run health check.
5. Restore database only if the schema/data change requires it and backup is verified.

## Common Errors

- `CORS` errors: set `CORS_ORIGIN=https://your-domain`.
- HTTPS failure: verify DNS and ports 80/443.
- Health fails: check backend logs and env.
- Realtime fails: verify `/socket.io/*` is proxied to backend.
