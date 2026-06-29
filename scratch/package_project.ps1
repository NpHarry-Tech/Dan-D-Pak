$src = "C:\Users\PC\Desktop\Dan D Pak"
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$desktop = [System.Environment]::GetFolderPath("Desktop")
$zipPath = Join-Path $desktop "Dan-D-Pak-FULL-HANDOVER-$stamp.zip"
$tempDir = Join-Path $env:TEMP "dandpak-temp-$stamp"

# Recreate temp dir
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Dang sao chep file nguon (loai tru node_modules, .git, .zip, .log)..."
Get-ChildItem -Path $src | Where-Object { 
    $_.Name -ne "node_modules" -and 
    $_.Name -ne ".git" -and 
    $_.Name -notlike "*.zip" -and 
    $_.Name -notlike "*.log" 
} | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $tempDir -Recurse -Force
}

Write-Host "Dang nen file zip..."
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

Write-Host "Dang don dep thu muc tam..."
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "DONE_ZIP_PATH: $zipPath"
