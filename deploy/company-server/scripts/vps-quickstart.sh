#!/usr/bin/env bash
# Cài đặt nhanh Dan D Pak POS/ERP lên VPS Ubuntu 22.04 mới tinh (chạy bằng root).
#
# Cách dùng (sau khi clone repo):
#   cd /opt/dan-d-pak/deploy/company-server
#   bash scripts/vps-quickstart.sh <IP-public-hoặc-domain>
#
# Script này: cài Docker (nếu thiếu) → sinh .env với secret ngẫu nhiên →
# docker compose up → mở tường lửa 22/80/443 → chờ health OK.
set -euo pipefail

HOST="${1:?Thiếu tham số. Dùng: bash scripts/vps-quickstart.sh <IP-public-hoặc-domain>}"
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "[quickstart] Cài Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  # IP trần → http (app client tự ép http cho IP). Đổi sang domain sau này thì
  # sửa 4 dòng đầu thành https://<domain> và sửa Caddyfile — Caddy tự cấp TLS.
  cat > .env <<EOF
APP_DOMAIN=${HOST}
APP_URL=http://${HOST}
API_BASE_URL=http://${HOST}
CORS_ORIGIN=http://${HOST}
NODE_ENV=production
PORT=3000
DEPLOYMENT_TARGET=company-server
DATABASE_PROVIDER=sqlite
DATABASE_URL=sqlite:///app/server-data/store.db
REALTIME_PROVIDER=socketio
STORAGE_PROVIDER=local
STORAGE_PATH=/app/storage
JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
EOF
  chmod 600 .env
  echo "[quickstart] Đã tạo .env cho ${HOST} (secret sinh ngẫu nhiên, file chmod 600)."
else
  echo "[quickstart] .env đã tồn tại — giữ nguyên."
fi

echo "[quickstart] Khởi chạy docker compose (lần đầu 2-5 phút)..."
docker compose up -d --build

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 3000/tcp >/dev/null   # app POS nhập IP trần tự nối :3000
  ufw --force enable >/dev/null
  echo "[quickstart] Tường lửa: chỉ mở 22 (SSH), 80, 443, 3000."
fi

echo "[quickstart] Chờ server sẵn sàng..."
for i in $(seq 1 45); do
  if curl -fsS "http://localhost/health" >/dev/null 2>&1; then
    echo ""
    echo "[quickstart] ✅ XONG — DB đã tự nạp từ server/config-seed.json."
    echo "[quickstart] Mở:  http://${HOST}"
    echo "[quickstart] Máy POS: đăng nhập với Server URL = http://${HOST}"
    echo "[quickstart] ⚠️  Việc đầu tiên: đổi PIN của TẤT CẢ nhân viên (Cài đặt → Nhân sự)."
    exit 0
  fi
  sleep 2
done

echo "[quickstart] ⚠️  Server chưa trả lời /health sau 90s — xem log:"
echo "    docker compose logs -f app"
exit 1
