#!/bin/bash
# Healthcheck script for the company server stack

set -e

echo "Checking health of Dan-D-Pak stack..."
# Check HTTP response from Caddy reverse proxy on port 80
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health || true)

if [ "$HEALTH_STATUS" = "200" ]; then
  echo "✓ Stack is HEALTHY (HTTP 200)"
  exit 0
else
  echo "✗ Stack is UNHEALTHY (HTTP $HEALTH_STATUS)"
  exit 1
fi
