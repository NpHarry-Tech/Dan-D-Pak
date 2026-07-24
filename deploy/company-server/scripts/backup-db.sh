#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="./backups"
mkdir -p "$BACKUP_PATH"

echo "=== Dan-D-Pak encrypted database backup ==="

if docker compose ps | grep -q "app"; then
  docker compose exec -T app sqlite3 /app/server-data/store.db \
    ".backup /app/server-data/store_${TIMESTAMP}.db"
  docker compose exec -T app node server/scripts/encrypt-file.js \
    "/app/server-data/store_${TIMESTAMP}.db" \
    "/app/server-data/store_${TIMESTAMP}.db.enc" \
    "database-backup:${TIMESTAMP}"
  docker compose cp \
    app:/app/server-data/store_${TIMESTAMP}.db.enc \
    "${BACKUP_PATH}/store_${TIMESTAMP}.db.enc"
  docker compose exec -T app rm -f \
    "/app/server-data/store_${TIMESTAMP}.db" \
    "/app/server-data/store_${TIMESTAMP}.db.enc"
  chmod 600 "${BACKUP_PATH}/store_${TIMESTAMP}.db.enc"
  echo "Encrypted backup: ${BACKUP_PATH}/store_${TIMESTAMP}.db.enc"
else
  echo "App container is not running; backup skipped." >&2
  exit 1
fi
