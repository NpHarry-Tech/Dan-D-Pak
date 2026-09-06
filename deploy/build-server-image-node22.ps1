[CmdletBinding()]
param([string]$OutputDirectory)

# Same immutable build as build-server-image.ps1, but the canonical backend
# suite runs INSIDE the built Node 22 image (matching server/Dockerfile FROM
# node:22-bookworm-slim) instead of the host node. Rationale: node:sqlite
# backup() aborts natively on Node 24 hosts; the runtime is pinned to Node 22.
# No gate is relaxed — the same suite, provenance and packaging checks run.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$commit = (& git -C $root rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'NO_GO: cannot resolve a clean Git commit.' }
$dirty = @(& git -C $root status --porcelain=v1 --untracked-files=all)
if ($dirty.Count -gt 0) { throw "NO_GO: immutable server images can only be built from a clean committed worktree.`n$($dirty -join "`n")" }
$sourceHash = (& (Join-Path $PSScriptRoot 'get-source-tree-sha256.ps1') -Root $root).Trim()
if ($sourceHash -notmatch '^[0-9a-f]{64}$') { throw 'NO_GO: invalid source-tree SHA-256.' }
$builtAtUtc = [DateTime]::UtcNow.ToString('o')
$schemaText = Get-Content -LiteralPath (Join-Path $root 'server\db.js') -Raw
$schemaMatch = [regex]::Match($schemaText, 'PRAGMA\s+user_version\s*=\s*(\d+)')
if (-not $schemaMatch.Success) { throw 'NO_GO: cannot derive canonical SQLite schema version.' }
$schemaVersion = [int]$schemaMatch.Groups[1].Value

Push-Location $root
try {
  & npm audit --omit=dev --audit-level=high
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: high/critical production dependency vulnerability detected.' }

  & docker version --format '{{.Server.Version}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: Docker Linux daemon is unavailable.' }

  $base = [regex]::Match((Get-Content -LiteralPath 'server/Dockerfile' -Raw), '(?m)^FROM\s+(\S+)').Groups[1].Value
  # Digest-pinned base: pulling fetches the exact same bytes, keeping the build
  # reproducible while guaranteeing --pull=false below can resolve it from cache.
  & docker pull $base | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: cannot obtain pinned base image.' }

  $short = $commit.Substring(0, 12)
  $tag = "dandpak-pos-server:$short"
  & docker build --platform linux/amd64 --pull=false --provenance=false --sbom=false `
    --build-arg "BUILD_GIT_COMMIT=$commit" `
    --build-arg "BUILD_SOURCE_SHA256=$sourceHash" `
    --build-arg "BUILD_TIME_UTC=$builtAtUtc" `
    --tag $tag --file server/Dockerfile .
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: server image build failed.' }

  $imageId = (& docker image inspect $tag --format '{{.Id}}').Trim()
  $labels = (& docker image inspect $tag --format '{{json .Config.Labels}}') | ConvertFrom-Json
  if ($imageId -notmatch '^sha256:[0-9a-f]{64}$' -or
      [string]$labels.'org.opencontainers.image.revision' -ne $commit -or
      [string]$labels.'io.dandpak.source-sha256' -ne $sourceHash -or
      [string]$labels.'org.opencontainers.image.created' -ne $builtAtUtc) {
    throw 'NO_GO: built image identity/labels do not match source provenance.'
  }

  # Canonical backend suite INSIDE the built Node 22 image. scripts/ is mounted
  # read-only (the runtime image copies only server/). Full strength, same runner.
  $scriptsMount = ($root -replace '\\','/') + '/scripts:/app/scripts:ro'
  $testLog = Join-Path ([IO.Path]::GetTempPath()) "ddp-node22-suite-$short.log"
  & docker run --rm --platform linux/amd64 -v $scriptsMount $tag node scripts/run-backend-tests.mjs *>&1 |
    Tee-Object -FilePath $testLog
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: canonical server test suite failed inside Node 22 image.' }
  $suiteText = Get-Content -LiteralPath $testLog -Raw
  $matrix = [regex]::Match($suiteText, '# MATRIX: files=(\d+) PASS=(\d+) FAIL=(\d+) TIMEOUT=(\d+) ERROR=(\d+)')
  $assert = [regex]::Match($suiteText, '# assertions: pass=(\d+) fail=(\d+)')
  if (-not $matrix.Success -or [int]$matrix.Groups[3].Value -ne 0 -or [int]$matrix.Groups[5].Value -ne 0) {
    throw 'NO_GO: canonical suite reported FAIL/ERROR files.'
  }
  $serverTestFiles = [int]$matrix.Groups[1].Value
  $serverAssertionsPassed = [int]$assert.Groups[1].Value

  if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'artifacts\server' }
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $tar = Join-Path $OutputDirectory "dandpak-pos-server-$short.tar"
  & docker save --output $tar $tag
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tar)) { throw 'NO_GO: failed to export immutable server image.' }
  $tarInfo = Get-Item -LiteralPath $tar
  $tarHash = (Get-FileHash -LiteralPath $tar -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifestPath = "$tar.manifest.json"
  [ordered]@{
    formatVersion = 1
    product = 'Dan-D Pak POS Server'
    platform = 'linux/amd64'
    builtAtUtc = $builtAtUtc
    gitCommit = $commit
    sourceTreeSha256 = $sourceHash
    schemaVersion = $schemaVersion
    baseImage = $base
    imageTag = $tag
    imageId = $imageId
    testRuntime = 'node:22 (in-image)'
    serverTestFiles = $serverTestFiles
    serverAssertionsPassed = $serverAssertionsPassed
    artifact = [ordered]@{ fileName = $tarInfo.Name; bytes = $tarInfo.Length; sha256 = $tarHash }
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Output ([ordered]@{ ok=$true; image=$tag; imageId=$imageId; tar=$tar; manifest=$manifestPath; sha256=$tarHash; serverTestFiles=$serverTestFiles; serverAssertionsPassed=$serverAssertionsPassed } | ConvertTo-Json -Compress)
} finally {
  Pop-Location
}
