#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="./backups"
PLAIN="/app/server-data/store_${TIMESTAMP}.db"
ENCRYPTED="${PLAIN}.enc"
VERIFY="/app/server-data/store_${TIMESTAMP}.verify.db"
HOST_BACKUP="${BACKUP_PATH}/store_${TIMESTAMP}.db.enc"
mkdir -p "$BACKUP_PATH"

echo "=== Dan-D-Pak encrypted database backup ==="

cleanup() {
  docker compose exec -T app rm -f "$PLAIN" "$ENCRYPTED" "$VERIFY" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if docker compose ps | grep -q "app"; then
  docker compose exec -T app sqlite3 /app/server-data/store.db \
    ".backup $PLAIN"
  docker compose exec -T app node server/scripts/encrypt-file.js \
    "$PLAIN" \
    "$ENCRYPTED" \
    "database-backup:${TIMESTAMP}"
  # A file existing is not proof of recoverability. Authenticate/decrypt it,
  # compare exact DB bytes and run SQLite integrity before copying off-container.
  docker compose exec -T app node server/scripts/decrypt-file.js \
    "$ENCRYPTED" "$VERIFY" "database-backup:${TIMESTAMP}"
  PLAIN_SHA=$(docker compose exec -T app sha256sum "$PLAIN" | awk '{print $1}')
  VERIFY_SHA=$(docker compose exec -T app sha256sum "$VERIFY" | awk '{print $1}')
  if [ "$PLAIN_SHA" != "$VERIFY_SHA" ]; then
    echo "Backup decrypt SHA mismatch; refusing to publish backup." >&2
    exit 2
  fi
  QUICK_CHECK=$(docker compose exec -T app sqlite3 "$VERIFY" "PRAGMA quick_check;" | tr -d '\r\n')
  if [ "$QUICK_CHECK" != "ok" ]; then
    echo "Backup quick_check failed: $QUICK_CHECK" >&2
    exit 3
  fi
  CONTAINER_ENCRYPTED_SHA=$(docker compose exec -T app sha256sum "$ENCRYPTED" | awk '{print $1}')
  docker compose cp \
    "app:${ENCRYPTED}" "$HOST_BACKUP"
  HOST_ENCRYPTED_SHA=$(sha256sum "$HOST_BACKUP" | awk '{print $1}')
  if [ "$CONTAINER_ENCRYPTED_SHA" != "$HOST_ENCRYPTED_SHA" ]; then
    rm -f "$HOST_BACKUP"
    echo "Encrypted backup copy SHA mismatch; corrupt copy removed." >&2
    exit 4
  fi
  chmod 600 "$HOST_BACKUP"
  echo "Encrypted backup verified: $HOST_BACKUP"
  echo "BACKUP_SHA256=$HOST_ENCRYPTED_SHA"
  echo "RESTORED_DB_SHA256=$VERIFY_SHA"
else
  echo "App container is not running; backup skipped." >&2
  exit 1
fi
