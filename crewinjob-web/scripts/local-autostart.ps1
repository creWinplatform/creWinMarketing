# Runs the local Ryzevo panel and worker on demand and takes the nightly backup and weekly drill.
# Tasks run as the signed-in user under "\Ryzevo Local\", without a console window (conhost --headless).
#   powershell -ExecutionPolicy Bypass -File scripts\local-autostart.ps1 -Action Install [-AutoStart]
#   ... -Action Start | -Action Stop | -Action Status | -Action Remove
# Without -AutoStart, Panel and Worker never start at sign-in, so they cannot slow the PC down while it boots;
# -Action Start starts them. The production server uses deployment\windows\Register-RyzevoTasks.ps1 instead.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Install', 'Remove', 'Status', 'Start', 'Stop')][string]$Action,
    [switch]$AutoStart
)
$ErrorActionPreference = 'Stop'
$path = '\Ryzevo Local\'
$names = @('Panel', 'Worker', 'Backup', 'Drill', 'Offsite')
$installed = { param($name) Get-ScheduledTask -TaskPath $path -TaskName $name -ErrorAction SilentlyContinue }
if ($Action -eq 'Status') {
    foreach ($name in $names) {
        $task = & $installed $name
        if (-not $task) { Write-Output "${name}: not installed"; continue }
        $info = $task | Get-ScheduledTaskInfo
        Write-Output ("{0}: {1}, last run {2}, result {3}, next run {4}" -f $name, $task.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
    }
    exit 0
}
if ($Action -eq 'Remove') {
    foreach ($name in $names) {
        if ((& $installed $name) -and $PSCmdlet.ShouldProcess("$path$name", 'Remove task')) { Unregister-ScheduledTask -TaskPath $path -TaskName $name -Confirm:$false }
    }
    Write-Output 'Removed. Running processes were not stopped.'
    exit 0
}
if ($Action -eq 'Start') {
    foreach ($name in @('Panel', 'Worker')) {
        if (-not (& $installed $name)) { throw "$name is not installed; run -Action Install first." }
        Start-ScheduledTask -TaskPath $path -TaskName $name
    }
    Write-Output 'Panel and Worker started in the background. The panel answers at http://localhost:3033 in about 10 seconds (longer when it has to build first); logs: data\logs.'
    exit 0
}
if ($Action -eq 'Stop') {
    # Stopping the task first keeps it from counting as a failure and being restarted.
    foreach ($name in @('Panel', 'Worker')) { if (& $installed $name) { Stop-ScheduledTask -TaskPath $path -TaskName $name } }
    # Stopping the task ends only its headless console; the runner and node live on. End the panel and worker runners,
    # whatever listens on 3033 and the local worker, each with its children.
    $ids = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'local-run\.ps1"? -Mode (panel|panel-dev|worker)\b' } | Select-Object -ExpandProperty ProcessId)
    $ids += @(Get-NetTCPConnection -LocalPort 3033 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
    $ids += @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*local-worker.cjs*' } | Select-Object -ExpandProperty ProcessId)
    foreach ($id in ($ids | Where-Object { $_ } | Sort-Object -Unique)) { & cmd.exe /d /c "taskkill /T /F /PID $id >nul 2>&1" }
    Write-Output $(if ($ids.Count) { 'Panel and Worker stopped.' } else { 'Panel and Worker were not running.' })
    exit 0
}
$runner = Join-Path $PSScriptRoot 'local-run.ps1'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'scripts\local-run.ps1 is missing.' }
# Install (re)registers every task, so running it again applies changes to an existing install.
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$shell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
# -WindowStyle Hidden alone still opens an empty window when Windows Terminal is the default console; a headless conhost opens none.
$host_ = Join-Path $env:WINDIR 'System32\conhost.exe'
$registered = @()
foreach ($name in $names) {
    $mode = $name.ToLowerInvariant()
    $taskAction = New-ScheduledTaskAction -Execute $host_ -Argument ('--headless "' + $shell + '" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -Mode ' + $mode) -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
    # Sign-in starts are delayed past the busy first minutes of a boot.
    $trigger = switch ($name) {
        'Panel' { if ($AutoStart) { $t = New-ScheduledTaskTrigger -AtLogOn -User $user; $t.Delay = 'PT3M'; $t } }
        'Worker' { if ($AutoStart) { $t = New-ScheduledTaskTrigger -AtLogOn -User $user; $t.Delay = 'PT5M'; $t } }
        'Backup' { New-ScheduledTaskTrigger -Daily -At '03:00' }
        'Drill' { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:00' }
        # Does nothing until PLATFORM_OFFSITE_ENABLED=1 and the S3 settings are in .env.local.
        'Offsite' { New-ScheduledTaskTrigger -Daily -At '03:30' }
    }
    $long = $name -in @('Panel', 'Worker')
    $limit = if ($long) { [TimeSpan]::Zero } else { New-TimeSpan -Minutes 30 }
    # Priority 7 is below normal: the jobs yield to whatever the user is doing. Laptops keep running them on battery.
    $options = @{ MultipleInstances = 'IgnoreNew'; ExecutionTimeLimit = $limit; Priority = 7; AllowStartIfOnBatteries = $true; DontStopIfGoingOnBatteries = $true }
    # A missed backup (a few seconds) runs at the next start; a missed drill (a full restore check) waits until the PC is idle.
    if (-not $long) { $options += @{ StartWhenAvailable = $true; RestartCount = 3; RestartInterval = (New-TimeSpan -Minutes 1) } }
    if ($name -eq 'Drill') { $options += @{ RunOnlyIfIdle = $true; IdleDuration = (New-TimeSpan -Minutes 10); IdleWaitTimeout = (New-TimeSpan -Hours 23) } }
    $settings = New-ScheduledTaskSettingsSet @options
    if ($PSCmdlet.ShouldProcess("$path$name", 'Register task (not start)')) {
        $task = @{ TaskPath = $path; TaskName = $name; Action = $taskAction; Settings = $settings; Principal = $principal; Force = $true; Description = 'Ryzevo local panel, worker, backup, drill and off-host copy (scripts\local-autostart.ps1)' }
        if ($trigger) { $task.Trigger = $trigger }
        Register-ScheduledTask @task | Out-Null
        $registered += $name
    }
}
$when = if ($AutoStart) { 'Panel and Worker start 3 and 5 minutes after sign-in' } else { 'Panel and Worker start only with -Action Start' }
Write-Output ('Registered: ' + $(if ($registered.Count) { $registered -join ', ' } else { 'nothing' }) + ". Nothing was started; $when. Logs go to data\logs.")
