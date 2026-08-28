# Build báº£n Dan D Pak Desktop cho mÃ´i trÆ°á»ng SHOPEE REVIEW.
#
# CÃ™NG source, CÃ™NG tÃ­nh nÄƒng nhÆ° báº£n production â€” khÃ¡c DUY NHáº¤T á»Ÿ backend:
# app trá» vá» https://api-review.<domain> (dá»¯ liá»‡u synthetic, sandbox Shopee)
# thay vÃ¬ api.<domain>. KhÃ´ng táº¡o chÆ°Æ¡ng trÃ¬nh demo riÃªng.
#
# DÃ¹ng:
#   .\deploy\build-desktop-review.ps1
#   .\deploy\build-desktop-review.ps1 -ReviewApiUrl https://api-review.dandpakpos.io.vn
#
# Káº¿t quáº£: installer Ä‘Æ°á»£c COPY vÃ o deploy\review\portal\download\ Ä‘á»ƒ Reviewer
# Portal (https://review.<domain>) cho Shopee táº£i vá».
[CmdletBinding()]
param(
  [string]$ReviewApiUrl = 'https://api-review.dandpakpos.io.vn',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "== Build Dan D Pak Desktop (REVIEW) ==" -ForegroundColor Magenta
Write-Host "Backend review: $ReviewApiUrl" -ForegroundColor Cyan

# Build .exe + installer, trá» backend review qua dart-define.
& (Join-Path $PSScriptRoot 'build-desktop.ps1') -ReviewApiUrl $ReviewApiUrl -Clean:$Clean

# Láº¥y build number Ä‘á»ƒ tÃ¬m installer vá»«a táº¡o.
$verFile = Join-Path $root 'flutter-apps\dandpak_desktop\lib\app_version.dart'
$build = [regex]::Match((Get-Content $verFile -Raw), 'kAppBuildNumber\s*=\s*(\d+)').Groups[1].Value
$installer = Join-Path $root "artifacts\releases\dan-d-pak-pos-setup-b$build.exe"
if (-not (Test-Path -LiteralPath $installer)) {
  throw "Khong thay installer $installer - build co the that bai."
}

# Copy vÃ o thÆ° má»¥c download cá»§a Reviewer Portal (tÃªn khá»›p portal/index.html).
$downloadDir = Join-Path $root 'deploy\review\portal\download'
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
$dest = Join-Path $downloadDir 'DanDPak-Review-Setup.exe'
Copy-Item -LiteralPath $installer -Destination $dest -Force

Write-Host ''
Write-Host "OK. Installer review: $dest" -ForegroundColor Green
Write-Host "Portal se phuc vu file nay tai: https://review.<domain>/download/DanDPak-Review-Setup.exe" -ForegroundColor Green
Write-Host "Nho deploy lai stack review (docker compose) de Caddy mount thu muc portal moi." -ForegroundColor Yellow
