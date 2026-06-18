#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
domain="${APP_DOMAIN:-localhost}"
scheme="https"
if [ "$domain" = "localhost" ]; then
  scheme="http"
fi

url="${scheme}://${domain}/health"
echo "Checking ${url}"
curl -fsS "$url" | head -c 1000
echo
