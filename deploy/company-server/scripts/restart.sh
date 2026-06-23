#!/bin/bash
# Restart script for the company server stack

set -e

echo "Restarting Dan-D-Pak Docker services..."
docker compose restart
echo "Services restarted successfully."
