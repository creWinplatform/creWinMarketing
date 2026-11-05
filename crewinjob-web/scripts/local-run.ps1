# Runs one local Ryzevo job for the "Ryzevo Local" scheduled tasks (local-autostart.ps1), output into data\logs.
# Not for the production server: that uses deployment\windows\Register-RyzevoTasks.ps1.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidateSet('panel', 'worker', 'backup', 'drill')][string]$Mode)
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
if ($Mode -eq 'panel' -and (Test-Port 3033)) { Add-Content -LiteralPath $log -Value "$stamp port 3033 is already in use; not started."; exit 0 }
if ($Mode -eq 'worker' -and (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*local-worker.cjs*' })) { Add-Content -LiteralPath $log -Value "$stamp a local worker is already running; not started."; exit 0 }
$command = switch ($Mode) {
    'panel' { 'npm run dev' }
    'worker' { 'npm run worker:local' }
    'backup' { 'npm run backup:platform' }
    'drill' { 'npm run restore:drill -- --latest' }
}
Add-Content -LiteralPath $log -Value "$stamp start: $command"
& cmd.exe /d /c "$command >> `"$log`" 2>&1"
$code = $LASTEXITCODE
Add-Content -LiteralPath $log -Value "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) exit $code"
exit $code
