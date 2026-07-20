# Host Lai Database Len VPS

Ngay 2026-07-13, backend Dan D Pak van dang chay SQLite lam database chinh. Cach dung nhat hien tai la host ca backend len VPS va dat `store.db` trong Docker volume `/app/server-data/store.db`.

Chua nen ep sang PostgreSQL luc nay, vi Postgres trong repo moi o muc chuan bi cau hinh/sidecar. Runtime that van la SQLite.

## 1. Dong goi du lieu tu may hien tai

Chay tren Windows tai root repo:

```powershell
.\deploy\company-server\scripts\package-vps-sqlite.ps1
```

Script se tao:

- `backups/vps-migration-YYYYMMDD-HHMMSS/store.db`
- `permanent-storage/`
- `uploads/`
- `releases/`
- `product-images/`
- `backups/vps-migration-YYYYMMDD-HHMMSS.zip`

`store.db` duoc tao bang backup nhat quan, khong copy truc tiep file dang co WAL.

## 2. Chuan bi VPS Ubuntu

Tren VPS:

```bash
apt update
apt install -y git docker.io docker-compose-plugin unzip
systemctl enable --now docker
mkdir -p /opt/dan-d-pak
```

Upload source repo va file zip migration len VPS. Mau lenh tu Windows:

```powershell
scp backups\vps-migration-YYYYMMDD-HHMMSS.zip root@42.96.18.70:/root/
```

## 3. Cau hinh backend tren VPS

Tren VPS, trong source repo:

```bash
cd /opt/dan-d-pak/deploy/company-server
cp .env.example .env
openssl rand -hex 32
```

Sua `.env`:

```env
APP_DOMAIN=42.96.18.70
APP_URL=http://42.96.18.70
API_BASE_URL=http://42.96.18.70:3000
CORS_ORIGIN=http://42.96.18.70
DATABASE_PROVIDER=sqlite
DATABASE_URL=sqlite:///app/server-data/store.db
JWT_SECRET=<chuoi-openssl-rand-hex-32>
SESSION_SECRET=<chuoi-openssl-rand-hex-32-khac>
DISABLE_DEMO_SEED=true
```

Neu co domain that, thay IP bang domain va dung HTTPS qua Caddy.

## 4. Start container va restore database

```bash
cd /opt/dan-d-pak/deploy/company-server
docker compose up -d --build
mkdir -p /root/vps-migration
unzip -o /root/vps-migration-YYYYMMDD-HHMMSS.zip -d /root/vps-migration
./scripts/restore-db.sh /root/vps-migration/store.db
docker compose cp /root/vps-migration/permanent-storage/. app:/app/server/permanent-storage/
docker compose cp /root/vps-migration/uploads/. app:/app/server/uploads/
docker compose cp /root/vps-migration/releases/. app:/app/server/releases/
docker compose cp /root/vps-migration/product-images/. app:/app/server/assets/product-images/
docker compose restart app
```

Kiem tra:

```bash
curl http://127.0.0.1:3000/health
curl http://42.96.18.70:3000/health
```

## 5. Tro app ve server moi

Tam thoi dung:

```text
http://42.96.18.70:3000
```

Khi da gan domain/HTTPS, doi sang:

```text
https://ten-mien-cua-ban
```

## 6. Backup sau khi len VPS

Tren VPS:

```bash
cd /opt/dan-d-pak/deploy/company-server
./scripts/backup-db.sh
```

Restore:

```bash
./scripts/restore-db.sh backups/store_YYYYMMDD_HHMMSS.db
```
