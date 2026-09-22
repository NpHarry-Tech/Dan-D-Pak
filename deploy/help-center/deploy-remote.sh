#!/usr/bin/env sh
set -eu

stamp="20260920-142022"
archive="/tmp/dandpak-help-${stamp}.tar.gz"
base="/opt/dandpak-help"
caddy_file="/opt/dan-d-pak/deploy/company-server/Caddyfile"
caddy_backup="${caddy_file}.before-help-${stamp}"
caddy_candidate="/tmp/Caddyfile.help-merged"

test -f "$archive"
test -f "$caddy_file"

mkdir -p "$base"
tar -xzf "$archive" -C "$base"
cd "$base"
docker compose config >/dev/null
docker compose up -d --wait
docker exec dandpak-help-center nginx -t
docker exec dandpak-help-center wget -qO- http://127.0.0.1/vi/ >/dev/null

cp "$caddy_file" "$caddy_backup"
cp "$caddy_file" "$caddy_candidate"
if ! grep -q 'HELP_DOMAIN' "$caddy_candidate"; then
  cat >> "$caddy_candidate" <<'CADDY'

{$HELP_DOMAIN:help.42.96.18.70.sslip.io} {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    reverse_proxy help-center:80
}
CADDY
fi

docker run --rm \
  -e APP_DOMAIN=api.dandpakpos.io.vn \
  -v "$caddy_candidate:/etc/caddy/Caddyfile:ro" \
  caddy:2 caddy validate --config /etc/caddy/Caddyfile

cp "$caddy_candidate" "$caddy_file"
if ! docker exec company-server-caddy-1 caddy reload --config /etc/caddy/Caddyfile; then
  cp "$caddy_backup" "$caddy_file"
  docker exec company-server-caddy-1 caddy reload --config /etc/caddy/Caddyfile || true
  exit 1
fi

docker exec company-server-app-1 node -e \
  "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

echo "HELP_CENTER_DEPLOYED=${stamp}"
echo "CADDY_BACKUP=${caddy_backup}"
