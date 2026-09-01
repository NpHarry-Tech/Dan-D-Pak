# Build Hardware Agent (dandpak-agent.exe) tu server/agent.cjs bang Node SEA.
#
# VI SAO CAN SCRIPT NAY: agent chay TAI CUA HANG tren may POS, may do khong cai
# Node.js. Node SEA (Single Executable Application) nhet agent.cjs vao trong mot
# ban sao node.exe thanh 1 file .exe chay doc lap. CMake cua app desktop copy
# file .exe nay ra canh app khi build (xem windows/runner/CMakeLists.txt).
#
# TRUOC DAY KHONG CO SCRIPT: file .exe duoc build tay roi commit thang vao repo,
# nen moi lan sua agent.cjs deu co nguy co quen build lai -> app van chay agent
# CU trong khi server da doi giao thuc. Script nay khoa lai quy trinh do.
#
# Dung:
#   .\deploy\build-agent.ps1
#   .\deploy\build-agent.ps1 -SkipVerify   # bo qua buoc chay thu
[CmdletBinding()]
param([switch]$SkipVerify)

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$srcFile = Join-Path $root 'server\agent.cjs'
$outFile = Join-Path $root 'flutter-apps\dandpak_desktop\windows\hardware-agent\dandpak-agent.exe'
$work    = Join-Path $env:TEMP ('ddp-agent-sea-' + $PID)

if (-not (Test-Path -LiteralPath $srcFile)) { throw "Khong thay $srcFile" }

Write-Host ''
Write-Host '=== Build Hardware Agent (Node SEA) ===' -ForegroundColor Cyan
Write-Host ("  Nguon : " + $srcFile)
Write-Host ("  Dich  : " + $outFile)

# Kiem tra cu phap truoc khi dong goi - dong goi mot file loi thi .exe van tao
# ra duoc nhung chet ngay luc chay tren may POS.
& node --check $srcFile
if ($LASTEXITCODE -ne 0) { throw 'agent.cjs co loi cu phap - dung build' }
Write-Host '  Cu phap: OK' -ForegroundColor Green

$nodeExe = (Get-Command node).Source
$nodeVer = & node --version
Write-Host ("  Node   : " + $nodeVer + "  (" + $nodeExe + ")")

# node/npx/postject ghi ca thong bao THANH CONG ra stderr (vd "Wrote single
# executable preparation blob to ..."). Voi $ErrorActionPreference='Stop',
# PowerShell 5.1 bien moi dong stderr cua native command thanh loi ket thuc va
# bo ngang script du build dung. Ha ve 'Continue' quanh cac lenh native roi xet
# $LASTEXITCODE that - cung cach build-desktop.ps1 da phai lam.
function Invoke-Native {
  param([scriptblock]$Cmd, [string]$What)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Cmd 2>&1 | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray } }
  finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw ($What + ' that bai (exit ' + $LASTEXITCODE + ')') }
}

New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  # 1. Cau hinh SEA. disableExperimentalSEAWarning de agent khong in canh bao
  #    ra stderr moi lan chay (app desktop spawn ngam, khong ai doc duoc).
  $cfgPath  = Join-Path $work 'sea-config.json'
  $blobPath = Join-Path $work 'agent.blob'
  $cfg = @{
    main                          = $srcFile
    output                        = $blobPath
    disableExperimentalSEAWarning = $true
  } | ConvertTo-Json
  Set-Content -LiteralPath $cfgPath -Value $cfg -Encoding utf8

  # 2. Dong goi source thanh blob
  Invoke-Native { node --experimental-sea-config $cfgPath } 'Tao SEA blob'
  Write-Host ('  Blob   : ' + [math]::Round((Get-Item $blobPath).Length / 1KB, 1) + ' KB') -ForegroundColor Green

  # 3. Copy node.exe lam vo chua
  $staged = Join-Path $work 'dandpak-agent.exe'
  Copy-Item -LiteralPath $nodeExe -Destination $staged -Force

  # 4. Nhet blob vao vo. Sentinel fuse la hang so cua Node, khong duoc doi.
  Invoke-Native {
    npx --yes postject $staged NODE_SEA_BLOB $blobPath `
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  } 'postject'

  # 5. Chay thu: khong co AGENT_USERNAME/PIN thi agent PHAI thoat co kiem soat
  #    voi thong bao thieu cau hinh. Neu no bao loi khac -> ban dong goi hong.
  if (-not $SkipVerify) {
    # Chay thu trong TEMP RIENG. Agent chi cho 1 ban chay mot luc (lock nam o
    # tmpdir()); may build thuong dang chay agent that cua app POS, dung chung
    # tmpdir thi ban moi gap lock roi thoat ngay - khong kiem tra duoc gi, va
    # tuyet doi khong duoc dung agent that dang phuc vu ban hang.
    $probeTmp = Join-Path $work 'probe'
    New-Item -ItemType Directory -Force -Path $probeTmp | Out-Null
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $out = & cmd /c "set TEMP=$probeTmp&& set TMP=$probeTmp&& `"$staged`" 2>&1"
    } finally { $ErrorActionPreference = $prevEap }
    $joined = ($out -join ' ')
    if ($joined -notmatch 'AGENT_USERNAME') {
      throw ("Ban .exe vua dong goi khong chay dung. Ket qua: " + $joined)
    }
    Write-Host '  Chay thu: OK (bao thieu AGENT_USERNAME dung nhu mong doi)' -ForegroundColor Green
  }

  Copy-Item -LiteralPath $staged -Destination $outFile -Force
  $mb = [math]::Round((Get-Item $outFile).Length / 1MB, 1)
  Write-Host ''
  Write-Host ("XONG: " + $outFile + "  (" + $mb + " MB)") -ForegroundColor Cyan
  Write-Host 'Nho build lai app desktop de CMake copy ban agent moi vao ban cai.' -ForegroundColor Yellow
  Write-Host ''
}
finally {
  # -ErrorAction SilentlyContinue chi giau THONG BAO loi; cmdlet van that bai nen
  # script thoat voi ma 1 du build dung. Nuot han bang try/catch de ma thoat sach.
  try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch {}
}
