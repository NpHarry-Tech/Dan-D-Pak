# ============================================================
# Phát hành bản cập nhật lên VPS để các máy tự động cập nhật.
#
# Dùng sau khi đã build xong installer:
#   powershell -File deploy\publish-release.ps1 `
# Server PHẢI là https://api.dandpakpos.io.vn — từ 2026-08 server nằm sau Caddy,
# cổng 3000 KHÔNG còn mở ra internet. Dùng địa chỉ IP:3000 cũ sẽ chết ngay ở
# bước đăng nhập với "Unable to connect to the remote server".
#       -Server https://api.dandpakpos.io.vn -Username admin -Pin 1234 `
#       -File "dan-d-pak-pos-setup-2026-07-07.exe"
#
# Script tự đọc số build (kAppBuildNumber) + version (kAppVersionName) trong
# app_version.dart của app KHỚP platform (windows -> dandpak_desktop, android ->
# dandpak_tablet), đăng nhập lấy token, rồi upload file cài đặt kèm số build.
# Xong là mọi máy POS thấy "Cập nhật ngay".
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Pin,
  [Parameter(Mandatory = $true)][string]$File,
  [ValidateSet('windows', 'android', 'android-phone', 'ios')]
  [string]$Platform = 'windows',
  [string]$Notes = '',
  [switch]$Mandatory,
  # Override CO Y THUC cua chu he thong. Mac dinh van CHAN (giu pipeline hardening).
  # Khi truyen co nay: BO QUA cac cong ky-chuan/provenance ma ha tang chua co
  # (Authenticode chua co chung chi; APK ky bang key LIEN TUC co CN=Android Debug;
  # chua co manifest provenance vi build tu cay lam viec chua commit). CHI bo qua
  # cac check do -- van kiem tra chuoi phien ban khop file de tranh vong lap update.
  # Dung khi can dua fix gap len may dang chay ma pipeline chuan chua san sang.
  [switch]$EpPublishChiuTrachNhiem,
  # Hung moi doi so thua. KHONG co tham so nay thi mot doi so lac (vi du copy
  # nham `$P` con la placeholder) se roi vao -Notes theo thu tu vi tri, va
  # "<PIN_CUA_BAN>" hien thanh ghi chu ban cap nhat tren may cua nhan vien.
  # Da xay ra that ngay 2026-07-31 voi ca ban desktop lan tablet.
  [Parameter(ValueFromRemainingArguments = $true)]$ThuaKhongDung
)

$ErrorActionPreference = 'Stop'

if ($ThuaKhongDung) {
  throw "Co doi so thua khong hieu: $($ThuaKhongDung -join ' ')`n" +
        "Moi tham so deu phai goi ten (-Server -Username -Pin -Platform -File)."
}

# Placeholder trong huong dan chua duoc thay -> dung ngay, dung de no len may that.
foreach ($cap in @(@('Pin', $Pin), @('Notes', $Notes), @('Username', $Username))) {
  if ($cap[1] -match '^<.*>$') {
    throw "-$($cap[0]) van con la placeholder '$($cap[1])' - thay bang gia tri that."
  }
}
$root = Split-Path -Parent $PSScriptRoot
# 3 app giờ là vỏ mỏng trên dandpak_core; chọn app_version.dart theo platform.
# (windows/linux/macos = desktop; android/ios = tablet.)
# Khe phat hanh -> app doc so build tu do. Truoc day dien thoai va tablet dung
# CHUNG khe 'android' nen publish ban nay la de ban kia, va script luon doc so
# build cua MOT app du dang day file cua app kia. Gio map tuong minh.
$appDir = switch ($Platform) {
  'android-phone' { 'dandpak_phone' }
  'android'       { 'dandpak_tablet' }
  'ios'           { 'dandpak_tablet' }
  default         { 'dandpak_desktop' }
}
$verFile = Join-Path $root "flutter-apps\$appDir\lib\app_version.dart"

