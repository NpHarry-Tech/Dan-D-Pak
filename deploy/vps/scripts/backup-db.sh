#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ts="$(date +%Y%m%d_%H%M%S)"
mkdir -p backups
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-dandpak}" "${POSTGRES_DB:-dandpak}" > "backups/postgres_${ts}.dump"
echo "Wrote backups/postgres_${ts}.dump"
