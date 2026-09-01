# ============================================================
# Nap khoa Firebase (service-account) vao server - MA HOA trong DB
# (giong cach Haravan token/secret dang duoc luu), KHONG phai file .json
# tho nam tren dia. Server tu ma hoa bang DATA_ENCRYPTION_KEY khi nhan.
#
# Dung sau khi da tai file service-account tu Firebase Console
# (Project settings -> Service accounts -> Generate new private key):
#   powershell -File deploy\set-firebase-key.ps1 `
# Server: https://api.dandpakpos.io.vn (cổng 3000 không còn mở ra internet).
#       -Server https://api.dandpakpos.io.vn -Username admin -Pin 1234 `
#       -File "D:\DTrash\dan-d-pak-pos-firebase-adminsdk-fbsvc-xxxxx.json"
#
# Sau khi chay XONG va thay "Success", XOA file .json goc khoi may -
# tu gio khoa chi con ton tai dang ma hoa trong DB cua server.
#
# Luu y encoding: file nay CHI dung ASCII thuan (khong dau) vi Windows
# PowerShell 5.1 doc .ps1 theo ANSI codepage khi khong co BOM UTF-8 - chuoi
# tieng Viet co dau se bi hieu sai thanh ky tu la, gay loi parse chuoi.
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Pin,
  [Parameter(Mandatory = $true)][string]$File
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $File)) { throw "Khong thay file: $File" }

$serviceAccount = Get-Content $File -Raw | ConvertFrom-Json
foreach ($field in @('project_id', 'private_key', 'client_email')) {
  if (-not $serviceAccount.$field) { throw "File thieu truong '$field' - co dung la file service-account tai tu Firebase khong?" }
}

Write-Host "  Server      : $Server"
Write-Host "  Project ID  : $($serviceAccount.project_id)"
Write-Host "  Client email: $($serviceAccount.client_email)"

# 1) Dang nhap lay token
$loginBody = @{ username = $Username; pin = $Pin } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$Server/api/login" -ContentType 'application/json' -Body $loginBody
$token = $login.token
if (-not $token) { throw "Dang nhap that bai" }

# 2) Gui nguyen object service-account - server tu ma hoa (encryptSecret) roi luu,
#    KHONG luu lai thanh file tren may chu.
$body = @{ firebase_service_account = $serviceAccount } | ConvertTo-Json -Depth 10

Write-Host "  Uploading..." -ForegroundColor Cyan
$res = Invoke-RestMethod -Method Post -Uri "$Server/api/settings/app" `
  -Headers @{ 'x-auth-token' = $token } `
  -ContentType 'application/json' -Body $body

if ($res.firebase_configured -eq $true) {
  Write-Host ""
  Write-Host "  Success: Da luu khoa Firebase MA HOA tren server." -ForegroundColor Green
  Write-Host "  Ban co the XOA file '$File' khoi may ngay bay gio." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "  Server khong xac nhan firebase_configured=true - kiem tra lai." -ForegroundColor Red
}
