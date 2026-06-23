#!/bin/bash
# Restore script to be executed from the deploy/company-server directory on the host

set -e

if [ -z "$1" ]; then
  echo "Usage: ./scripts/restore-db.sh <backup_file_path>"
  echo "Example: ./scripts/restore-db.sh backups/store_20260623_080000.db"
  echo "Example: ./scripts/restore-db.sh postgres_20260623_080000.dump (must exist in backups/ volume)"
  exit 1
fi

FILE_PATH="$1"
FILE_NAME=$(basename "$FILE_PATH")

echo "=== Dan-D-Pak Database Restore ==="

if [[ "$FILE_NAME" == *store_*.db ]]; then
  echo "Restoring SQLite database from $FILE_PATH..."
  if [ ! -f "$FILE_PATH" ]; then
    echo "Error: Backup file $FILE_PATH not found on host."
    exit 1
  fi
  # Copy file to container
  docker compose cp "$FILE_PATH" app:/app/server-data/store_restore.db
  # Stop application process or copy/overwrite database
  docker compose exec -t app sh -c "mv /app/server-data/store_restore.db /app/server-data/store.db"
  echo "✓ SQLite database restored. Restarting app container..."
  docker compose restart app
  echo "✓ Restore completed."

elif [[ "$FILE_NAME" == *postgres_*.dump ]]; then
  echo "Restoring PostgreSQL database from $FILE_NAME..."
  # Since pg_dump was saved to /backups inside postgres container, pg_restore needs it inside the container
  docker compose exec -t postgres pg_restore -U dandpak -d dandpak --clean --no-owner "/backups/$FILE_NAME"
  echo "✓ PostgreSQL database restored."
  echo "✓ Restarting app container..."
  docker compose restart app
  echo "✓ Restore completed."
else
  echo "Error: Unrecognized backup file format. Must be store_*.db or postgres_*.dump"
  exit 1
fi
