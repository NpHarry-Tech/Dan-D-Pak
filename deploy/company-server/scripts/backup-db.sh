#!/bin/bash
# Backup script to be executed from the deploy/company-server directory on the host

set -e

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="./backups"
mkdir -p "$BACKUP_PATH"

echo "=== Dan-D-Pak Database Backup ==="

# 1. Backup SQLite database from 'app' container
echo "Backing up SQLite database..."
if docker compose ps | grep -q "app"; then
  # Create a clean backup using sqlite3 CLI inside the app container
  docker compose exec -t app sqlite3 /app/server-data/store.db ".backup /app/server-data/store_${TIMESTAMP}.db"
  # Copy it to the host backup folder
  docker compose cp app:/app/server-data/store_${TIMESTAMP}.db "${BACKUP_PATH}/store_${TIMESTAMP}.db"
  # Delete the temp file inside container
  docker compose exec -t app rm /app/server-data/store_${TIMESTAMP}.db
  echo "✓ SQLite backup saved to ${BACKUP_PATH}/store_${TIMESTAMP}.db"
else
  echo "⚠ Warning: 'app' container is not running. Skipping SQLite backup."
fi

# 2. Backup PostgreSQL database from 'postgres' container
echo "Backing up PostgreSQL database..."
if docker compose ps | grep -q "postgres"; then
  # Dump using pg_dump inside the container and redirect to host file
  docker compose exec -t postgres pg_dump -U dandpak -d dandpak -F c -f "/backups/postgres_${TIMESTAMP}.dump"
  echo "✓ PostgreSQL backup saved to container's /backups directory as postgres_${TIMESTAMP}.dump"
else
  echo "⚠ Warning: 'postgres' container is not running. Skipping PostgreSQL backup."
fi

echo "=== Backup Completed Successfully ==="
