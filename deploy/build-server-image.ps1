[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$commit = (& git -C $root rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
  throw 'NO_GO: cannot resolve a clean Git commit.'
}
$dirty = @(& git -C $root status --porcelain=v1 --untracked-files=all)
if ($dirty.Count -gt 0) {
  throw 'NO_GO: immutable server images can only be built from a clean committed worktree.'
}
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
  $serverTests = @(Get-ChildItem -LiteralPath (Join-Path $root 'server') -Recurse -File -Filter '*.test.mjs' |
    Sort-Object FullName | ForEach-Object FullName)
  if ($serverTests.Count -eq 0) { throw 'NO_GO: no server tests were discovered.' }
  & node --test @serverTests
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: server test suite failed.' }

  & docker version --format '{{.Server.Version}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: Docker Linux daemon is unavailable.' }

  $short = $commit.Substring(0, 12)
  $tag = "dandpak-pos-server:$short"
  & docker build --platform linux/amd64 --pull=false `
    --build-arg "BUILD_GIT_COMMIT=$commit" `
    --build-arg "BUILD_SOURCE_SHA256=$sourceHash" `
    --build-arg "BUILD_TIME_UTC=$builtAtUtc" `
    --tag $tag --file server/Dockerfile .
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: server image build failed.' }

  $imageId = (& docker image inspect $tag --format '{{.Id}}').Trim()
  $labelCommit = (& docker image inspect $tag --format '{{index .Config.Labels "org.opencontainers.image.revision"}}').Trim()
  $labelSource = (& docker image inspect $tag --format '{{index .Config.Labels "io.dandpak.source-sha256"}}').Trim()
  $labelBuiltAt = (& docker image inspect $tag --format '{{index .Config.Labels "org.opencontainers.image.created"}}').Trim()
  if ($imageId -notmatch '^sha256:[0-9a-f]{64}$' -or $labelCommit -ne $commit -or
      $labelSource -ne $sourceHash -or $labelBuiltAt -ne $builtAtUtc) {
    throw 'NO_GO: built image identity/labels do not match source provenance.'
  }

  if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'artifacts\server' }
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $tar = Join-Path $OutputDirectory "dandpak-pos-server-$short.tar"
  & docker save --output $tar $tag
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tar)) {
    throw 'NO_GO: failed to export immutable server image.'
  }
  $tarInfo = Get-Item -LiteralPath $tar
  $tarHash = (Get-FileHash -LiteralPath $tar -Algorithm SHA256).Hash.ToLowerInvariant()
  $base = [regex]::Match((Get-Content -LiteralPath 'server/Dockerfile' -Raw), '(?m)^FROM\s+(\S+)').Groups[1].Value
  $manifestPath = "$tar.manifest.json"
  [ordered]@{
    formatVersion = 1
    product = 'Dan D Pak POS Server'
    platform = 'linux/amd64'
    builtAtUtc = $builtAtUtc
    gitCommit = $commit
    sourceTreeSha256 = $sourceHash
    schemaVersion = $schemaVersion
    baseImage = $base
    imageTag = $tag
    imageId = $imageId
    artifact = [ordered]@{ fileName = $tarInfo.Name; bytes = $tarInfo.Length; sha256 = $tarHash }
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Output ([ordered]@{ ok=$true; image=$tag; imageId=$imageId; tar=$tar; manifest=$manifestPath; sha256=$tarHash } | ConvertTo-Json -Compress)
} finally {
  Pop-Location
}
