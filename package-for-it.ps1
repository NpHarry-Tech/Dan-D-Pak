$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$OUT  = Join-Path $ROOT 'dan-d-pak-release.zip'

Write-Host ''
Write-Host '=== Dan D Pak - Tao goi release cho doi ky thuat ===' -ForegroundColor Cyan
Write-Host ('   Thu muc nguon: ' + $ROOT)
Write-Host ('   File ket qua : ' + $OUT)
Write-Host ''

if (Test-Path $OUT) { Remove-Item $OUT -Force }

$EXCLUDE = @(
    'node_modules', '.git', '.env', '*.db', '*.db-shm', '*.db-wal',
    '*.sqlite', '*.sqlite3', 'tmp_*', '*.log', 'backups', 'uploads',
    'storage\private', 'server\permanent-storage', '.next', 'dist',
    'build', 'out', 'dan-d-pak-release.zip', '.gemini'
)

$items = Get-ChildItem -Path $ROOT -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($ROOT.Length + 1)
    $skip = $false
    foreach ($ex in $EXCLUDE) {
        if ($rel -like ('*' + $ex + '*')) { $skip = $true; break }
        if ($_.Name -like $ex) { $skip = $true; break }
    }
    -not $skip
}

Write-Host ('  Tim thay ' + $items.Count + ' files se duoc dong goi...') -ForegroundColor Gray

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($OUT, 'Create')

foreach ($f in $items) {
    $entry = $f.FullName.Substring($ROOT.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $f.FullName, $entry,
        [System.IO.Compression.CompressionLevel]::Optimal)
}
$zip.Dispose()

$kb = [math]::Round((Get-Item $OUT).Length / 1024)
Write-Host ''
Write-Host ('  XONG! ' + $OUT + ' (' + $kb + ' KB)') -ForegroundColor Green
Write-Host ''
Write-Host 'Gui file ZIP nay cho doi ky thuat kem theo:' -ForegroundColor Yellow
Write-Host '  1. Giai nen va vao thu muc: deploy/company-server/'
Write-Host '  2. Doc ky: README_DEPLOY.md'
Write-Host '  3. Sao chep .env.example -> .env roi dien thong tin may chu'
Write-Host '  4. Chay: docker compose up -d --build'
Write-Host ''
