# Dan D Pak Company Server Deployment

This deploy target runs the backend API used by the Flutter POS, Tablet, KDS,
and Backoffice apps.

## Architecture

```text
Flutter apps / hardware tools
  -> Caddy :80/:443
  -> Node.js app :3000
       /api/*
       /socket.io/*
       /health
  -> SQLite volume
  -> local storage volumes
```

The Node app no longer serves application screens. Native apps connect to the
backend base URL.

## First Deploy

```bash
cd deploy/company-server
cp .env.example .env
# edit .env before starting
docker compose up -d --build
```

Required production values:

```dotenv
APP_DOMAIN=192.168.1.100
APP_URL=http://192.168.1.100
API_BASE_URL=http://192.168.1.100
CORS_ORIGIN=http://192.168.1.100
JWT_SECRET=<random-64-char-hex>
SESSION_SECRET=<random-64-char-hex>
DANDPAK_ADMIN_RESET_PIN=<first-admin-4-digit-pin>
```

Use strong generated secrets, for example:

```bash
openssl rand -hex 32
```

## Verify

```bash
docker compose ps
docker compose logs -f app
curl http://localhost/health
curl http://localhost/api/ping
```

Expected health response includes `"ok":true`.

## Native App Setup

Configure each Flutter app with the backend base URL, for example:

```text
http://192.168.1.100
```

Then test login, branch selection, POS order creation, tablet order creation,
KDS refresh, and backoffice dashboard access.

## Backup

```bash
chmod +x scripts/backup-db.sh
./scripts/backup-db.sh
```

Restore only after stopping writes and verifying the target file:

```bash
chmod +x scripts/restore-db.sh
./scripts/restore-db.sh backups/store_YYYYMMDD_HHMMSS.db
```

## Daily Operations

```bash
docker compose logs -f app
docker compose ps
docker compose restart app
./scripts/restart.sh
docker compose down
```

## Security Notes

- Keep `.env` out of git.
- Remove `DANDPAK_ADMIN_RESET_PIN` after the first successful startup.
- Restrict inbound access to trusted LAN/VPN/proxy ranges.
- Keep payment/provider secrets only in backend environment or encrypted storage.
- Review audit logs after permission, price, payment, and settings changes.
