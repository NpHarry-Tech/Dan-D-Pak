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
  [switch]$ChiGoi,
  # Override co y thuc cua chu he thong. Mac dinh van CHAN (giu thiet ke an toan
  # cua dot hardening). Chi khi chu van hanh chu dong truyen co nay thi duong
  # overlay moi chay -- va script con XOA cac file ma da retire tren VPS de image
  # khong dinh ban cu (bit dung lo hong ma cong chan lo ngai).
  [switch]$EpDeployChiuTrachNhiem
)

$ErrorActionPreference = 'Stop'
$goc = Split-Path -Parent $PSScriptRoot

# RETIRED PRODUCTION PATH. This legacy script overlays files in-place, cannot
# remove deleted legacy modules, and used to copy source before taking a DB
# backup. Keeping that mutation path would bypass the audited immutable-image,
# restore-test, canary and rollback gates. `-ChiGoi` remains read-only/local so
# operators can inspect the source package while the replacement workflow is
# being canaried.
if (-not $ChiGoi -and -not $EpDeployChiuTrachNhiem) {
  throw "RETIRED_UNSAFE_DEPLOY: direct production overlay is disabled. Use only -ChiGoi; immutable deployment remains blocked until production-copy restore, signed artifacts, hardware canary and rollback evidence all pass. (Chu he thong co the ep: them -EpDeployChiuTrachNhiem - hieu ro build CHUA ky + CHUA canary.)"
}
if ($EpDeployChiuTrachNhiem -and -not $ChiGoi) {
  Write-Host "!!! EP DEPLOY THANG (override cong an toan). Ban chiu trach nhiem: build CHUA ky Authenticode, CHUA canary phan cung." -ForegroundColor Yellow
}

# Dữ liệu chạy — KHÔNG đẩy lên, trên VPS chúng nằm trong volume và đè lên là mất.
$loaiTru = @('node_modules', 'releases', 'assets', 'permanent-storage', 'uploads', 'backups', '.tmp-tests')

$tam = Join-Path ([IO.Path]::GetTempPath()) ("ddp-server-src-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tam | Out-Null

Write-Host "Dang gom ma nguon server..." -ForegroundColor Cyan
$nguon = Join-Path $goc 'server'
$soFile = 0
Get-ChildItem $nguon -Recurse -File | ForEach-Object {
  $tuongDoi = $_.FullName.Substring($nguon.Length + 1)
  $phan = $tuongDoi -split '\\'
  # Bỏ nếu nằm trong bất kỳ thư mục dữ liệu nào
  foreach ($x in $loaiTru) { if ($phan -contains $x) { return } }
  # KHONG day file test (*.test.mjs): chi dung luc phat trien, Dockerfile khong
  # chay test (COPY server -> node index.js). Cung la thu PHUC HOI LOI scp lap lai
  # tren 1 file test moi (vd fnb-line-override.test.mjs) khi VPS het inode/dia.
  if ($_.Name -like '*.test.mjs') { return }
  # Trong scripts/: chi day MA (.mjs/.js) tooling/ops, BO file DU LIEU one-off
  # (xlsx/json/md/txt cua dot import Vietfoods/KiotViet da xong) ~6.8MB rac moi deploy.
  if (($phan -contains 'scripts') -and ($_.Extension -notin @('.mjs', '.js'))) { return }
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
  Write-Host "Chi gom de KIEM TRA LOCAL, khong day. KHONG copy thu muc nay vao production; source-overlay da bi retire."
  return
}

# CHÉP THẲNG THƯ MỤC, KHÔNG NÉN ZIP.
# Compress-Archive của Windows PowerShell 5.1 ghi đường dẫn bằng dấu `\`, và
# `unzip` trên Linux hiểu "services\printing.js" là TÊN FILE chứ không phải thư
# mục — giải nén ra một đống file rác ở thư mục gốc, mã nguồn không được cập
# nhật, mà lệnh vẫn báo thành công. Đã dính đúng bẫy này khi thử.
Write-Host ""
Write-Host "Dang day len $May ..." -ForegroundColor Cyan
# scp qua SSH doi khi loi TRANSIENT tren 1 file le ("write remote ... Failure")
# roi bo ngang du dia con trong (da gap: 1 file .test.mjs 2.5KB fail trong khi
# file 6MB ngay sau upload OK). Mot lan fail le KHONG dang huy ca deploy -> thu
# lai toi 3 lan (scp ghi de, chay lai an toan). Moi lan se hoi mat khau SSH.
$scpOk = $false
for ($lanThu = 1; $lanThu -le 3; $lanThu++) {
  & scp -r "$tam/*" "${May}:$ThuMucTrenVps/server/"
  if ($LASTEXITCODE -eq 0) { $scpOk = $true; break }
  Write-Host "  scp loi lan $lanThu/3 (ma $LASTEXITCODE) - thu lai..." -ForegroundColor Yellow
  Start-Sleep -Seconds 2
}
if (-not $scpOk) { throw "scp that bai sau 3 lan (ma loi $LASTEXITCODE)" }

Write-Host "Dang kiem tra va dung lai container tren VPS..." -ForegroundColor Cyan
# Sao lưu DB TRƯỚC, rồi mới dựng lại.
$lenh = @"
set -e
cd $ThuMucTrenVps/deploy/company-server
echo '--- backup DB truoc khi deploy (copy file, khong TTY, khong treo) ---'
mkdir -p backups
# docker compose cp KHONG can pseudo-TTY nen khong treo qua SSH (khac loi cu:
# docker compose exec thieu -T thi cho TTY mai). Boc timeout de khong ket vo han;
# backup loi/timeout thi CANH BAO roi van tiep tuc deploy (khong chan viec cap nhat).
timeout 150 docker compose cp app:/app/server-data/store.db "backups/store_`$(date +%Y%m%d_%H%M%S).db" && echo 'Backup DB xong.' || echo 'CANH BAO: backup DB loi/timeout - VAN tiep tuc deploy.'
echo '--- don backup cu, chi giu 7 ban gan nhat (tranh backups/ phinh day dia) ---'
ls -t backups/store_*.db 2>/dev/null | tail -n +8 | xargs -r rm -f || true
cd $ThuMucTrenVps
echo '--- xoa file ma da RETIRE (overlay khong tu xoa duoc; tranh sot ban cu trong image) ---'
rm -f server/services/misa.js server/services/configBackup.js server/agent.js
echo '--- kiem tra ma nguon da moi chua (phai ra so > 0) ---'
echo -n 'android-phone : '; grep -c 'android-phone' server/services/appRelease.js || true
echo -n 'ESC_RESET    : '; grep -c 'ESC_RESET' server/services/printing.js || true
echo -n 'tuyen ngam   : '; grep -c 'implicitDevicePrinter' server/services/printing.js || true
echo -n 'orig_price   : '; grep -c 'orig_price' server/services/orders.js || true
echo -n 'price_override: '; grep -c 'price_override' server/services/retail.js || true
echo -n 'misa/ (dir)  : '; test -d server/services/misa && echo 'OK' || echo 'THIEU'
cd $ThuMucTrenVps/deploy/company-server
docker compose up -d --build
"@
& ssh $May $lenh
if ($LASTEXITCODE -ne 0) { throw "Lenh tren VPS that bai (ma loi $LASTEXITCODE)" }

Write-Host ""
Write-Host "Xong. Kiem tra tu may nay:" -ForegroundColor Green
Write-Host '  Invoke-RestMethod "https://api.dandpakpos.io.vn/api/app/version?platform=android-phone"'
Write-Host "  Ra JSON = server da moi. Van bao 'Nen tang khong ho tro' = chua an."
