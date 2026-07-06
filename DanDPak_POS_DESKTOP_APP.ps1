param(
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseUrl = 'http://127.0.0.1:3000'
$AppUrl = "$BaseUrl/?app=desktop"
$HealthUrl = "$BaseUrl/health"
$ProfileDir = Join-Path $env:LOCALAPPDATA 'DanDPakPOS\desktop-edge-profile'
$ScratchDir = Join-Path $Root 'scratch'
$OutLog = Join-Path $ScratchDir 'desktop-engine.out'
$ErrLog = Join-Path $ScratchDir 'desktop-engine.err'

function Show-ErrorBox {
  param([string]$Message)
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show($Message, 'Dan D Pak POS', 'OK', 'Error') | Out-Null
  } catch {
    Write-Error $Message
  }
}

function Test-DanDPakEngine {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
    return ($health.ok -eq $true -and $health.service -eq 'dan-d-pak-pos-erp')
  } catch {
    return $false
  }
}

function Find-Edge {
  $paths = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )
  foreach ($p in $paths) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

try {
  New-Item -ItemType Directory -Force -Path $ScratchDir | Out-Null
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

  if (-not (Test-DanDPakEngine)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      Show-ErrorBox 'Node.js was not found. Please install Node.js or start the POS engine manually.'
      exit 1
    }

    Start-Process -FilePath $node.Source `
      -ArgumentList @('server/index.js') `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $OutLog `
      -RedirectStandardError $ErrLog | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-DanDPakEngine) {
        $ready = $true
        break
      }
    }

    if (-not $ready) {
      Show-ErrorBox "POS engine did not start. Check logs:`n$ErrLog"
      exit 1
    }
  }

  if ($NoOpen) { exit 0 }

  $edge = Find-Edge
  if ($edge) {
    Start-Process -FilePath $edge -ArgumentList @(
      "--app=$AppUrl",
      '--new-window',
      "--user-data-dir=$ProfileDir",
      '--no-first-run'
    ) | Out-Null
  } else {
    Start-Process $AppUrl | Out-Null
  }
} catch {
  Show-ErrorBox $_.Exception.Message
  exit 1
}
