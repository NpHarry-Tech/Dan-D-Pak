#!/bin/bash
# Restore script to be executed from deploy/company-server on the VPS.

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/restore-db.sh <backup_file_path>"
  echo "Example: ./scripts/restore-db.sh backups/store_20260623_080000.db"
  echo "Example: ./scripts/restore-db.sh /root/vps-migration/store.db"
  exit 1
fi

FILE_PATH="$1"
FILE_NAME=$(basename "$FILE_PATH")

echo "=== Dan-D-Pak Database Restore ==="

if [[ "$FILE_NAME" == "store.db" || "$FILE_NAME" == store_*.db || "$FILE_NAME" == store-*.db ]]; then
  echo "Restoring SQLite database from $FILE_PATH..."
  if [ ! -f "$FILE_PATH" ]; then
    echo "Error: Backup file $FILE_PATH not found on host."
    exit 1
  fi

  echo "Stopping app before replacing SQLite..."
  docker compose stop app
  docker compose cp "$FILE_PATH" app:/app/server-data/store.db
  echo "Starting app container..."
  docker compose start app
  echo "SQLite restore completed."
elif [[ "$FILE_NAME" == postgres_*.dump ]]; then
  echo "Restoring PostgreSQL database from $FILE_NAME..."
  docker compose exec -t postgres pg_restore -U dandpak -d dandpak --clean --no-owner "/backups/$FILE_NAME"
  docker compose restart app
  echo "PostgreSQL restore completed."
else
  echo "Error: Unrecognized backup file format. Must be store.db, store_*.db, store-*.db, or postgres_*.dump"
  exit 1
fi
