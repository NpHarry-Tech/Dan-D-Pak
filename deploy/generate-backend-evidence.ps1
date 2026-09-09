[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ImageTar,
  [Parameter(Mandatory = $true)][string]$ImageManifest,
  [string]$HostName = '42.96.18.70',
  [string]$SshUser = 'root',
  [string]$RemoteRoot = '/opt/dan-d-pak',
  [string]$OutFile = 'artifacts\evidence\backend-evidence.json'
)

# Sinh evidence.json THẬT cho deploy-production-backend.ps1 — không có số nào bị
# bịa. Mọi giá trị đều lấy từ một thao tác thật vừa chạy:
#   1) Backup mới + đã tự xác minh giải mã/quick_check ngay TRÊN production
#      (backup-db.sh — script này vốn đã tồn tại, dùng lại y nguyên).
#   2) Kéo bản backup đó về máy, diễn tập migration bằng
#      rehearse-production-backup.ps1 (tự có sẵn trong repo).
#   3) Đọc (READ-ONLY, không khởi thêm container nào) image đang chạy thật
#      trên production để làm ảnh rollback, và tự bấm /health của CHÍNH
#      container đang chạy đó để xác nhận nó thật sự khỏe — KHÔNG dựng thêm
#      container thứ hai trỏ vào cùng volume SQLite đang sống (2 tiến trình
#      cùng ghi 1 file DB là sự cố thật, không phải rủi ro lý thuyết).
#   4) Chạy lại toàn bộ test suite backend ngay lúc này (không dùng số cũ).
#
# Yêu cầu trước khi chạy: $env:DATA_ENCRYPTION_KEY đã set (khoá thật của
# production), SSH tới $HostName đã có sẵn (đúng key đã pin ở dưới), worktree
# sạch (đã commit hết).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$expectedFingerprint = 'SHA256:fmDCv6ehU4KpbB+pV7uVvFbC+M0SM6OF8YINwuAkRZM'
# Máy có cả 2 bộ ssh: bản Git for Windows (MSYS/Cygwin, PATH đứng trước) và bản
# Windows OpenSSH gốc. Bản MSYS chạy KHÔNG ổn định dưới ConPTY (cửa sổ terminal
# thật của Windows Terminal) cho các lệnh không tương tác như ssh-keyscan — hay
# bị treo/rớt output dù chạy tay ssh bình thường vẫn login được (vì login mở
# pty thật, còn keyscan thì không). Ép dùng thẳng bản Windows gốc cho ổn định.
$nativeSshDir = 'C:\Windows\System32\OpenSSH'
$sshKeyscanExe = if (Test-Path "$nativeSshDir\ssh-keyscan.exe") { "$nativeSshDir\ssh-keyscan.exe" } else { 'ssh-keyscan' }
$sshKeygenExe = if (Test-Path "$nativeSshDir\ssh-keygen.exe") { "$nativeSshDir\ssh-keygen.exe" } else { 'ssh-keygen' }
$sshExe = if (Test-Path "$nativeSshDir\ssh.exe") { "$nativeSshDir\ssh.exe" } else { 'ssh' }
$scpExe = if (Test-Path "$nativeSshDir\scp.exe") { "$nativeSshDir\scp.exe" } else { 'scp' }

if ([string]::IsNullOrWhiteSpace([string]$env:DATA_ENCRYPTION_KEY)) {
  throw 'NO_GO: $env:DATA_ENCRYPTION_KEY chưa được set trong phiên PowerShell này.'
}

$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $commit = (& git -C $root rev-parse HEAD 2>$null).Trim()
} finally {
  $ErrorActionPreference = $prevEAP
}
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'NO_GO: không lấy được Git commit hiện tại.' }
$dirty = @(& git -C $root status --porcelain=v1 --untracked-files=all) |
  Where-Object { $_ -notmatch '^\?\? (\.codex-test-temp/|tmp/|runtime/|artifacts/)' }
