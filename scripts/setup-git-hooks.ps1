$ErrorActionPreference = 'Stop'
$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) { throw 'Not inside a Git repository.' }
git -C $repoRoot config core.hooksPath .githooks
Write-Output 'Configured core.hooksPath=.githooks'
