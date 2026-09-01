#!/usr/bin/env bash
# Bản dịch bash của deploy/build-server-image.ps1 — chạy trên máy CÓ Docker
# (Linux). Tạo image linux/amd64 + tar + manifest.json khớp provenance để dùng
# cho deploy-production-immutable. KHÔNG thay thế bước Evidence (chứng cứ an
# toàn: restore/rollback/reconciliation) — cái đó là quy trình rehearsal thật.
#
# Dùng:  bash deploy/build-server-image.sh [OUT_DIR]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/artifacts/server-images}"
mkdir -p "$out"
cd "$root"

commit="$(git rev-parse HEAD)"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "NO_GO: commit không sạch"; exit 1; }
# Ảnh immutable chỉ dựng từ worktree đã commit sạch (đúng như bản PowerShell).
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "NO_GO: worktree còn thay đổi chưa commit — immutable image cần cây sạch."
  git status --short | head; exit 1
fi

# SHA-256 cây nguồn: hash nối (đường-dẫn + "\n" + nội-dung) theo thứ tự sort,
# bỏ thư mục tạm — TRÙNG thuật toán get-source-tree-sha256.ps1.
source_sha="$(
  git ls-files --cached --others --exclude-standard \
    | grep -vE '^(\.codex-test-temp/|tmp/|runtime/|artifacts/|(.*/)?build/|(.*/)?\.dart_tool/|(.*/)?\.gradle/)' \
    | LC_ALL=C sort -u \
    | while IFS= read -r f; do [ -f "$f" ] || continue; printf '%s\n' "$f"; cat -- "$f"; done \
    | sha256sum | awk '{print $1}'
)"
[[ "$source_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "NO_GO: source sha256 sai"; exit 1; }

built_at="$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"
schema="$(grep -oE 'PRAGMA[[:space:]]+user_version[[:space:]]*=[[:space:]]*[0-9]+' server/db.js | grep -oE '[0-9]+' | head -1)"
short="${commit:0:12}"
tag="dandpak-pos-server:$short"

echo ">> npm audit (prod, high+)"; npm audit --omit=dev --audit-level=high
echo ">> chạy toàn bộ server test"; node --test $(find server -name '*.test.mjs' | sort)
echo ">> docker build $tag"
docker build --platform linux/amd64 --pull=false \
  --build-arg "BUILD_GIT_COMMIT=$commit" \
  --build-arg "BUILD_SOURCE_SHA256=$source_sha" \
  --build-arg "BUILD_TIME_UTC=$built_at" \
  --tag "$tag" --file server/Dockerfile .

image_id="$(docker image inspect "$tag" --format '{{.Id}}')"
tar="$out/dandpak-pos-server-$short.tar"
docker save "$tag" -o "$tar"
tar_sha="$(sha256sum "$tar" | awk '{print $1}')"
tar_bytes="$(stat -c%s "$tar")"

manifest="$out/dandpak-pos-server-$short.manifest.json"
cat > "$manifest" <<JSON
{
  "formatVersion": 1,
  "platform": "linux/amd64",
  "gitCommit": "$commit",
  "sourceTreeSha256": "$source_sha",
  "builtAtUtc": "$built_at",
  "schemaVersion": $schema,
  "imageId": "$image_id",
  "imageTag": "$tag",
  "artifact": { "fileName": "$(basename "$tar")", "bytes": $tar_bytes, "sha256": "$tar_sha" }
}
JSON

echo
echo "ImageTar      : $tar"
echo "ImageManifest : $manifest"
echo "serverImageSha256 (dùng cho Evidence): $tar_sha"
echo
echo "Evidence CHƯA có — đó là chứng cứ rehearsal thật (restore/rollback/reconcile),"
echo "không tạo bằng script build. Xem verify-production-evidence.ps1 để biết trường bắt buộc."
