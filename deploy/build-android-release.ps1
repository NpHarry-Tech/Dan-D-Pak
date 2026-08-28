[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('android', 'android-phone')]
  [string]$Platform,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$appName = if ($Platform -eq 'android') { 'dandpak_tablet' } else { 'dandpak_phone' }
$appDir = Join-Path $root "flutter-apps\$appName"
$verFile = Join-Path $appDir 'lib\app_version.dart'
$verText = Get-Content -LiteralPath $verFile -Raw
$build = [int]([regex]::Match($verText, 'kAppBuildNumber\s*=\s*(\d+)').Groups[1].Value)
$version = [regex]::Match($verText, "kAppVersionName\s*=\s*'([^']+)'").Groups[1].Value
if ($build -le 0 -or -not $version) { throw "Invalid release version in $verFile" }
$buildMetadata = & (Join-Path $PSScriptRoot 'get-app-build-metadata.ps1') | ConvertFrom-Json
$dartDefines = @(
  "--dart-define=BUILD_GIT_COMMIT=$($buildMetadata.gitCommit)",
  "--dart-define=BUILD_SOURCE_SHA256=$($buildMetadata.sourceTreeSha256)",
  "--dart-define=BUILD_TIME_UTC=$($buildMetadata.builtAtUtc)",
  "--dart-define=SCHEMA_VERSION=$($buildMetadata.schemaVersion)"
)

Push-Location $appDir
try {
  if ($Clean) { & flutter clean; if ($LASTEXITCODE -ne 0) { throw 'flutter clean failed' } }
  & flutter build apk --release @dartDefines
  if ($LASTEXITCODE -ne 0) { throw "Android release build failed for $appName" }
} finally {
  Pop-Location
}

$apk = Join-Path $appDir 'build\app\outputs\flutter-apk\app-release.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw "Build succeeded but APK is missing: $apk" }
& (Join-Path $PSScriptRoot 'write-build-manifest.ps1') `
  -Artifact $apk -Platform $Platform -Build $build -Version $version `
  -BuiltAtUtc $buildMetadata.builtAtUtc -SourceTreeSha256 $buildMetadata.sourceTreeSha256 `
  -GitCommit $buildMetadata.gitCommit
Write-Host "OK: $apk" -ForegroundColor Green