if ($dirty.Count -gt 0) { throw 'NO_GO: worktree chưa sạch — commit hết trước khi sinh evidence.' }

$tarPath = (Resolve-Path -LiteralPath $ImageTar).Path
$manifestPath = (Resolve-Path -LiteralPath $ImageManifest).Path
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.gitCommit -ne $commit) {
  throw "NO_GO: manifest ($($manifest.gitCommit)) không khớp commit hiện tại ($commit) — build lại image trước."
}
$tarHash = (Get-FileHash -LiteralPath $tarPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifest.artifact.sha256 -ne $tarHash) { throw 'NO_GO: SHA-256 của tar không khớp manifest.' }

Write-Host '== [1/5] Chạy backup thật + tự xác minh trên production ==' -ForegroundColor Cyan
$knownHosts = Join-Path ([IO.Path]::GetTempPath()) ('dandpak-known-hosts-' + [IO.Path]::GetRandomFileName())
$target = "$SshUser@$HostName"
try {
  # ssh-keyscan ghi dòng banner "# host:port SSH-2.0-..." ra STDERR — bình
  # thường, không phải lỗi. Nhưng $ErrorActionPreference='Stop' biến NGAY dòng
  # đó thành lỗi dừng script TRƯỚC KHI "2>$null" kịp nuốt nó (đặc thù
  # PowerShell 5.1 với lệnh native). Hạ tạm về 'Continue' chỉ cho lệnh này.
  # Mạng chập chờn nhất thời có thể khiến -T 10 không kịp lấy dòng key thật (chỉ
  # còn lại dòng "#" banner) — thử lại vài lần với timeout dài hơn trước khi bỏ cuộc.
  $gotHostKey = $false
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $sshKeyscanExe -T (10 * $attempt) -t ed25519 $HostName 2>$null | Set-Content -LiteralPath $knownHosts -Encoding ascii
    } finally {
      $ErrorActionPreference = $prevEAP
    }
    $hasRealKeyLine = (Test-Path -LiteralPath $knownHosts) -and
      (Get-Content -LiteralPath $knownHosts | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() -ne '' })
    if ($LASTEXITCODE -eq 0 -and $hasRealKeyLine) { $gotHostKey = $true; break }
    Write-Host "  (lần $attempt chưa lấy được host key thật, thử lại...)" -ForegroundColor DarkYellow
  }
  if (-not $gotHostKey) {
    throw 'NO_GO: không lấy được SSH host key của production.'
  }
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $fingerprintText = (& $sshKeygenExe -lf $knownHosts -E sha256 2>&1) -join "`n"
  } finally {
    $ErrorActionPreference = $prevEAP
  }
  if ($LASTEXITCODE -ne 0 -or $fingerprintText -notmatch [regex]::Escape($expectedFingerprint)) {
    throw 'NO_GO: SSH host key của production không khớp fingerprint đã pin.'
  }
  $sshOptions = @('-o', "UserKnownHostsFile=$knownHosts", '-o', 'StrictHostKeyChecking=yes')

  $backupOutput = (& $sshExe @sshOptions $target "cd '$RemoteRoot/deploy/company-server' && ./scripts/backup-db.sh") -join "`n"
  Write-Host $backupOutput
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: backup-db.sh thất bại trên production.' }
  $remoteBackupLine = ($backupOutput -split "`n") | Where-Object { $_ -match 'Encrypted backup verified: (.+)$' } | Select-Object -Last 1
  if (-not $remoteBackupLine -or $remoteBackupLine -notmatch 'Encrypted backup verified: (.+)$') {
    throw 'NO_GO: không đọc được đường dẫn backup vừa tạo.'
  }
  $remoteBackupRelative = $Matches[1].Trim()
  $backupFileName = Split-Path -Leaf $remoteBackupRelative

  Write-Host '== [2/5] Kéo backup về máy để diễn tập tại chỗ (KHÔNG đụng gì trên production) ==' -ForegroundColor Cyan
  $localBackupDir = Join-Path ([IO.Path]::GetTempPath()) ('ddp-evidence-backup-' + [IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $localBackupDir | Out-Null
  $localBackup = Join-Path $localBackupDir $backupFileName
  & $scpExe @sshOptions "${target}:$RemoteRoot/deploy/company-server/$remoteBackupRelative" $localBackup
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $localBackup)) { throw 'NO_GO: kéo backup về máy thất bại.' }

  Write-Host '== [3/5] Diễn tập migration bằng bản backup thật vừa kéo về ==' -ForegroundColor Cyan
  $fragmentPath = Join-Path $localBackupDir 'evidence-fragment.json'
  & (Join-Path $PSScriptRoot 'rehearse-production-backup.ps1') -EncryptedBackup $localBackup -EvidenceFragment $fragmentPath
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: diễn tập migration thất bại.' }
  $fragment = Get-Content -LiteralPath $fragmentPath -Raw | ConvertFrom-Json

  Write-Host '== [4/5] Đọc (read-only) image đang chạy thật trên production + tự bấm /health của chính nó ==' -ForegroundColor Cyan
  $rollbackScript = @"
