[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Evidence,
  [string]$ExpectedHost = '42.96.18.70',
  [int]$MaxAgeHours = 24
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $Evidence -PathType Leaf)) {
  throw "NO_GO: evidence file does not exist: $Evidence"
}
try { $gate = Get-Content -LiteralPath $Evidence -Raw | ConvertFrom-Json }
catch { throw "NO_GO: evidence JSON is invalid: $($_.Exception.Message)" }

$commit = (& git -C $root rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
  throw 'NO_GO: cannot resolve current Git commit.'
}
$dirty = @(& git -C $root status --porcelain=v1 --untracked-files=all) |
  Where-Object { $_ -notmatch '^\?\? (\.codex-test-temp/|tmp/|runtime/|artifacts/)' }
if ($dirty.Count -gt 0) { throw 'NO_GO: production deployment requires a clean committed worktree.' }

$created = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$gate.createdAtUtc, [ref]$created)) {
  throw 'NO_GO: createdAtUtc is missing or invalid.'
}
$age = [DateTimeOffset]::UtcNow - $created.ToUniversalTime()
if ($age.TotalHours -lt -0.25 -or $age.TotalHours -gt $MaxAgeHours) {
  throw "NO_GO: evidence is outside the allowed $MaxAgeHours-hour window."
}

function Require-True([string]$Name, $Value) {
  if ($Value -ne $true) { throw "NO_GO: $Name is not proven true." }
}
function Require-Sha([string]$Name, $Value) {
  if ([string]$Value -notmatch '^[0-9a-fA-F]{64}$') { throw "NO_GO: $Name is not a SHA-256." }
}
function Require-Minimum([string]$Name, $Value, [int]$Minimum) {
  $number = 0
  if (-not [int]::TryParse([string]$Value, [ref]$number) -or $number -lt $Minimum) {
    throw "NO_GO: $Name must be at least $Minimum."
  }
}

if ([int]$gate.formatVersion -ne 1) { throw 'NO_GO: unsupported evidence format.' }
if ([string]$gate.productionHost -ne $ExpectedHost) { throw 'NO_GO: production host mismatch.' }
if ([string]$gate.gitCommit -ne $commit) { throw 'NO_GO: evidence commit does not match the checked-out commit.' }
Require-Sha 'productionBackupSha256' $gate.productionBackupSha256
Require-True 'backupDecryptionVerified' $gate.backupDecryptionVerified
Require-Sha 'restoredBackupSha256' $gate.restoredBackupSha256
Require-Sha 'rehearsalSourceBackupSha256' $gate.rehearsalSourceBackupSha256
if ([string]$gate.restoredBackupSha256 -ne [string]$gate.rehearsalSourceBackupSha256) {
  throw 'NO_GO: rehearsed DB bytes do not match the decrypted production backup.'
}
Require-Sha 'serverImageSha256' $gate.serverImageSha256
Require-True 'productionCopyRestoreTested' $gate.productionCopyRestoreTested
Require-Minimum 'databaseTablesCompared' $gate.databaseTablesCompared 63
Require-True 'databaseQuickCheckOk' $gate.databaseQuickCheckOk
if ([string]$gate.databaseQuickCheckResult -ne 'ok') {
  throw 'NO_GO: restored production copy PRAGMA quick_check did not return exactly ok.'
}
Require-True 'logicalOrphansZero' $gate.logicalOrphansZero
Require-Minimum 'logicalRelationsChecked' $gate.logicalRelationsChecked 31
if ([int]$gate.logicalOrphanCount -ne 0) { throw 'NO_GO: logical orphan count is not zero.' }
Require-True 'pendingOutboxPreserved' $gate.pendingOutboxPreserved
$pendingBefore = 0
$pendingAfter = 0
if (-not [int]::TryParse([string]$gate.pendingOutboxBefore, [ref]$pendingBefore) -or $pendingBefore -lt 0 -or
    -not [int]::TryParse([string]$gate.pendingOutboxAfter, [ref]$pendingAfter) -or $pendingAfter -lt 0 -or
    $pendingBefore -ne $pendingAfter) {
  throw 'NO_GO: pending outbox counts before/after restore or compaction do not match.'
}
Require-True 'serverTestsPassed' $gate.serverTestsPassed
Require-Minimum 'serverTestFiles' $gate.serverTestFiles 69
Require-Minimum 'serverTestsPassedCount' $gate.serverTestsPassedCount 393
Require-True 'flutterTestsPassed' $gate.flutterTestsPassed
Require-Minimum 'flutterTestsPassedCount' $gate.flutterTestsPassedCount 109
if ([int]$gate.flutterTestsSkippedCount -ne 1) {
  throw 'NO_GO: Flutter evidence must contain exactly the one documented updater E2E skip.'
}
$windowsSigned = ($gate.windowsArtifactSigned -eq $true)
$windowsOverride = ($gate.windowsUnsignedOwnerOverride -eq $true)