if (-not (Test-Path $File)) { throw "Không thấy file cài đặt: $File" }
if (-not (Test-Path $verFile)) { throw "Không thấy app_version.dart: $verFile" }
# Chuan hoa ve duong dan TUYET DOI ngay tu day. Ly do: [IO.File]::ReadAllBytes
# giai duong dan tuong doi theo thu muc lam viec cua .NET ([Environment]::
# CurrentDirectory, thuong la C:\Users\<ban>) — KHAC $PWD cua PowerShell. Neu
# giu path tuong doi, ReadAllBytes se tim nham o C:\Users\...\artifacts\... roi
# chet "Could not find a part of the path" du Test-Path/Resolve-Path da qua.
$File = (Resolve-Path -LiteralPath $File).Path

# CHONG DAY NHAM FILE GIUA TABLET VA PHONE. Ca hai apk dung CHUNG chuoi version
# nen buoc kiem tra version ben duoi khong phan biet duoc -> da day nham apk
# phone len khe 'android' (tablet) 3 lan (05/08/2026), lam tablet update thanh
# app phone. Chan som: file APK phai nam dung thu muc app cua platform.
if ($Platform -in @('android', 'android-phone')) {
  $fileFull = (Resolve-Path $File).Path
  if ($fileFull -notmatch [regex]::Escape("\$appDir\")) {
    throw "File '$File' KHONG nam trong 'flutter-apps\$appDir\' — rat co the day nham apk cua app khac len khe '$Platform'. " +
          "Khe 'android' = dandpak_tablet, 'android-phone' = dandpak_phone. Kiem tra lai -File."
  }
}

$verText = Get-Content $verFile -Raw
$build = [int]([regex]::Match($verText, 'kAppBuildNumber\s*=\s*(\d+)').Groups[1].Value)
$version = [regex]::Match($verText, "kAppVersionName\s*=\s*'([^']+)'").Groups[1].Value
if ($build -le 0) { throw "kAppBuildNumber không hợp lệ trong app_version.dart" }

# ── CHOT: file dem publish phai THAT SU chua so build dang khai ────────────
# Vi sao: script doc so build tu MA NGUON, con file thi da build tu truoc. Neu
# ai do tang kAppBuildNumber sau khi build, server se khai build moi trong khi
# app cai xong bao build cu -> may tai ve, cai, van thay co ban moi, tai lai...
# VONG LAP VO TAN, moi vong 100+ MB. Suyt xay ra ngay 2026-07-31 (khai 18, file
# la 17), chi thoat vi mot loi khac chan lai.
$duoiFile = [IO.Path]::GetExtension($File).ToLower()
$duoiCho = if ($Platform -eq 'windows') { '.exe' } else { '.apk' }
if ($duoiFile -ne $duoiCho) {
  throw "Khe '$Platform' can file $duoiCho nhung dang day file $duoiFile - nham file roi."
}

# Fail closed: release artifacts must carry the owner's production identity.
if ($Platform -eq 'windows') {
  $signature = Get-AuthenticodeSignature -FilePath (Resolve-Path $File)
  if ($signature.Status -ne 'Valid') {
    if ($EpPublishChiuTrachNhiem) {
      Write-Host "!!! OVERRIDE: installer Windows CHUA ky Authenticode (status: $($signature.Status)) - van publish theo yeu cau chu he thong." -ForegroundColor Yellow
    } else {
      throw "Windows installer is not Authenticode-signed with a valid certificate (status: $($signature.Status)). Publish blocked."
    }
  }
} elseif ($Platform -in @('android', 'android-phone')) {
  $androidHome = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { $env:ANDROID_HOME }
  if (-not $androidHome) { $androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $apksigner = Get-ChildItem -Path (Join-Path $androidHome 'build-tools') -Filter 'apksigner.bat' -Recurse -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Directory.Name } -Descending |
    Select-Object -First 1
  if (-not $apksigner) {
    throw "Khong tim thay apksigner trong Android SDK; khong the xac minh chu ky APK. Publish blocked."
  }
  if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    $javaLine = & flutter doctor -v 2>&1 | ForEach-Object { $_.ToString() } |
      Where-Object { $_ -match 'Java binary at:' } | Select-Object -First 1
    $javaPath = if ($javaLine) { (($javaLine -split 'Java binary at:', 2)[1]).Trim() } else { '' }
    if ($javaPath -and -not (Test-Path $javaPath) -and (Test-Path "$javaPath.exe")) { $javaPath = "$javaPath.exe" }
    if (-not $javaPath -or -not (Test-Path $javaPath)) {
      throw "Khong tim thay Java de chay apksigner; khong the xac minh chu ky APK. Publish blocked."
    }
    $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $javaPath)
  }
  $signerOutput = & $apksigner.FullName verify --verbose --print-certs (Resolve-Path $File) 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "APK signature verification failed: $($signerOutput -join ' ')"
  }
  $signerText = $signerOutput -join "`n"
  if ($signerText -match '(?i)CN\s*=\s*Android Debug') {
    if ($EpPublishChiuTrachNhiem) {
      Write-Host "!!! OVERRIDE: APK ky bang key LIEN TUC (CN=Android Debug - dung key da ky cac ban dang cai) de auto-update khong bi tu choi. Publish theo yeu cau chu he thong." -ForegroundColor Yellow
    } else {
      throw "APK is signed with the Android debug certificate. Publish blocked; use the existing production release keystore."
    }
  }
}

