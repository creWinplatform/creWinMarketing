[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ReleaseRoot,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$EnvFile
)
$ErrorActionPreference = 'Stop'
$code = 2
$status = 'critical'
$codes = @('monitor_execution_failed')
try {
    $launcher = Join-Path (Resolve-Path -LiteralPath $ReleaseRoot).Path 'scripts\platform-windows.mjs'
    $output = & $NodeExe "--env-file=$EnvFile" $launcher monitor 2>$null
    $code = $LASTEXITCODE
    $lastJson = @($output | Where-Object { $_ -is [string] -and $_.StartsWith('{') }) | Select-Object -Last 1
    $report = $lastJson | ConvertFrom-Json
    if ($report.status -in @('ok', 'warning', 'critical')) {
        $status = $report.status
        $codes = @($report.alerts | ForEach-Object { $_.code } | Where-Object { $_ -match '^[a-z0-9_]{1,80}$' } | Sort-Object -Unique | Select-Object -First 50)
    } else { $code = 2 }
} catch { $code = 2 }
# Only safe aggregate codes enter Windows Event Log, never raw provider output.
$message = @{ status = $status; checkedAt = (Get-Date).ToUniversalTime().ToString('o'); alertCodes = $codes; externalNotificationSent = $false } | ConvertTo-Json -Compress
$entryType = switch ($status) { 'ok' { 'Information' } 'warning' { 'Warning' } default { 'Error' } }
try { Write-EventLog -LogName Application -Source 'RyzevoMonitor' -EventId 1001 -EntryType $entryType -Message $message }
catch { Write-Output '{"status":"critical","code":"windows_event_log_write_failed"}'; exit 2 }
Write-Output $message
exit $code
