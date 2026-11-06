# Keeps the local Ryzevo panel and worker running on this PC and takes the nightly backup and weekly drill.
# Tasks run as the signed-in user under "\Ryzevo Local\"; nothing is started by this script.
#   powershell -ExecutionPolicy Bypass -File scripts\local-autostart.ps1 -Action Install
#   ... -Action Status | -Action Remove
# The production server uses deployment\windows\Register-RyzevoTasks.ps1 instead.
[CmdletBinding(SupportsShouldProcess = $true)]
param([Parameter(Mandatory = $true)][ValidateSet('Install', 'Remove', 'Status')][string]$Action)
$ErrorActionPreference = 'Stop'
$path = '\Ryzevo Local\'
$names = @('Panel', 'Worker', 'Backup', 'Drill', 'Offsite')
if ($Action -eq 'Status') {
    foreach ($name in $names) {
        $task = Get-ScheduledTask -TaskPath $path -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) { Write-Output "${name}: not installed"; continue }
        $info = $task | Get-ScheduledTaskInfo
        Write-Output ("{0}: {1}, last run {2}, result {3}, next run {4}" -f $name, $task.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
    }
    exit 0
}
if ($Action -eq 'Remove') {
    foreach ($name in $names) {
        if ((Get-ScheduledTask -TaskPath $path -TaskName $name -ErrorAction SilentlyContinue) -and $PSCmdlet.ShouldProcess("$path$name", 'Remove task')) { Unregister-ScheduledTask -TaskPath $path -TaskName $name -Confirm:$false }
    }
    Write-Output 'Removed. Running processes were not stopped.'
    exit 0
}
$runner = Join-Path $PSScriptRoot 'local-run.ps1'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'scripts\local-run.ps1 is missing.' }
# Existing tasks are kept as they are; Install only adds the missing ones (for example Offsite on an older install).
$missing = @($names | Where-Object { -not (Get-ScheduledTask -TaskPath $path -TaskName $_ -ErrorAction SilentlyContinue) })
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$registered = @()
foreach ($name in $missing) {
    $mode = $name.ToLowerInvariant()
    $taskAction = New-ScheduledTaskAction -Execute $shell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -Mode ' + $mode) -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
    $trigger = switch ($name) {
        'Panel' { New-ScheduledTaskTrigger -AtLogOn -User $user }
        'Worker' { $t = New-ScheduledTaskTrigger -AtLogOn -User $user; $t.Delay = 'PT2M'; $t }
        'Backup' { New-ScheduledTaskTrigger -Daily -At '03:00' }
        'Drill' { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:00' }
        # Does nothing until PLATFORM_OFFSITE_ENABLED=1 and the S3 settings are in .env.local.
        'Offsite' { New-ScheduledTaskTrigger -Daily -At '03:30' }
    }
    $long = $name -in @('Panel', 'Worker')
    $limit = if ($long) { [TimeSpan]::Zero } else { New-TimeSpan -Minutes 30 }
    # A missed backup or drill (PC off at night) runs at the next start; laptops keep running on battery.
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit $limit -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    if ($PSCmdlet.ShouldProcess("$path$name", 'Register task (not start)')) {
        Register-ScheduledTask -TaskPath $path -TaskName $name -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal -Description 'Ryzevo local panel, worker, backup, drill and off-host copy (scripts\local-autostart.ps1)' | Out-Null
        $registered += $name
    }
}
Write-Output ('Registered: ' + $(if ($registered.Count) { $registered -join ', ' } else { 'nothing new' }) + '. Nothing was started; Panel and Worker start at the next sign-in, logs go to data\logs.')