# Provenance is mandatory and is checked before credentials or network access.
# The manifest must describe these exact bytes, not merely a similarly named build.
$artifactFull = (Resolve-Path $File).Path
$manifestPath = "$artifactFull.manifest.json"
if ($EpPublishChiuTrachNhiem) {
  # Override: build tu cay lam viec CHUA commit nen manifest provenance (neu co)
  # se co worktreeDirty=true. KHONG bia manifest gia va KHONG chan -- bo qua toan
  # bo kiem tra nguon goc theo yeu cau chu he thong. Van kiem tra chuoi phien ban
  # khop file ben duoi de tranh vong lap update.
  Write-Host "!!! OVERRIDE: bo qua kiem tra provenance/nguon goc (build tu cay chua commit). Publish theo yeu cau chu he thong." -ForegroundColor Yellow
} else {
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Missing build provenance manifest: $manifestPath. Publish blocked."
  }
  try {
    $provenance = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  } catch {
    throw "Invalid build provenance manifest '$manifestPath': $($_.Exception.Message). Publish blocked."
  }
  $actualHash = (Get-FileHash -LiteralPath $artifactFull -Algorithm SHA256).Hash.ToLowerInvariant()
  $schemaText = Get-Content -LiteralPath (Join-Path $root 'server\db.js') -Raw
  $schemaMatch = [regex]::Match($schemaText, 'PRAGMA\s+user_version\s*=\s*(\d+)')
  if (-not $schemaMatch.Success) { throw 'Cannot derive canonical SQLite user_version. Publish blocked.' }
  $targetSchemaVersion = [int]$schemaMatch.Groups[1].Value
  if ($provenance.formatVersion -ne 1 -or
      $provenance.platform -ne $Platform -or
      [int]$provenance.build -ne $build -or
      [string]$provenance.version -ne $version -or
      [string]$provenance.gitCommit -notmatch '^[0-9a-f]{40}$' -or
      [bool]$provenance.worktreeDirty -or
      [string]$provenance.sourceTreeSha256 -notmatch '^[0-9a-f]{64}$' -or
      [string]$provenance.artifact.fileName -ne [IO.Path]::GetFileName($artifactFull) -or
      [int64]$provenance.artifact.bytes -ne (Get-Item -LiteralPath $artifactFull).Length -or
      [string]$provenance.artifact.sha256 -ne $actualHash -or
      [int]$provenance.schemaCompatibility.targetUserVersion -ne $targetSchemaVersion) {
    throw "Build provenance is dirty or does not match commit/source/platform/build/version/schema/artifact bytes. Publish blocked."
  }
}

