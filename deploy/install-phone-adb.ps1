# Cai ban PHONE vao may Android dang cam cap (ADB).
#
# Dung:
#   .\deploy\install-phone-adb.ps1
#   .\deploy\install-phone-adb.ps1 -Apk artifacts\releases\<ten-file>.apk
#
# Neu adb khong thay may, script noi ro phai lam gi thay vi bao loi chung chung.
[CmdletBinding()]
param(
  [string]$Apk = 'artifacts\releases\dan-d-pak-phone-2026-07-31-01.apk',
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apkPath = if ([System.IO.Path]::IsPathRooted($Apk)) { $Apk } else { Join-Path $root $Apk }

if (-not (Test-Path -LiteralPath $apkPath)) { throw "Khong thay file APK: $apkPath" }

# adb thuong nam trong Android SDK platform-tools, khong phai luc nao cung o PATH.
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) {
  $guess = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
  if (Test-Path -LiteralPath $guess) { $adb = $guess }
}
if (-not $adb) { throw 'Khong tim thay adb. Cai Android SDK Platform-Tools roi them vao PATH.' }

Write-Host ''
Write-Host '=== Cai Dan D Pak POS (ban dien thoai) qua ADB ===' -ForegroundColor Cyan
Write-Host ("  adb : " + $adb)
Write-Host ("  APK : " + $apkPath + '  (' + [math]::Round((Get-Item $apkPath).Length/1MB,1) + ' MB)')
Write-Host ''

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { $out = & $adb devices } finally { $ErrorActionPreference = $prevEap }

# Dong dau la tieu de "List of devices attached" -> bo qua.
$lines = @($out | Select-Object -Skip 1 | Where-Object { $_.Trim() -ne '' })
$ready = @($lines | Where-Object { $_ -match '\sdevice$' })
$unauth = @($lines | Where-Object { $_ -match 'unauthorized' })

if ($unauth.Count -gt 0) {
  Write-Host '  May DA cam nhung CHUA duoc cho phep.' -ForegroundColor Yellow
  Write-Host '  Nhin vao man hinh dien thoai: se co hop thoai "Cho phep go loi USB?"' -ForegroundColor Yellow
  Write-Host '  -> tich "Luon cho phep tu may tinh nay" roi bam CHO PHEP, sau do chay lai script.' -ForegroundColor Yellow
  exit 1
}

if ($ready.Count -eq 0) {
  Write-Host '  KHONG thay may Android nao.' -ForegroundColor Red
  Write-Host '  Kiem tra theo thu tu:' -ForegroundColor Yellow
  Write-Host '    1. Cap phai la cap TRUYEN DU LIEU (cap sac roi se khong bao gio hien).'
  Write-Host '    2. Cai dat > Gioi thieu dien thoai > bam 7 lan vao "So hieu ban dung".'
  Write-Host '    3. Cai dat > Tuy chon nha phat trien > bat "Go loi USB".'
  Write-Host '    4. Rut ra cam lai, chon che do "Truyen tep (MTP)" khi dien thoai hoi.'
  Write-Host '    5. Chay lai: adb devices  -> phai thay serial kem chu "device".'
  exit 1
}

Write-Host ('  May nhan duoc: ' + $ready.Count) -ForegroundColor Green
$ready | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor Gray }
Write-Host ''
Write-Host '  Dang cai (-r giu nguyen du lieu ban cu)...' -ForegroundColor Cyan

$ErrorActionPreference = 'Continue'
try { & $adb install -r $apkPath } finally { $ErrorActionPreference = $prevEap }
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '  Cai that bai. Neu bao INSTALL_FAILED_UPDATE_INCOMPATIBLE thi ban cu' -ForegroundColor Yellow
  Write-Host '  duoc ky bang chung chi khac -> go ban cu roi cai lai:' -ForegroundColor Yellow
  Write-Host '    adb uninstall com.dandpak.dandpak_phone' -ForegroundColor White
  exit 1
}

Write-Host ''
Write-Host 'XONG. App da cai tren may.' -ForegroundColor Cyan
if ($Launch) {
  $ErrorActionPreference = 'Continue'
  try { & $adb shell monkey -p com.dandpak.dandpak_phone -c android.intent.category.LAUNCHER 1 | Out-Null }
  finally { $ErrorActionPreference = $prevEap }
  Write-Host 'Da mo app tren may.' -ForegroundColor Gray
}
Write-Host ''
