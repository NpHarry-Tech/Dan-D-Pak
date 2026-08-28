[CmdletBinding()]
param(
  [int]$PerFileTimeoutSeconds = 240,
  [string[]]$Include = @(),
  [string]$MatrixPath = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tests = @(Get-ChildItem -LiteralPath (Join-Path $root 'server') -Recurse -File -Filter '*.test.mjs' |
  Sort-Object FullName)
if ($Include.Count -gt 0) {
  $tests = @($tests | Where-Object {
    $path = $_.FullName
    @($Include | Where-Object { $path -like "*$_*" }).Count -gt 0
  })
}
if ($tests.Count -eq 0) { throw 'TEST_HARNESS_FAIL: no tests selected.' }

$matrix = [System.Collections.Generic.List[object]]::new()
function Stop-OwnedProcessTree([int]$ParentId) {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) { Stop-OwnedProcessTree ([int]$child.ProcessId) }
  Stop-Process -Id $ParentId -Force -ErrorAction SilentlyContinue
}
foreach ($test in $tests) {
  $stdout = New-TemporaryFile
  $stderr = New-TemporaryFile
  $watch = [Diagnostics.Stopwatch]::StartNew()
  # Several API tests intentionally leave server handles alive after their
  # assertions. Force-exit only after Node's test runner has reported results;
  # the per-file timeout still catches assertions/processes that never finish.
  $nodeArgs = "--test --test-force-exit `"$($test.FullName)`""
  $process = Start-Process -FilePath 'node' -ArgumentList $nodeArgs `
    -WorkingDirectory $root -RedirectStandardOutput $stdout.FullName `
    -RedirectStandardError $stderr.FullName -NoNewWindow -PassThru
  $timedOut = $false
  try {
    Wait-Process -Id $process.Id -Timeout $PerFileTimeoutSeconds -ErrorAction Stop
  } catch {
    $timedOut = $true
    Stop-OwnedProcessTree $process.Id
    Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
  $watch.Stop()
  if (-not $timedOut) { $process.WaitForExit() }
  $out = Get-Content -LiteralPath $stdout.FullName -Raw -ErrorAction SilentlyContinue
  $err = Get-Content -LiteralPath $stderr.FullName -Raw -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stdout.FullName,$stderr.FullName -Force -ErrorAction SilentlyContinue
  $exitCode = if ($timedOut) { 124 } else { [int]$process.ExitCode }
  $status = if ($timedOut) { 'TIMEOUT' } elseif ($exitCode -eq 0) { 'PASS' } else { 'FAIL' }
  $matrix.Add([ordered]@{
    file = $test.FullName.Substring($root.Length + 1)
    status = $status
    exitCode = $exitCode
    durationMs = $watch.ElapsedMilliseconds
    output = if ($status -eq 'PASS') { '' } else { (($out + "`n" + $err).Trim() | Select-Object -First 1) }
  })
  Write-Host ("{0,-28} {1,8} ms  {2}" -f $status,$watch.ElapsedMilliseconds,$test.Name) `
    -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } else { 'Red' })
  if ($MatrixPath) {
    $checkpoint = [ordered]@{
      completedAtUtc = [DateTime]::UtcNow.ToString('o')
      complete = $false
      selected = $tests.Count
      processed = $matrix.Count
      matrix = $matrix
    }
    $checkpoint | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $MatrixPath -Encoding utf8
  }
}

$result = [ordered]@{
  completedAtUtc = [DateTime]::UtcNow.ToString('o')
  complete = $true
  total = $matrix.Count
  passed = @($matrix | Where-Object status -eq 'PASS').Count
  failed = @($matrix | Where-Object status -ne 'PASS').Count
  matrix = $matrix
}
if ($MatrixPath) {
  $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $MatrixPath -Encoding utf8
}
$result | ConvertTo-Json -Depth 5
if ($result.failed -gt 0) { exit 1 }