# So build nam trong file duoi dang chuoi cua app_version.dart da bien dich.
# Doc nhi phan roi tim chuoi phien ban la du de bat nham lan, khong can giai nen.
#
# PHAI DO CA HAI BANG MA. APK giu chuoi Dart dang ASCII, con installer Windows
# do Inno Setup dung ghi AppVersion dang UTF-16. Ban truoc chi do ASCII nen file
# .exe LUON bi bao nham "khong tim thay phien ban" — canh bao keu o moi lan phat
# hanh Windows thi nguoi dung se go 'CO' cho qua theo phan xa, va den luc co
# nham lan THAT thi khong ai doc nua. Canh bao keu sai mot lan la mat gia tri.
#
# Rieng installer nen LZMA thi than app nam trong khoi da nen, khong do duoc —
# vi vay deploy/build-desktop.ps1 kiem tra data/app.so NGAY SAU khi build (luc
# do chua nen) va do moi la cho xac minh that su.
$noiDung = [IO.File]::ReadAllBytes($File)
$chuoi = [Text.Encoding]::ASCII.GetString($noiDung)
$chuoi16 = [Text.Encoding]::Unicode.GetString($noiDung)
$mau = [regex]::Escape($version)
if (($chuoi -notmatch $mau) -and ($chuoi16 -notmatch $mau)) {
  Write-Host ""
  Write-Host "  CANH BAO: khong tim thay chuoi phien ban '$version' trong file." -ForegroundColor Yellow
  Write-Host "  Rat co the file nay build TRUOC khi tang so build trong app_version.dart." -ForegroundColor Yellow
  Write-Host "  Neu publish, may se roi vao vong lap cap nhat vo tan." -ForegroundColor Yellow
  Write-Host ""
  $tra = Read-Host "  Van muon publish? Go 'CO' de tiep tuc"
  if ($tra -ne 'CO') { throw "Da dung. Hay build lai roi publish." }
}

Write-Host "  Server : $Server"
Write-Host "  Build  : $build ($version)  |  Platform: $Platform"
Write-Host "  File   : $File  ($([math]::Round((Get-Item $File).Length/1MB,1)) MB)"
Write-Host "  Source : $($provenance.gitCommit) / $($provenance.sourceTreeSha256)"

# 1) Đăng nhập lấy token
$loginBody = @{ username = $Username; pin = $Pin } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$Server/api/login" -ContentType 'application/json' -Body $loginBody
$token = $login.token
if (-not $token) { throw "Dang nhap that bai" }

# 2) Upload binary (raw) kèm tham số qua query string
$fileName = [System.IO.Path]::GetFileName($File)
$platformParam = $Platform.ToLowerInvariant()
$mandatoryParam = ([bool]$Mandatory).ToString().ToLowerInvariant()
$q = "platform=$platformParam&build=$build&version=$([uri]::EscapeDataString($version))&file=$([uri]::EscapeDataString($fileName))&notes=$([uri]::EscapeDataString($Notes))&mandatory=$mandatoryParam"
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))

Write-Host "  Uploading..." -ForegroundColor Cyan
$res = Invoke-RestMethod -Method Post -Uri "$Server/api/app/publish?$q" `
  -Headers @{ 'x-auth-token' = $token } `
  -ContentType 'application/octet-stream' -Body $bytes

Write-Host ""
Write-Host "  Success: Published build $($res.buildNumber) ($($res.version)) - $($res.bytes) bytes" -ForegroundColor Green
Write-Host "  POS clients will see the update on next app launch." -ForegroundColor Green