if (-not $windowsSigned) {
  if (-not $windowsOverride) {
    throw 'NO_GO: unsigned Windows artifact requires explicit owner override evidence.'
  }

  if ([string]$gate.windowsArtifactSignatureStatus -ne 'NotSigned') {
    throw 'NO_GO: unsigned Windows owner override requires signature status NotSigned.'
  }

  if ([string]::IsNullOrWhiteSpace([string]$gate.windowsUnsignedOwnerOverrideActor)) {
    throw 'NO_GO: windowsUnsignedOwnerOverrideActor is required.'
  }

  if ([string]::IsNullOrWhiteSpace([string]$gate.windowsUnsignedOwnerOverrideReason)) {
    throw 'NO_GO: windowsUnsignedOwnerOverrideReason is required.'
  }
}
elseif ($windowsOverride) {
  throw 'NO_GO: signed Windows artifact must not also claim unsigned owner override.'
}

Require-Sha 'windowsArtifactSha256' $gate.windowsArtifactSha256
Require-True 'phoneArtifactSigned' $gate.phoneArtifactSigned
Require-Sha 'phoneArtifactSha256' $gate.phoneArtifactSha256
Require-True 'tabletArtifactSigned' $gate.tabletArtifactSigned
Require-Sha 'tabletArtifactSha256' $gate.tabletArtifactSha256
Require-True 'hardwareCanaryPassed' $gate.hardwareCanaryPassed
Require-Minimum 'manualAcceptanceCasesPassed' $gate.manualAcceptanceCasesPassed 19
if ([int]$gate.manualAcceptanceCasesFailed -ne 0) { throw 'NO_GO: one or more manual acceptance cases failed.' }
Require-True 'storeEdgeWanCanaryPassed' $gate.storeEdgeWanCanaryPassed
Require-Minimum 'storeEdgeWanScenariosPassed' $gate.storeEdgeWanScenariosPassed 3
if ([int]$gate.storeEdgeWanScenariosFailed -ne 0) { throw 'NO_GO: one or more Store Edge WAN scenarios failed.' }
Require-True 'paymentInventoryInvoiceReconciled' $gate.paymentInventoryInvoiceReconciled
Require-Minimum 'reconciliationTransactionsChecked' $gate.reconciliationTransactionsChecked 10
if ([int]$gate.reconciliationMismatchCount -ne 0) { throw 'NO_GO: payment/inventory/invoice reconciliation has mismatches.' }
Require-True 'rollbackRehearsed' $gate.rollbackRehearsed
Require-Minimum 'rollbackRehearsalAttemptsPassed' $gate.rollbackRehearsalAttemptsPassed 1
if ([int]$gate.rollbackRehearsalAttemptsFailed -ne 0) { throw 'NO_GO: a rollback rehearsal attempt failed.' }
if ([string]::IsNullOrWhiteSpace([string]$gate.rollbackImage)) {
  throw 'NO_GO: rollbackImage is missing.'
}
if ([string]$gate.rollbackImageId -notmatch '^sha256:[0-9a-f]{64}$') {
  throw 'NO_GO: rollbackImageId must pin the rehearsed immutable Docker image ID.'
}
if ([string]$gate.pinnedHostKeyFingerprint -ne 'SHA256:fmDCv6ehU4KpbB+pV7uVvFbC+M0SM6OF8YINwuAkRZM') {
  throw 'NO_GO: pinned SSH host-key fingerprint mismatch.'
}

Write-Output ([ordered]@{
  ok = $true
  productionHost = $ExpectedHost
  gitCommit = $commit
  createdAtUtc = $created.ToUniversalTime().ToString('o')
  rollbackImage = [string]$gate.rollbackImage
  rollbackImageId = [string]$gate.rollbackImageId
  productionBackupSha256 = ([string]$gate.productionBackupSha256).ToLowerInvariant()
  restoredBackupSha256 = ([string]$gate.restoredBackupSha256).ToLowerInvariant()
  serverImageSha256 = ([string]$gate.serverImageSha256).ToLowerInvariant()
} | ConvertTo-Json -Compress)
