# ============================================================
# Phát hành bản cập nhật lên VPS để các máy tự động cập nhật.
#
# Dùng sau khi đã build xong installer:
#   powershell -File deploy\publish-release.ps1 `
#       -Server http://171.244.199.186 -Username admin -Pin 1234 `
#       -File "dan-d-pak-pos-setup-2026-07-07.exe"
#
# Script tự đọc số build (kAppBuildNumber) + version (kAppVersionName) trong
# flutter-apps/dandpak_pos/lib/app_version.dart, đăng nhập lấy token, rồi upload
# file cài đặt kèm số build. Xong là mọi máy POS thấy "Cập nhật ngay".
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Pin,
  [Parameter(Mandatory = $true)][string]$File,
  [string]$Platform = 'windows',
  [string]$Notes = '',
  [switch]$Mandatory
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$verFile = Join-Path $root 'flutter-apps\dandpak_pos\lib\app_version.dart'

if (-not (Test-Path $File)) { throw "Không thấy file cài đặt: $File" }
if (-not (Test-Path $verFile)) { throw "Không thấy app_version.dart: $verFile" }

$verText = Get-Content $verFile -Raw
$build = [int]([regex]::Match($verText, 'kAppBuildNumber\s*=\s*(\d+)').Groups[1].Value)
$version = [regex]::Match($verText, "kAppVersionName\s*=\s*'([^']+)'").Groups[1].Value
if ($build -le 0) { throw "kAppBuildNumber không hợp lệ trong app_version.dart" }

Write-Host "  Server : $Server"
Write-Host "  Build  : $build ($version)  |  Platform: $Platform"
Write-Host "  File   : $File  ($([math]::Round((Get-Item $File).Length/1MB,1)) MB)"

# 1) Đăng nhập lấy token
$loginBody = @{ username = $Username; pin = $Pin } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$Server/api/login" -ContentType 'application/json' -Body $loginBody
$token = $login.token
if (-not $token) { throw "Đăng nhập thất bại" }

# 2) Upload binary (raw) kèm tham số qua query string
$fileName = [System.IO.Path]::GetFileName($File)
$q = "platform=$Platform&build=$build&version=$([uri]::EscapeDataString($version))&file=$([uri]::EscapeDataString($fileName))&notes=$([uri]::EscapeDataString($Notes))&mandatory=$([bool]$Mandatory)".ToLower()
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))

Write-Host "  Uploading..." -ForegroundColor Cyan
$res = Invoke-RestMethod -Method Post -Uri "$Server/api/app/publish?$q" `
  -Headers @{ 'x-auth-token' = $token } `
  -ContentType 'application/octet-stream' -Body $bytes

Write-Host ""
Write-Host "  Success: Published build $($res.buildNumber) ($($res.version)) - $($res.bytes) bytes" -ForegroundColor Green
Write-Host "  POS clients will see the update on next app launch." -ForegroundColor Green
