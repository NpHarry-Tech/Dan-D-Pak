#!/usr/bin/env bash
set -euo pipefail

CRITICAL_KB="${MEM_AVAILABLE_CRITICAL_KB:-131072}"
RECOVER_KB="${MEM_AVAILABLE_RECOVER_KB:-393216}"
COOLDOWN_SECONDS="${MEMORY_GUARD_COOLDOWN_SECONDS:-900}"
MARKER=/run/dandpak-memory-guard.shed

available_kb=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
swap_free_kb=$(awk '/^SwapFree:/ { print $2 }' /proc/meminfo)
root_used_pct=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')

snapshot() {
  docker stats --no-stream --format '{{.Name}}={{.MemUsage}}' 2>/dev/null | paste -sd ';' - || true
}

if (( root_used_pct >= 90 )); then
  logger -p daemon.warning -t dandpak-memory-guard \
    "disk pressure: root=${root_used_pct}% mem_available=${available_kb}KB"
fi

if (( available_kb < CRITICAL_KB )); then
  logger -p daemon.crit -t dandpak-memory-guard \
    "critical memory pressure: available=${available_kb}KB swap_free=${swap_free_kb}KB containers=$(snapshot)"
  if [[ ! -e "$MARKER" ]]; then
    date +%s > "$MARKER"
    # Review is non-production. Shed it first so the production POS and SQLite
    # retain enough memory to finish in-flight transactions cleanly.
    docker stop --time 20 dandpak-review-app-1 dandpak-review-portal-1 >/dev/null 2>&1 || true
    logger -p daemon.alert -t dandpak-memory-guard \
      "shed non-production review containers to protect POS"
  fi
  exit 0
fi

if [[ -e "$MARKER" ]] && (( available_kb >= RECOVER_KB )); then
  shed_at=$(cat "$MARKER" 2>/dev/null || echo 0)
  now=$(date +%s)
  if (( now - shed_at >= COOLDOWN_SECONDS )); then
    docker start dandpak-review-app-1 dandpak-review-portal-1 >/dev/null 2>&1 || true
    rm -f "$MARKER"
    logger -p daemon.notice -t dandpak-memory-guard \
      "memory recovered: available=${available_kb}KB; review containers restarted"
  fi
fi
