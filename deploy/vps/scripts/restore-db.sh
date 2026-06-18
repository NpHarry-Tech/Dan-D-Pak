#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${1:-}" = "" ]; then
  echo "Usage: ./scripts/restore-db.sh backups/postgres_YYYYMMDD_HHMMSS.dump" >&2
  exit 1
fi

echo "WARNING: restore can overwrite database state. Confirm you are restoring to the intended target."
read -r -p "Type RESTORE to continue: " confirm
if [ "$confirm" != "RESTORE" ]; then
  echo "Restore cancelled."
  exit 1
fi

docker compose exec -T postgres psql -U "${POSTGRES_USER:-dandpak}" -d "${POSTGRES_DB:-dandpak}" < "$1"
