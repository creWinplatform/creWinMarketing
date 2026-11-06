# Runs one local Ryzevo job for the "Ryzevo Local" scheduled tasks (local-autostart.ps1), output into data\logs.
# Not for the production server: that uses deployment\windows\Register-RyzevoTasks.ps1.
[CmdletBinding()]
# panel: the production build in .next-local (built first when missing); build: rebuild it while the panel is stopped;
# panel-dev: the development server with hot reload, for working on the code.
param([Parameter(Mandatory = $true)][ValidateSet('panel', 'panel-dev', 'build', 'worker', 'backup', 'drill', 'offsite')][string]$Mode)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$logs = Join-Path $root 'data\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs "$Mode.log"
# Keep one previous log of at most 10 MB.
if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 10MB) { Move-Item -LiteralPath $log -Destination (Join-Path $logs "$Mode.old.log") -Force }
$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
# A panel or worker that is already running (for example in a terminal) is left alone.
function Test-Port([int]$Port) {
    foreach ($address in @('127.0.0.1', '::1')) {
        $client = New-Object System.Net.Sockets.TcpClient($(if ($address -eq '::1') { 'InterNetworkV6' } else { 'InterNetwork' }))
        try { if ($client.ConnectAsync($address, $Port).Wait(1500) -and $client.Connected) { return $true } } catch {} finally { $client.Dispose() }
    }
    return $false
}
if ($Mode -in @('panel', 'panel-dev') -and (Test-Port 3033)) { Add-Content -LiteralPath $log -Value "$stamp port 3033 is already in use; not started."; exit 0 }
# Building into the folder a running panel serves would break it.
if ($Mode -eq 'build' -and (Test-Port 3033)) { Add-Content -LiteralPath $log -Value "$stamp stop the panel on port 3033 before rebuilding."; exit 1 }
if ($Mode -eq 'worker' -and (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*local-worker.cjs*' })) { Add-Content -LiteralPath $log -Value "$stamp a local worker is already running; not started."; exit 0 }
# The production build lives apart from the development server's .next folder. next build adds its folder to
# tsconfig.json; the file is put back exactly as it was so the repository does not change.
$env:NEXT_DIST_DIR = '.next-local'
function Invoke-Build {
    $tsconfig = Join-Path $root 'tsconfig.json'; $saved = [IO.File]::ReadAllBytes($tsconfig)
    try { & cmd.exe /d /c "npm run build >> `"$log`" 2>&1"; return $LASTEXITCODE } finally { [IO.File]::WriteAllBytes($tsconfig, $saved) }
}
if ($Mode -eq 'build' -or ($Mode -eq 'panel' -and -not (Test-Path -LiteralPath (Join-Path $root '.next-local\BUILD_ID')))) {
    Add-Content -LiteralPath $log -Value "$stamp start: npm run build (.next-local)"
    $code = Invoke-Build
    Add-Content -LiteralPath $log -Value "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) build exit $code"
    if ($code -ne 0 -or $Mode -eq 'build') { exit $code }
}
$command = switch ($Mode) {
    'panel' { 'npm run start' }
    'panel-dev' { 'set NEXT_DIST_DIR=&& npm run dev' }
    'worker' { 'npm run worker:local' }
    'backup' { 'npm run backup:platform' }
    'drill' { 'npm run restore:drill -- --latest' }
    'offsite' { 'npm run offsite:platform' }
}
Add-Content -LiteralPath $log -Value "$stamp start: $command"
& cmd.exe /d /c "$command >> `"$log`" 2>&1"
$code = $LASTEXITCODE
Add-Content -LiteralPath $log -Value "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) exit $code"
exit $code
