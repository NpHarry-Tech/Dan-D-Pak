[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$EncryptedBackup,
  [string]$EvidenceFragment
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backup = (Resolve-Path -LiteralPath $EncryptedBackup).Path
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
  throw 'NO_GO: encrypted production backup does not exist.'
}
if ([string]::IsNullOrWhiteSpace([string]$env:DATA_ENCRYPTION_KEY)) {
  throw 'NO_GO: DATA_ENCRYPTION_KEY must be supplied through the process environment.'
}
$fileName = [IO.Path]::GetFileName($backup)
$legacyMatch = [regex]::Match($fileName, '^store_(\d{8}_\d{6})\.db\.enc$')
$liveMatch = [regex]::Match($fileName, '^store-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.db\.enc$')
if (-not $legacyMatch.Success -and -not $liveMatch.Success) {
  throw 'NO_GO: backup name must be store_YYYYMMDD_HHMMSS.db.enc or store-YYYY-MM-DDTHH-MM-SS.db.enc.'
}

$encryptedSha = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
$stamp = if ($liveMatch.Success) { $liveMatch.Groups[1].Value } else { $legacyMatch.Groups[1].Value }
$context = "database-backup:$stamp"
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('ddp-production-restore-' + [IO.Path]::GetRandomFileName())
$plain = Join-Path $temporary 'production-copy.db'
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  & node (Join-Path $root 'server\scripts\decrypt-file.js') $backup $plain $context
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $plain -PathType Leaf)) {
    throw 'NO_GO: authenticated production backup decryption failed.'
  }
  $plainSha = (Get-FileHash -LiteralPath $plain -Algorithm SHA256).Hash.ToLowerInvariant()
  $raw = & node (Join-Path $root 'server\scripts\production-copy-rehearsal.mjs') "--backup=$plain"
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: production-copy migration rehearsal failed.' }
  $report = ($raw -join "`n") | ConvertFrom-Json
  if (-not $report.ok -or -not $report.sourceBackupUnchanged -or
      [string]$report.sourceBackupSha256 -ne $plainSha) {
    throw 'NO_GO: rehearsal did not prove the exact decrypted backup remained intact.'
  }
  $encryptedShaAfter = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($encryptedShaAfter -ne $encryptedSha) {
    throw 'NO_GO: encrypted source backup changed during rehearsal.'
  }

  $fragment = [ordered]@{
    productionBackupSha256 = $encryptedSha
    backupDecryptionVerified = $true
    restoredBackupSha256 = $plainSha
    rehearsalSourceBackupSha256 = $plainSha
    productionCopyRestoreTested = $true
    databaseTablesCompared = [int]$report.databaseTablesCompared
    databaseQuickCheckOk = ([string]$report.after.quickCheck -eq 'ok')
    databaseQuickCheckResult = [string]$report.after.quickCheck
    logicalOrphansZero = [bool]$report.logical.ok
    logicalRelationsChecked = [int]$report.logical.checkedRelations
    logicalOrphanCount = [int]$report.logical.orphanCount
    pendingOutboxPreserved = ([int]$report.before.pendingOutbox -eq [int]$report.after.pendingOutbox)
    pendingOutboxBefore = [int]$report.before.pendingOutbox
    pendingOutboxAfter = [int]$report.after.pendingOutbox
  }
  $json = $fragment | ConvertTo-Json -Depth 4
  if ($EvidenceFragment) {
    $parent = Split-Path -Parent $EvidenceFragment
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $json | Set-Content -LiteralPath $EvidenceFragment -Encoding UTF8
  }
  Write-Output $json
} finally {
  # Plaintext production data is deliberately ephemeral even on a failed run.
  Remove-Item -LiteralPath $plain -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}
