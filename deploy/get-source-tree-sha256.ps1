[CmdletBinding()]
param([string]$Root)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path -LiteralPath $Root).Path
$ephemeralPattern = '^(\.codex-test-temp/|tmp/|runtime/|artifacts/|.*(?:^|/)build/|.*(?:^|/)\.dart_tool/|.*(?:^|/)\.gradle/|.*(?:^|/)\.kotlin/)'
$files = @(& git -C $Root ls-files --cached --others --exclude-standard) |
  Where-Object { $_ -and (($_ -replace '\\', '/') -notmatch $ephemeralPattern) } |
  Sort-Object -Unique
if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate source tree through Git.' }

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  foreach ($relative in $files) {
    $full = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $pathBytes = [Text.Encoding]::UTF8.GetBytes(($relative -replace '\\', '/') + "`n")
    [void]$sha.TransformBlock($pathBytes, 0, $pathBytes.Length, $null, 0)
    $bytes = [IO.File]::ReadAllBytes($full)
    [void]$sha.TransformBlock($bytes, 0, $bytes.Length, $null, 0)
  }
  [void]$sha.TransformFinalBlock([byte[]]::new(0), 0, 0)
  ([BitConverter]::ToString($sha.Hash) -replace '-', '').ToLowerInvariant()
} finally {
  $sha.Dispose()
}
