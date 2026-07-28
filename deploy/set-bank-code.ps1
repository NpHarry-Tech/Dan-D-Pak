# ============================================================
# Sua Ma ngan hang (bankCode) dung de tao QR chuyen khoan - vd BIDV, VCB, MB...
#
# BUG: man Cai dat truoc gio KHONG co o de sua truong nay (chi co "Ten ngan
# hang" la chu tu do, khong lien quan toi ma NAPAS thuc te dung de tao QR) -
# nen bankCode bi ket o gia tri mac dinh VCB du "Ten ngan hang" da doi sang
# BIDV, khien QR tao ra sai ngan hang va bi tu choi khi quet ("Tai khoan
# huong khong hop le"). Ban cap nhat app moi da them o "Ma ngan hang" that,
# nhung truoc khi ban cap nhat/publish xong, dung script nay de sua NGAY
# gia tri dang luu tren server.
#
# Dung:
#   powershell -File deploy\set-bank-code.ps1 `
#       -Server https://api.dandpakpos.io.vn -Username admin -Pin 1234 `
#       -BankCode BIDV
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Pin,
  [Parameter(Mandatory = $true)][string]$BankCode
)

$ErrorActionPreference = 'Stop'

# 1) Dang nhap lay token
$loginBody = @{ username = $Username; pin = $Pin } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$Server/api/login" -ContentType 'application/json' -Body $loginBody
$token = $login.token
if (-not $token) { throw "Dang nhap that bai" }

# 2) Lay settings hien tai - PHAI gui lai NGUYEN operations_config, vi server
#    thay the ca object payment chu khong tu gop (thieu field nao se bi reset
#    ve mac dinh, xoa mat cau hinh dang co).
#
# QUAN TRONG ve encoding: operations_config co the chua chu tieng Viet co dau
# (ten chu tai khoan, ten cua hang...). Windows PowerShell 5.1's Invoke-RestMethod
# doan sai encoding response neu server khong khai bao charset=utf-8 ro rang,
# lam hong cac ky tu dau phuc tap (VD chu "e mu nga" -> "?") khi doc-roi-ghi-lai nguyen
# object nay. Ep giai ma response bang UTF-8 tuong minh (khong doan) de tranh
# lap lai dung loi da tung xay ra (Ten chu tai khoan bi hong dau).
$loginHeaders = @{ 'x-auth-token' = $token }
$rawResponse = Invoke-WebRequest -Method Get -Uri "$Server/api/settings/app" `
  -Headers $loginHeaders -UseBasicParsing
$jsonText = [System.Text.Encoding]::UTF8.GetString($rawResponse.RawContentStream.ToArray())
$current = $jsonText | ConvertFrom-Json

$ops = $current.operations_config
if (-not $ops) { throw "Khong doc duoc operations_config hien tai tu server" }

$oldCode = $ops.payment.bankCode
$ops.payment.bankCode = $BankCode.ToUpperInvariant()

Write-Host "  Ma ngan hang: '$oldCode' -> '$($ops.payment.bankCode)'"
Write-Host "  Ten ngan hang hien tai : $($ops.payment.bankName)"
Write-Host "  So tai khoan hien tai  : $($ops.payment.bankAccount)"

$body = @{ operations_config = $ops } | ConvertTo-Json -Depth 20
# Ep gui bang UTF-8 bytes tuong minh (khong de Invoke-RestMethod tu doan encoding
# cua chuoi $body khi convert sang byte de gui di).
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

Write-Host "  Uploading..." -ForegroundColor Cyan
$res = Invoke-RestMethod -Method Post -Uri "$Server/api/settings/app" `
  -Headers @{ 'x-auth-token' = $token } `
  -ContentType 'application/json; charset=utf-8' -Body $bodyBytes

if ($res.operations_config.payment.bankCode -eq $ops.payment.bankCode) {
  Write-Host ""
  Write-Host "  Success: Da luu Ma ngan hang = $($ops.payment.bankCode) tren server." -ForegroundColor Green
  Write-Host "  Thu tao lai QR Chuyen khoan trong app xem da dung ngan hang chua." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "  Server khong xac nhan da luu - kiem tra lai." -ForegroundColor Red
}
