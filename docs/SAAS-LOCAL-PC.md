# Running Ryzevo on the local PC

This covers the development PC that serves the panel on port 3033. The
production server uses `deployment/windows/Register-RyzevoTasks.ps1` and
`SAAS-WINDOWS-EC2.md`.

## Scheduled tasks

`scripts/local-autostart.ps1` registers five tasks under `\Ryzevo Local\`.
They run as the signed-in user, with limited rights.

| Task | When | Runs |
|---|---|---|
| Panel | at sign-in | `npm run dev` (port 3033) |
| Worker | at sign-in, after 2 minutes | `npm run worker:local` |
| Backup | daily at 03:00 | `npm run backup:platform` |
| Drill | Sundays at 04:00 | `npm run restore:drill -- --latest` |
| Offsite | daily at 03:30 | `npm run offsite:platform` (does nothing until S3 is set up) |

**Behaviour:**

- A Backup or Drill missed because the PC was off runs at the next start.
- Laptops keep running the tasks on battery.
- Panel and Worker skip themselves when one is already running, for example
  in a terminal. They are retried three times when they fail.
- Each task writes to `data/logs/<task>.log`. A log over 10 MB is moved to
  `<task>.old.log`.
- The drill restores the newest backup into `data/recovery-drills`, verifies
  it, then deletes the copied database and key. Only the report stays.

**Commands:**

```bash
powershell -ExecutionPolicy Bypass -File scripts/local-autostart.ps1 -Action Status
```

```bash
powershell -ExecutionPolicy Bypass -File scripts/local-autostart.ps1 -Action Remove
```

- `-Action Install` adds the tasks that are missing (for example Offsite on an
  older install). It never overwrites a task and never starts one.
- `-Action Remove` removes the tasks but does not stop running processes.

## Before adding a migration

Stop the Panel and Worker first, so the running panel does not apply a
half-written migration to the real database:

- end the processes;
- or disable the tasks in Task Scheduler while you work, then enable them again.

The usual order still applies: backup → trial run on a copy → apply → restart.

## Monitoring on this PC

`npm run monitor:platform` checks the database, the worker, the newest backup,
the drill and disk space.

- `PLATFORM_DRILL_EXPECTED=1` in `.env.local` turns on the drill check.
- The operator email (`PLATFORM_MONITOR_EMAIL_ENABLED`) needs the SES account
  email settings, so it stays off here until an email server is set up.
- The panel still shows a "Scheduled jobs are not running" alert to connection
  managers when the worker has stopped for 30 minutes. The alert becomes urgent
  after 2 hours.