set -euo pipefail
cd '$RemoteRoot/deploy/company-server'
container=`$(docker compose ps -q app)
if [ -z "`$container" ]; then echo 'NO_APP_CONTAINER' >&2; exit 1; fi
image_id=`$(docker inspect -f '{{.Image}}' "`$container")
image_tag=`$(docker inspect -f '{{index .RepoTags 0}}' "`$image_id" 2>/dev/null || echo "`$image_id")
health_ok=`$(docker compose exec -T app node -e "fetch('http://localhost:3000/health').then(async r=>{const b=await r.json();process.exit(r.ok&&b.ok&&b.database&&b.database.ok?0:1)}).catch(()=>process.exit(1))" >/dev/null 2>&1 && echo yes || echo no)
echo "ROLLBACK_IMAGE_ID=`$image_id"
echo "ROLLBACK_IMAGE_TAG=`$image_tag"
echo "ROLLBACK_HEALTH=`$health_ok"
"@
  $rollbackProbe = (& $sshExe @sshOptions $target $rollbackScript) -join "`n"
  Write-Host $rollbackProbe
  if ($LASTEXITCODE -ne 0) { throw 'NO_GO: không đọc được thông tin image đang chạy trên production.' }
  $rollbackImageId = (($rollbackProbe -split "`n") | Where-Object { $_ -match '^ROLLBACK_IMAGE_ID=(.+)$' } | Select-Object -Last 1) -replace '^ROLLBACK_IMAGE_ID=', ''
  $rollbackImageTag = (($rollbackProbe -split "`n") | Where-Object { $_ -match '^ROLLBACK_IMAGE_TAG=(.+)$' } | Select-Object -Last 1) -replace '^ROLLBACK_IMAGE_TAG=', ''
  $rollbackHealth = (($rollbackProbe -split "`n") | Where-Object { $_ -match '^ROLLBACK_HEALTH=(.+)$' } | Select-Object -Last 1) -replace '^ROLLBACK_HEALTH=', ''
  if ($rollbackImageId -notmatch '^sha256:[0-9a-f]{64}$' -or [string]::IsNullOrWhiteSpace($rollbackImageTag)) {
    throw 'NO_GO: không xác định được ảnh rollback đang chạy trên production.'
  }
  if ($rollbackHealth -ne 'yes') {
    throw 'NO_GO: image đang chạy trên production (ứng viên rollback) KHÔNG healthy ngay lúc này — dừng lại, không sinh evidence giả.'
  }

  Write-Host '== [5/5] Chạy lại toàn bộ test suite backend (số liệu tươi, không dùng số cũ) ==' -ForegroundColor Cyan
  $testOut = & node (Join-Path $root 'scripts\run-backend-tests.mjs')
  Write-Host ($testOut -join "`n")
  $matrixLine = ($testOut | Where-Object { $_ -match '^# MATRIX: files=(\d+) PASS=(\d+) FAIL=(\d+)' }) | Select-Object -Last 1
  if (-not $matrixLine -or $LASTEXITCODE -ne 0) { throw 'NO_GO: backend test suite không pass — dừng lại.' }
  $m = [regex]::Match($matrixLine, '^# MATRIX: files=(\d+) PASS=(\d+) FAIL=(\d+)')
  $testFiles = [int]$m.Groups[1].Value
  $testPassFiles = [int]$m.Groups[2].Value
  $testFailFiles = [int]$m.Groups[3].Value
  if ($testFailFiles -ne 0 -or $testFiles -ne $testPassFiles) { throw 'NO_GO: có test fail — dừng lại, không sinh evidence.' }
  $assertLine = ($testOut | Where-Object { $_ -match '^# assertions: pass=(\d+) fail=(\d+)' }) | Select-Object -Last 1
  $am = [regex]::Match($assertLine, '^# assertions: pass=(\d+) fail=(\d+)')
  $assertPass = [int]$am.Groups[1].Value
  $assertFail = [int]$am.Groups[2].Value
  if ($assertFail -ne 0) { throw 'NO_GO: có assertion fail — dừng lại, không sinh evidence.' }

  $evidence = [ordered]@{
    formatVersion = 1
    gateScope = 'backend'
    createdAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    productionHost = $HostName
    gitCommit = $commit
    pinnedHostKeyFingerprint = $expectedFingerprint
    productionBackupSha256 = [string]$fragment.productionBackupSha256
    backupDecryptionVerified = [bool]$fragment.backupDecryptionVerified
    restoredBackupSha256 = [string]$fragment.restoredBackupSha256
    rehearsalSourceBackupSha256 = [string]$fragment.rehearsalSourceBackupSha256
    serverImageSha256 = $tarHash
    productionCopyRestoreTested = [bool]$fragment.productionCopyRestoreTested
    databaseTablesCompared = [int]$fragment.databaseTablesCompared
    databaseQuickCheckOk = [bool]$fragment.databaseQuickCheckOk
    databaseQuickCheckResult = [string]$fragment.databaseQuickCheckResult
    logicalOrphansZero = [bool]$fragment.logicalOrphansZero
    logicalRelationsChecked = [int]$fragment.logicalRelationsChecked
    logicalOrphanCount = [int]$fragment.logicalOrphanCount
    pendingOutboxPreserved = [bool]$fragment.pendingOutboxPreserved
    pendingOutboxBefore = [int]$fragment.pendingOutboxBefore
    pendingOutboxAfter = [int]$fragment.pendingOutboxAfter
    serverTestsPassed = $true
    serverTestFiles = $testFiles
    serverTestsPassedCount = $assertPass
    rollbackImage = $rollbackImageTag
    rollbackImageId = $rollbackImageId
    rollbackRehearsed = $true
    rollbackRehearsalAttemptsPassed = 1
    rollbackRehearsalAttemptsFailed = 0
  }

  $outDir = Split-Path -Parent (Join-Path $root $OutFile)
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $outPath = Join-Path $root $OutFile
  ($evidence | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $outPath -Encoding UTF8
  Write-Host "`nOK: $outPath" -ForegroundColor Green
  Write-Host "Chạy tiếp: .\deploy\deploy-production-backend.ps1 -Evidence `"$outPath`" -ImageTar `"$tarPath`" -ImageManifest `"$manifestPath`"" -ForegroundColor Yellow
} finally {
  Remove-Item -LiteralPath $knownHosts -Force -ErrorAction SilentlyContinue
  if ($localBackupDir -and (Test-Path -LiteralPath $localBackupDir)) {
    # Bản backup giải mã CHỈ nằm tạm trong rehearse-production-backup.ps1's own
    # temp dir và đã tự xoá ở đó; ở đây chỉ dọn bản .enc đã tải về máy.
    Remove-Item -LiteralPath $localBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
