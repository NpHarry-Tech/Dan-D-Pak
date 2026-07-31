# ============================================================
# ĐẨY MÃ NGUỒN SERVER LÊN VPS rồi dựng lại container.
#
# VÌ SAO CẦN SCRIPT NÀY: /opt/dan-d-pak trên VPS KHÔNG phải kho git (đã kiểm
# ngày 2026-07-31: `git branch` báo "not a git repository"). Nên mọi hướng dẫn
# kiểu `git pull` đều chạy trơn tru mà không mang về gì — container dựng lại từ
# đúng bộ mã cũ, và người dùng tưởng đã deploy xong.
#
# Thư mục server/ ở máy dev nặng ~1.7 GB nhưng MÃ NGUỒN chỉ ~500 KB; phần còn
# lại là dữ liệu chạy (releases/ assets/ permanent-storage/ uploads/) mà trên VPS
# nằm trong Docker volume. Script chỉ gói phần mã nguồn.
#
# Dùng:
#   powershell -ExecutionPolicy Bypass -File deploy\day-server-len-vps.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\day-server-len-vps.ps1 -ChiGoi
#       (-ChiGoi = chỉ tạo file zip, không đẩy — để tự chép bằng cách khác)
# ============================================================
param(
  [string]$May = 'root@42.96.18.70',
  [string]$ThuMucTrenVps = '/opt/dan-d-pak',
  [switch]$ChiGoi
)

$ErrorActionPreference = 'Stop'
$goc = Split-Path -Parent $PSScriptRoot

# Dữ liệu chạy — KHÔNG đẩy lên, trên VPS chúng nằm trong volume và đè lên là mất.
$loaiTru = @('node_modules', 'releases', 'assets', 'permanent-storage', 'uploads', 'backups', '.tmp-tests')

$tam = Join-Path $env:TEMP "ddp-server-src"
if (Test-Path $tam) { Remove-Item $tam -Recurse -Force }
New-Item -ItemType Directory $tam | Out-Null

Write-Host "Dang gom ma nguon server..." -ForegroundColor Cyan
$nguon = Join-Path $goc 'server'
$soFile = 0
Get-ChildItem $nguon -Recurse -File | ForEach-Object {
  $tuongDoi = $_.FullName.Substring($nguon.Length + 1)
  $phan = $tuongDoi -split '\\'
  # Bỏ nếu nằm trong bất kỳ thư mục dữ liệu nào
  foreach ($x in $loaiTru) { if ($phan -contains $x) { return } }
  $dich = Join-Path $tam $tuongDoi
  $thuMucDich = Split-Path $dich -Parent
  if (-not (Test-Path $thuMucDich)) { New-Item -ItemType Directory $thuMucDich -Force | Out-Null }
  Copy-Item $_.FullName $dich -Force
  $script:soFile++
}

$mb = [math]::Round(((Get-ChildItem $tam -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 2)
Write-Host ("  $soFile file  ($mb MB)  da gom vao: $tam") -ForegroundColor Green

if ($ChiGoi) {
  Write-Host ""
  Write-Host "Chi gom, khong day. Tu chep thu muc tren vao $ThuMucTrenVps/server/"
  return
}

# CHÉP THẲNG THƯ MỤC, KHÔNG NÉN ZIP.
# Compress-Archive của Windows PowerShell 5.1 ghi đường dẫn bằng dấu `\`, và
# `unzip` trên Linux hiểu "services\printing.js" là TÊN FILE chứ không phải thư
# mục — giải nén ra một đống file rác ở thư mục gốc, mã nguồn không được cập
# nhật, mà lệnh vẫn báo thành công. Đã dính đúng bẫy này khi thử.
Write-Host ""
Write-Host "Dang day len $May ..." -ForegroundColor Cyan
& scp -r "$tam/*" "${May}:$ThuMucTrenVps/server/"
if ($LASTEXITCODE -ne 0) { throw "scp that bai (ma loi $LASTEXITCODE)" }

Write-Host "Dang kiem tra va dung lai container tren VPS..." -ForegroundColor Cyan
# Sao lưu DB TRƯỚC, rồi mới dựng lại.
$lenh = @"
set -e
cd $ThuMucTrenVps/deploy/company-server && ./scripts/backup-db.sh
cd $ThuMucTrenVps
echo '--- kiem tra ma nguon da moi chua (phai ra so > 0) ---'
echo -n 'android-phone: '; grep -c 'android-phone' server/services/appRelease.js || true
echo -n 'ESC_RESET   : '; grep -c 'ESC_RESET' server/services/printing.js || true
echo -n 'tuyen ngam  : '; grep -c 'implicitDevicePrinter' server/services/printing.js || true
cd $ThuMucTrenVps/deploy/company-server
docker compose up -d --build
"@
& ssh $May $lenh
if ($LASTEXITCODE -ne 0) { throw "Lenh tren VPS that bai (ma loi $LASTEXITCODE)" }

Write-Host ""
Write-Host "Xong. Kiem tra tu may nay:" -ForegroundColor Green
Write-Host '  Invoke-RestMethod "https://api.dandpakpos.io.vn/api/app/version?platform=android-phone"'
Write-Host "  Ra JSON = server da moi. Van bao 'Nen tang khong ho tro' = chua an."
