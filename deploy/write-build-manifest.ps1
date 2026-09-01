[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Artifact,
  [Parameter(Mandatory = $true)][ValidateSet('windows', 'android', 'android-phone')][string]$Platform,
  [Parameter(Mandatory = $true)][int]$Build,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Output,
  [string]$BuiltAtUtc,
  [string]$SourceTreeSha256,
  [string]$GitCommit
)

$ErrorActionPreference = 'Stop'
if ($BuiltAtUtc -and $BuiltAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$') {
  throw 'BuiltAtUtc must be a canonical UTC timestamp.'
}
$root = Split-Path -Parent $PSScriptRoot
$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
if (-not $Output) { $Output = "$artifactPath.manifest.json" }

$commit = if ($GitCommit) { $GitCommit } else { (& git -C $root rev-parse HEAD 2>$null).Trim() }
if ($LASTEXITCODE -ne 0 -or -not $commit) { throw 'Cannot resolve Git commit for build provenance.' }
$ephemeralPattern = '^(\.codex-test-temp/|tmp/|runtime/|artifacts/|.*(?:^|/)build/|.*(?:^|/)\.dart_tool/|.*(?:^|/)\.gradle/|.*(?:^|/)\.kotlin/)'
function Test-SourcePath([string]$Relative) {
  $normalized = $Relative -replace '\\', '/'
  return $normalized -notmatch $ephemeralPattern
}
$status = @(& git -C $root status --porcelain=v1 --untracked-files=all) |
  Where-Object {
    $path = if ($_.Length -gt 3) { $_.Substring(3).Trim('"') } else { '' }
    Test-SourcePath $path
  }
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git worktree for build provenance.' }

$schemaText = Get-Content -LiteralPath (Join-Path $root 'server\db.js') -Raw
$schemaMatch = [regex]::Match($schemaText, 'PRAGMA\s+user_version\s*=\s*(\d+)')
if (-not $schemaMatch.Success) { throw 'Cannot derive canonical SQLite user_version from server/db.js.' }
$targetSchemaVersion = [int]$schemaMatch.Groups[1].Value

$sourceHash = if ($SourceTreeSha256) { $SourceTreeSha256 } else {
  (& (Join-Path $PSScriptRoot 'get-source-tree-sha256.ps1') -Root $root).Trim()
}
if ($sourceHash -notmatch '^[0-9a-f]{64}$') { throw 'Cannot compute source-tree SHA-256.' }

$artifactInfo = Get-Item -LiteralPath $artifactPath
$manifest = [ordered]@{
  formatVersion = 1
  product = 'Dan D Pak POS'
  platform = $Platform
  version = $Version
  build = $Build
  builtAtUtc = $(if ($BuiltAtUtc) { $BuiltAtUtc } else { [DateTime]::UtcNow.ToString('o') })
  gitCommit = $commit
  worktreeDirty = ($status.Count -gt 0)
  sourceTreeSha256 = $sourceHash
  schemaCompatibility = [ordered]@{
    provider = 'sqlite'
    minimumInputUserVersion = 0
    targetUserVersion = $targetSchemaVersion
    migrationPolicy = 'additive'
  }
  artifact = [ordered]@{
    fileName = $artifactInfo.Name
    bytes = $artifactInfo.Length
    sha256 = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$parent = Split-Path -Parent $Output
if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding UTF8
Write-Host "Manifest: $Output" -ForegroundColor Green
