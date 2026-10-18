[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$ReleaseRoot,
    [Parameter(Mandatory = $true)][string]$NodeExe,
    [Parameter(Mandatory = $true)][string]$EnvFile
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows Task Scheduler is required.' }
$release = (Resolve-Path -LiteralPath $ReleaseRoot).Path
$node = (Resolve-Path -LiteralPath $NodeExe).Path
$config = (Resolve-Path -LiteralPath $EnvFile).Path
foreach ($value in @($release, $node, $config)) {
    if ($value.StartsWith('\\') -or $value.Contains('"')) { throw 'Use local absolute paths without quotes.' }
}
$launcher = Join-Path $release 'scripts\platform-windows.mjs'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Release launcher is missing.' }
$inside = $config.StartsWith($release.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
if ($inside) { throw 'Keep environment secrets outside the release.' }
$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v22\.') { throw 'Use Node 22 installed on this Windows host.' }
foreach ($name in @('App', 'Worker', 'Backup', 'Monitor')) {
    if (Get-ScheduledTask -TaskPath '\Ryzevo\' -TaskName $name -ErrorAction SilentlyContinue) { throw "Task $name exists. Review and update it explicitly; this installer never overwrites tasks." }
}
# Validate configuration and native dependencies before creating persistent tasks.
& $node "--env-file=$config" $launcher preflight
if ($LASTEXITCODE -ne 0) { throw 'Windows preflight failed. No tasks were registered.' }
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
$registered = @()
try {
    if (-not [System.Diagnostics.EventLog]::SourceExists('RyzevoMonitor')) {
        if ($PSCmdlet.ShouldProcess('Application/RyzevoMonitor', 'Register a dedicated Windows Event Log source')) {
            New-EventLog -LogName Application -Source 'RyzevoMonitor'
        }
    }
    foreach ($mode in @('App', 'Worker', 'Backup', 'Monitor')) {
        $arguments = '"--env-file=' + $config + '" "' + $launcher + '" ' + $mode.ToLowerInvariant()
        $action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $release
        if ($mode -eq 'Monitor') {
            $monitor = Join-Path $release 'deployment\windows\Invoke-RyzevoMonitor.ps1'
            if (-not (Test-Path -LiteralPath $monitor -PathType Leaf)) { throw 'Monitor wrapper is missing.' }
            $monitorArgs = '-NoProfile -NonInteractive -File "' + $monitor + '" -ReleaseRoot "' + $release + '" -NodeExe "' + $node + '" -EnvFile "' + $config + '"'
            $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $monitorArgs -WorkingDirectory $release
        }
        $trigger = switch ($mode) {
            'Backup' { New-ScheduledTaskTrigger -Daily -At '03:00' }
            'Monitor' { New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) }
            default { New-ScheduledTaskTrigger -AtStartup }
        }
        $limit = if ($mode -in @('App', 'Worker')) { [TimeSpan]::Zero } else { New-TimeSpan -Minutes 30 }
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit $limit -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
        if ($PSCmdlet.ShouldProcess("\Ryzevo\$mode", 'Register least-privilege task (not start)')) {
            Register-ScheduledTask -TaskPath '\Ryzevo\' -TaskName $mode -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Ryzevo modular monolith operator task' | Out-Null
            $registered += $mode
        }
    }
} finally {
    Write-Output ('Registered: ' + ($registered -join ', ') + '. No task was started by this installer. Review Local Service ACLs and scheduler results before starting App, then Worker.')
}
