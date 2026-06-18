#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing deploy/vps/.env. Copy .env.example to .env and edit secrets first." >&2
  exit 1
fi

docker compose pull || true
docker compose build
docker compose up -d
./scripts/healthcheck.sh
