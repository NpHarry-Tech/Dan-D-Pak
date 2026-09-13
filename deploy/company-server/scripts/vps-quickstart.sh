#!/usr/bin/env bash
# Cài đặt nhanh Dan-D Pak POS/ERP lên VPS Ubuntu 22.04 mới tinh (chạy bằng root).
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
# VPS ở datacenter không với tới máy in/két trong cửa hàng → chỉ xếp hàng job
# in; Hardware Agent chạy tại cửa hàng (server/agent.js) sẽ in vật lý tại chỗ.
PRINT_DISPATCH=agent
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
  # KHÔNG mở 3000/tcp ra internet: server chỉ expose 3000 nội bộ cho Caddy (xem
  # docker-compose.yml); app truy cập qua Caddy ở cổng 80/443, không cần 3000
  # ra ngoài. Mở thêm 3000 chỉ tạo lỗ hổng HTTP trần không TLS mà không phục vụ
  # đường dùng thật nào — BẢO MẬT (đã dò thấy 2026-09-13, chưa từng bị khai
  # thác vì VPS thật không chạy script này, nhưng script vẫn phải an toàn).
  ufw --force enable >/dev/null
  echo "[quickstart] Tường lửa: chỉ mở 22 (SSH), 80, 443."
fi

echo "[quickstart] Chờ server sẵn sàng..."
for i in $(seq 1 45); do
  if curl -fsS "http://localhost/health" >/dev/null 2>&1; then
    echo ""
    echo "[quickstart] ✅ XONG — server đã chạy (DB trống sẽ seed demo; phục hồi dữ liệu thật bằng backup SQLite)."
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
