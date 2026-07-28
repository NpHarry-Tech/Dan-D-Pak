# Build bản cài Windows (.exe) cho POS desktop.
#
# VÌ SAO CẦN SCRIPT NÀY thay vì gõ thẳng `flutter build windows`:
# Máy build có LLVM trong PATH. CMake khi tự dò trình biên dịch sẽ bắt nhầm
# `clang++.exe` thay vì `cl.exe` của MSVC. Hậu quả:
#   1. clang++ chạy chế độ GNU → không biết đường dẫn header của Windows SDK
#      → build chết với "Cannot open include file: 'cassert' / 'dxgi.h'".
#   2. CMake không đặt biến `MSVC` → firebase-cpp-sdk rơi xuống nhánh Linux
#      → "libs/linux/x86_64/cxx11/libfirebase_app.a missing".
# Cả hai lỗi trông như thiếu Windows SDK nhưng KHÔNG PHẢI — SDK và MSVC đều đủ.
# Script nạp môi trường MSVC trước rồi mới gọi flutter, nên cl.exe luôn thắng.
#
# Dùng:
#   .\deploy\build-desktop.ps1                 # build + đóng gói installer
#   .\deploy\build-desktop.ps1 -SkipInstaller  # chỉ build .exe, không đóng gói
[CmdletBinding()]
param(
  [switch]$SkipInstaller,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $root 'flutter-apps\dandpak_desktop'

# ── 1. Tìm môi trường MSVC ───────────────────────────────────────────────────
$vcCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvars64.bat",
  "$env:ProgramFiles\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvars64.bat"
)
$vcvars = $vcCandidates |
  ForEach-Object { Get-ChildItem $_ -ErrorAction SilentlyContinue } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $vcvars) {
  throw "Khong tim thay vcvars64.bat. Can cai Visual Studio Build Tools kem workload 'Desktop development with C++'."
}
Write-Host "MSVC env : $vcvars" -ForegroundColor Cyan

# ── 2. Đọc số hiệu build để in ra cho người chạy đối chiếu ───────────────────
$verFile = Join-Path $appDir 'lib\app_version.dart'
$verText = Get-Content $verFile -Raw
$build = [regex]::Match($verText, 'kAppBuildNumber\s*=\s*(\d+)').Groups[1].Value
$version = [regex]::Match($verText, "kAppVersionName\s*=\s*'([^']+)'").Groups[1].Value
Write-Host "Build    : $build ($version)" -ForegroundColor Cyan

if ($Clean) {
  Write-Host 'Dang xoa cache build...' -ForegroundColor Yellow
  Remove-Item -Recurse -Force (Join-Path $appDir 'build\windows') -ErrorAction SilentlyContinue
}

# ── 3. Build qua môi trường MSVC ─────────────────────────────────────────────
# CC/CXX ép rõ cl.exe phòng khi CMake vẫn cố dò lung tung.
$cmd = "call `"$vcvars`" >nul && set CC=cl.exe && set CXX=cl.exe && cd /d `"$appDir`" && flutter build windows --release"
# vcvars64.bat và CMake ghi cảnh báo ra stderr (vd "vswhere.exe is not
# recognized") NGAY CẢ KHI build thành công. Với $ErrorActionPreference='Stop',
# PowerShell 5.1 biến mỗi dòng stderr của native command thành lỗi kết thúc và
# bỏ ngang script. Hạ về 'Continue' quanh đúng lời gọi này rồi xét mã thoát thật.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { cmd /c $cmd } finally { $ErrorActionPreference = $prevEap }
if ($LASTEXITCODE -ne 0) { throw "flutter build windows that bai (ma loi $LASTEXITCODE)" }

$exe = Join-Path $appDir 'build\windows\x64\runner\Release\dandpak_desktop.exe'
if (-not (Test-Path $exe)) { throw "Build xong nhung khong thay $exe" }
Write-Host "OK: $exe" -ForegroundColor Green

if ($SkipInstaller) { return }

# ── 4. Đóng gói installer bằng Inno Setup ────────────────────────────────────
$isccCandidates = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  throw "Khong tim thay ISCC.exe. Cai bang: winget install --id JRSoftware.InnoSetup"
}
Write-Host "Inno Setup: $iscc" -ForegroundColor Cyan

Push-Location $appDir
$prevEap2 = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $iscc 'setup.iss'
  if ($LASTEXITCODE -ne 0) { throw "Dong goi installer that bai (ma loi $LASTEXITCODE)" }
} finally {
  $ErrorActionPreference = $prevEap2
  Pop-Location
}

Write-Host ''
Write-Host 'Xong. Phat hanh bang:' -ForegroundColor Green
Write-Host '  .\deploy\publish-release.ps1 -Server https://api.dandpakpos.io.vn -Username admin -Pin <PIN> `'
Write-Host '    -Platform windows -File artifacts\releases\<ten-file-setup>.exe'
