#!/usr/bin/env bash
set -euo pipefail

RELEASE_ROOT=/opt/dan-d-pak/releases
KEEP_RELEASES="${KEEP_RELEASES:-3}"
KEEP_POS_IMAGES="${KEEP_POS_IMAGES:-3}"

declare -A keep_release=()
while IFS= read -r dir; do
  [[ -n "$dir" ]] && keep_release["$dir"]=1
done < <(find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'server-*' \
  -printf '%T@ %p\n' | sort -rn | head -n "$KEEP_RELEASES" | cut -d' ' -f2-)

while IFS= read -r dir; do
  [[ -n "$dir" ]] || continue
  [[ -n "${keep_release[$dir]:-}" ]] && continue
  resolved=$(readlink -f -- "$dir")
  case "$resolved" in
    "$RELEASE_ROOT"/server-*) rm -rf -- "$resolved" ;;
    *) logger -p daemon.err -t dandpak-storage "refused unsafe release path: $resolved" ;;
  esac
done < <(find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'server-*' -print)

declare -A keep_image=()
running_id=$(docker inspect -f '{{.Image}}' company-server-app-1 2>/dev/null || true)
running_short=${running_id#sha256:}
running_short=${running_short:0:12}
[[ -n "$running_short" ]] && keep_image["$running_short"]=1

kept=0
while IFS= read -r image_id; do
  [[ -n "$image_id" ]] || continue
  if [[ -z "${keep_image[$image_id]:-}" ]]; then
    keep_image["$image_id"]=1
  fi
  kept=$((kept + 1))
  (( kept >= KEEP_POS_IMAGES )) && break
done < <(docker images dandpak-pos-server --format '{{.ID}}' | awk '!seen[$0]++')

while read -r tag image_id; do
  [[ -n "$tag" && "$tag" != '<none>:<none>' ]] || continue
  case "$tag" in
    dandpak-pos-server:*|company-server-app:*)
      [[ -n "${keep_image[$image_id]:-}" ]] || docker image rm "$tag" >/dev/null 2>&1 || true
      ;;
  esac
done < <(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}')

docker image prune -f >/dev/null
docker builder prune -f --filter 'until=168h' >/dev/null
logger -p daemon.notice -t dandpak-storage \
  "maintenance complete: root_used=$(df -P / | awk 'NR==2 {print $5}') releases_kept=$KEEP_RELEASES pos_images_kept=$KEEP_POS_IMAGES"
