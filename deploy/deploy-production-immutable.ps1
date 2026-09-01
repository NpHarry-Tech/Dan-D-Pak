[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Evidence,
  [Parameter(Mandatory = $true)][string]$ImageTar,
  [Parameter(Mandatory = $true)][string]$ImageManifest,
  [string]$HostName = '42.96.18.70',
  [string]$SshUser = 'root',
  [string]$RemoteRoot = '/opt/dan-d-pak'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$expectedFingerprint = 'SHA256:fmDCv6ehU4KpbB+pV7uVvFbC+M0SM6OF8YINwuAkRZM'

# This must be the first substantive gate: no DNS/SSH/SCP before all external
# canary, restore, signing, reconciliation and rollback evidence is current.
$verified = & (Join-Path $PSScriptRoot 'verify-production-evidence.ps1') `
  -Evidence $Evidence -ExpectedHost $HostName | ConvertFrom-Json
if (-not $verified.ok) { throw 'NO_GO: production evidence did not verify.' }

$tarPath = (Resolve-Path -LiteralPath $ImageTar).Path
$manifestPath = (Resolve-Path -LiteralPath $ImageManifest).Path
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$tarInfo = Get-Item -LiteralPath $tarPath
$tarHash = (Get-FileHash -LiteralPath $tarPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([int]$manifest.formatVersion -ne 1 -or $manifest.platform -ne 'linux/amd64' -or
    $manifest.gitCommit -ne $verified.gitCommit -or
    $manifest.sourceTreeSha256 -notmatch '^[0-9a-f]{64}$' -or
    $manifest.builtAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$' -or
    [int]$manifest.schemaVersion -le 0 -or
    $manifest.artifact.fileName -ne $tarInfo.Name -or
    [int64]$manifest.artifact.bytes -ne $tarInfo.Length -or
    $manifest.artifact.sha256 -ne $tarHash -or
    $verified.serverImageSha256 -ne $tarHash -or
    $manifest.imageId -notmatch '^sha256:[0-9a-f]{64}$' -or
    [string]::IsNullOrWhiteSpace([string]$manifest.imageTag)) {
  throw 'NO_GO: server image tar/manifest/evidence do not describe identical bytes and commit.'
}

$knownHosts = Join-Path ([IO.Path]::GetTempPath()) ("dandpak-known-hosts-" + [IO.Path]::GetRandomFileName())
try {
  & ssh-keyscan -T 10 -t ed25519 $HostName 2>$null | Set-Content -LiteralPath $knownHosts -Encoding ascii
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $knownHosts)) {
    throw 'NO_GO: could not obtain production SSH host key for pinned comparison.'
  }
  $fingerprintText = (& ssh-keygen -lf $knownHosts -E sha256 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $fingerprintText -notmatch [regex]::Escape($expectedFingerprint)) {
    throw 'NO_GO: production SSH host key does not match the pinned fingerprint.'
  }

  $commit = [string]$verified.gitCommit
  $stage = "$RemoteRoot/releases/server-$commit"
  $target = "$SshUser@$HostName"
  $sshOptions = @('-o', "UserKnownHostsFile=$knownHosts", '-o', 'StrictHostKeyChecking=yes')
  & ssh @sshOptions $target "mkdir -p '$stage'"
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: cannot create immutable remote staging directory.' }
  & scp @sshOptions $tarPath $manifestPath `
    (Join-Path $root 'deploy\company-server\docker-compose.immutable.yml') `
    "${target}:$stage/"
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: immutable image upload failed.' }

  $remoteTar = "$stage/$($tarInfo.Name)"
  $remoteOverride = "$stage/docker-compose.immutable.yml"
  $imageTag = [string]$manifest.imageTag
  $expectedTarHash = $tarHash
  $expectedRollbackImage = [string]$verified.rollbackImage
  $expectedRollbackImageId = [string]$verified.rollbackImageId
  $expectedSourceHash = [string]$manifest.sourceTreeSha256
  $expectedBuiltAt = [string]$manifest.builtAtUtc
  $expectedSchemaVersion = [int]$manifest.schemaVersion
  $rollbackTag = "dandpak-pos-server:rollback-$($commit.Substring(0, 12))"
  $remote = @"
set -euo pipefail
cd '$RemoteRoot/deploy/company-server'
echo '$expectedTarHash  $remoteTar' | sha256sum -c -
backup_output=`$(./scripts/backup-db.sh)
echo "`$backup_output"
live_backup_sha=`$(printf '%s\n' "`$backup_output" | sed -n 's/^BACKUP_SHA256=//p' | tail -n 1)
live_restored_sha=`$(printf '%s\n' "`$backup_output" | sed -n 's/^RESTORED_DB_SHA256=//p' | tail -n 1)
if ! printf '%s' "`$live_backup_sha" | grep -Eq '^[0-9a-f]{64}$' ||
   ! printf '%s' "`$live_restored_sha" | grep -Eq '^[0-9a-f]{64}$'; then
  echo 'Live backup did not emit verified encrypted/restored SHA evidence.' >&2
  exit 35
fi
printf 'created_at_utc=%s\nbackup_sha256=%s\nrestored_db_sha256=%s\n' \
  "`$(date -u +%Y-%m-%dT%H:%M:%SZ)" "`$live_backup_sha" "`$live_restored_sha" \
  > '$stage/live-backup-evidence.txt'
chmod 600 '$stage/live-backup-evidence.txt'
current_container=`$(docker compose ps -q app)
if [ -z "`$current_container" ]; then echo 'Current app container is missing; refusing deploy.' >&2; exit 31; fi
current_image=`$(docker inspect -f '{{.Image}}' "`$current_container")
expected_rollback_id=`$(docker image inspect '$expectedRollbackImage' -f '{{.Id}}')
if [ "`$expected_rollback_id" != '$expectedRollbackImageId' ]; then echo 'Rollback tag no longer matches rehearsed immutable image ID.' >&2; exit 36; fi
if [ "`$current_image" != "`$expected_rollback_id" ]; then echo 'Running image does not match rehearsed rollback image.' >&2; exit 33; fi
docker tag "`$current_image" '$rollbackTag'
docker load --input '$remoteTar'
loaded_id=`$(docker image inspect '$imageTag' -f '{{.Id}}')
if [ "`$loaded_id" != '$($manifest.imageId)' ]; then echo 'Loaded image ID mismatch.' >&2; exit 32; fi
rollback() {
  echo 'New image failed; restoring verified previous image.' >&2
  APP_IMAGE='$expectedRollbackImage' docker compose -f docker-compose.yml -f '$remoteOverride' up -d --no-build --wait app
  rollback_container=`$(docker compose -f docker-compose.yml -f '$remoteOverride' ps -q app)
  rollback_image=`$(docker inspect -f '{{.Image}}' "`$rollback_container")
  if [ "`$rollback_image" != '$expectedRollbackImageId' ]; then
    echo 'CRITICAL: rollback container does not match rehearsed immutable image ID.' >&2
    return 41
  fi
  docker compose -f docker-compose.yml -f '$remoteOverride' exec -T app node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{const b=await r.json();process.exit(r.ok&&b.ok&&b.database&&b.database.ok?0:1)}).catch(()=>process.exit(1))"
}
trap rollback ERR
APP_IMAGE='$imageTag' docker compose -f docker-compose.yml -f '$remoteOverride' up -d --no-build --wait app
active_container=`$(docker compose -f docker-compose.yml -f '$remoteOverride' ps -q app)
active_image=`$(docker inspect -f '{{.Image}}' "`$active_container")
if [ "`$active_image" != "`$loaded_id" ]; then echo 'Activated container image ID mismatch.' >&2; exit 34; fi
docker compose -f docker-compose.yml -f '$remoteOverride' exec -T app node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{const b=await r.json();const x=b.build||{};const ok=r.ok&&b.ok&&b.database&&b.database.ok&&x.gitCommit==='$commit'&&x.sourceTreeSha256==='$expectedSourceHash'&&x.buildTimeUtc==='$expectedBuiltAt'&&x.schemaVersion===$expectedSchemaVersion;process.exit(ok?0:1)}).catch(()=>process.exit(1))"
trap - ERR
docker image inspect '$rollbackTag' --format '{{.Id}}'
"@
  & ssh @sshOptions $target $remote
  if ($LASTEXITCODE -ne 0) { throw 'DEPLOY_FAILED: remote activation failed; rollback was requested.' }
} finally {
  Remove-Item -LiteralPath $knownHosts -Force -ErrorAction SilentlyContinue
}
