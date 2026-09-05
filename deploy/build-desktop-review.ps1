# Build báº£n Dan-D Pak Desktop cho mÃ´i trÆ°á»ng SHOPEE REVIEW.
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
  [switch]$Clean,
  [switch]$StagePortal
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "== Build Dan-D Pak Desktop (REVIEW) ==" -ForegroundColor Magenta
Write-Host "Backend review: $ReviewApiUrl" -ForegroundColor Cyan

# Build .exe + installer, trá» backend review qua dart-define.
& (Join-Path $PSScriptRoot 'build-desktop.ps1') -ReviewApiUrl $ReviewApiUrl -Clean:$Clean

# Láº¥y build number Ä‘á»ƒ tÃ¬m installer vá»«a táº¡o.
$verFile = Join-Path $root 'flutter-apps\dandpak_desktop\lib\app_version.dart'
$build = [regex]::Match((Get-Content $verFile -Raw), 'kAppBuildNumber\s*=\s*(\d+)').Groups[1].Value
$installer = Join-Path $root "artifacts\releases\review\dan-d-pak-pos-review-setup-b$build.exe"
if (-not (Test-Path -LiteralPath $installer)) {
  throw "Khong thay installer $installer - build co the that bai."
}

# Portal staging is an explicit publication preparation step, never a build side effect.
if ($StagePortal) {
  $downloadDir = Join-Path $root 'deploy\review\portal\download'
  New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
  $dest = Join-Path $downloadDir 'DanDPak-Review-Setup.exe'
  Copy-Item -LiteralPath $installer -Destination $dest -Force
  Write-Host "Portal staging copy: $dest" -ForegroundColor Green
}

Write-Host ''
Write-Host "OK. Installer review: $installer" -ForegroundColor Green
if (-not $StagePortal) { Write-Host 'Portal was not staged or published.' -ForegroundColor Yellow }
