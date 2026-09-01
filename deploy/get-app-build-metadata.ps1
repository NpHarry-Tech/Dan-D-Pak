[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$commit = (& git -C $root rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Cannot resolve Git commit for app build metadata.' }
$sourceHash = (& (Join-Path $PSScriptRoot 'get-source-tree-sha256.ps1') -Root $root).Trim()
if ($sourceHash -notmatch '^[0-9a-f]{64}$') { throw 'Cannot compute source-tree SHA-256.' }
$schemaText = Get-Content -LiteralPath (Join-Path $root 'server\db.js') -Raw
$schemaMatch = [regex]::Match($schemaText, 'PRAGMA\s+user_version\s*=\s*(\d+)')
if (-not $schemaMatch.Success) { throw 'Cannot derive canonical SQLite user_version.' }
[ordered]@{ gitCommit=$commit; sourceTreeSha256=$sourceHash; builtAtUtc=[DateTime]::UtcNow.ToString('o'); schemaVersion=[int]$schemaMatch.Groups[1].Value } | ConvertTo-Json -Compress
