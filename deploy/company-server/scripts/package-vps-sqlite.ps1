param(
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "../../..")
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $repoRoot "backups"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageDir = Join-Path $OutputRoot "vps-migration-$stamp"
$zipPath = "$packageDir.zip"

New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

Push-Location $repoRoot
try {
  Write-Host "Creating a consistent SQLite backup with VACUUM INTO..."
  $nodeOutput = node --input-type=module -e "import('./server/db.js').then(m=>{const r=m.backupDatabase(3650); console.log('@@BACKUP@@'+JSON.stringify(r)); process.exit(r.ok?0:1)}).catch(e=>{console.error(e); process.exit(1)})"
  $backupLine = $nodeOutput | Where-Object { $_ -like "@@BACKUP@@*" } | Select-Object -Last 1
  if (-not $backupLine) {
    throw "Could not read backup result from Node output."
  }
  $backup = ($backupLine -replace '^@@BACKUP@@', '') | ConvertFrom-Json
  if (-not $backup.ok) {
    throw "Backup failed: $($backup.error)"
  }

  Copy-Item -LiteralPath $backup.path -Destination (Join-Path $packageDir "store.db") -Force

  $paths = @(
    @{ Source = "server/permanent-storage"; Destination = "permanent-storage" },
    @{ Source = "server/uploads"; Destination = "uploads" },
    @{ Source = "server/releases"; Destination = "releases" },
    @{ Source = "server/assets/product-images"; Destination = "product-images" }
  )

  foreach ($entry in $paths) {
    $src = Join-Path $repoRoot $entry.Source
    if (Test-Path -LiteralPath $src) {
      Copy-Item -LiteralPath $src -Destination (Join-Path $packageDir $entry.Destination) -Recurse -Force
    }
  }

  Copy-Item -LiteralPath (Join-Path $repoRoot "deploy/company-server/.env.example") -Destination (Join-Path $packageDir "company-server.env.example") -Force

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

  $zip = Get-Item -LiteralPath $zipPath
  Write-Host "Done."
  Write-Host "Folder: $packageDir"
  Write-Host "Zip:    $zipPath"
  Write-Host ("Size:   {0:N2} MB" -f ($zip.Length / 1MB))
}
finally {
  Pop-Location
}
