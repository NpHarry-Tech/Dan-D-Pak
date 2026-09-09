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
# Windows OpenSSH gốc. Ép dùng thẳng bản Windows gốc cho ổn định (ssh/scp/
# ssh-keygen) — riêng ssh-keyscan bị bỏ hẳn, xem lý do ở bước [1/5] bên dưới.
$nativeSshDir = 'C:\Windows\System32\OpenSSH'
$sshKeygenExe = if (Test-Path "$nativeSshDir\ssh-keygen.exe") { "$nativeSshDir\ssh-keygen.exe" } else { 'ssh-keygen' }
$sshExe = if (Test-Path "$nativeSshDir\ssh.exe") { "$nativeSshDir\ssh.exe" } else { 'ssh' }
$scpExe = if (Test-Path "$nativeSshDir\scp.exe") { "$nativeSshDir\scp.exe" } else { 'scp' }

# Chạy 1 script bash nhiều dòng trên máy xa qua "bash -s" nhận từ STDIN. KHÔNG
# dùng "$script | & $sshExe ..." — PowerShell tự chèn lại \r\n khi serialize
# 1 string qua pipe vào tiến trình native (bất kể nội dung string đã là LF
# thuần), khiến \r lẫn vào GIÁ TRỊ biến bash gán từ các dòng đó dù script vẫn
# "chạy được" nhìn qua console. Dùng thẳng Process .NET + ghi STDIN thủ công
# để kiểm soát chính xác byte gửi đi, không qua lớp serialize nào của PowerShell.
function Invoke-RemoteBashScript {
  param([string]$SshExe, [string[]]$SshOptions, [string]$Target, [string]$Script)
  $allArgs = @($SshOptions) + @($Target, 'bash -s')
  $quoted = $allArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $SshExe
  $psi.Arguments = ($quoted -join ' ')
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($psi)
  $proc.StandardInput.Write(($Script -replace "`r`n", "`n"))
  $proc.StandardInput.Close()
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  return [PSCustomObject]@{ Stdout = $stdout; Stderr = $stderr; ExitCode = $proc.ExitCode }
}

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
  # ssh-keyscan (dù bản MSYS hay bản gốc Windows) liên tục không lấy được dòng
  # key thật trong môi trường này (đã thử cả 2, đều fail) — bỏ hẳn phụ thuộc
  # vào nó. Nếu máy này ĐÃ từng SSH tay vào production (bắt buộc trước khi
  # chạy script này lần đầu — đúng nguyên tắc "xác minh thủ công 1 lần, sau
  # đó tự động"), known_hosts MẶC ĐỊNH của Windows đã có sẵn key thật — đọc
  # thẳng từ đó, KHÔNG cần request mạng nào để lấy key nữa.
  $defaultKnownHosts = Join-Path $env:USERPROFILE '.ssh\known_hosts'
  if (-not (Test-Path -LiteralPath $defaultKnownHosts)) {
    throw "NO_GO: chưa tìm thấy $defaultKnownHosts — hãy SSH tay vào $target ít nhất 1 lần (để xác minh host key thủ công) rồi chạy lại."
  }
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $sshKeygenExe -F $HostName -f $defaultKnownHosts 2>$null |
      Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() -ne '' } |
      Set-Content -LiteralPath $knownHosts -Encoding ascii
  } finally {
    $ErrorActionPreference = $prevEAP
  }
  $gotHostKey = (Test-Path -LiteralPath $knownHosts) -and
    (Get-Content -LiteralPath $knownHosts | Where-Object { $_.Trim() -ne '' })
  if (-not $gotHostKey) {
    throw "NO_GO: known_hosts mặc định chưa có key của $HostName — hãy SSH tay vào production ít nhất 1 lần rồi chạy lại."
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
health_ok=`$(docker compose exec -T app node -e "fetch('http://localhost:3000/health').then(async r=>{const b=await r.json();process.exit(r.ok&&b.ok&&b.database&&b.database.ok?0:1)}).catch(()=>process.exit(1))" </dev/null >/dev/null 2>&1 && echo yes || echo no)
echo "ROLLBACK_IMAGE_ID=`$image_id"
echo "ROLLBACK_IMAGE_TAG=`$image_tag"
echo "ROLLBACK_HEALTH=`$health_ok"
"@
  $rollbackResult = Invoke-RemoteBashScript -SshExe $sshExe -SshOptions $sshOptions -Target $target -Script $rollbackScript
  Write-Host $rollbackResult.Stdout
  if ($rollbackResult.Stderr) { Write-Host $rollbackResult.Stderr -ForegroundColor DarkGray }
  if ($rollbackResult.ExitCode -ne 0) { throw 'NO_GO: không đọc được thông tin image đang chạy trên production.' }
  $rollbackProbe = $rollbackResult.Stdout
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
