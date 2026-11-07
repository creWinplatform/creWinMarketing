# Running Ryzevo on the local PC

This covers the development PC that serves the panel on port 3033. The
production server uses `deployment/windows/Register-RyzevoTasks.ps1` and
`SAAS-WINDOWS-EC2.md`.

## Scheduled tasks

`scripts/local-autostart.ps1` registers five tasks under `\Ryzevo Local\`.
They run as the signed-in user, with limited rights.

| Task | When | Runs |
|---|---|---|
| Panel | on demand (`npm run local:start`) | the production build: `npm run start` with `NEXT_DIST_DIR=.next-local` (port 3033), built first when missing |
| Worker | on demand, with the Panel | `npm run worker:local` |
| Backup | daily at 03:00 | `npm run backup:platform` |
| Drill | Sundays at 04:00, when the PC is idle | `npm run restore:drill -- --latest` |
| Offsite | daily at 03:30 | `npm run offsite:platform` (does nothing until S3 is set up) |

**Behaviour (7 November 2026):**

- **No window.** Every task runs through `conhost.exe --headless`. Before, `-WindowStyle Hidden` still opened an
  empty Windows Terminal window when Terminal was the default console, and closing that window stopped the panel.
- **Nothing at sign-in.** Panel and Worker no longer start with Windows, so they cannot slow the PC down while it
  boots. Run `npm run local:start` when you need the panel and `npm run local:stop` when you are done.
  `-Action Install -AutoStart` brings back the sign-in start, delayed 3 minutes (Panel) and 5 minutes (Worker).
- **Below-normal priority** for every task, so they yield to what you are doing.
- A Backup missed because the PC was off runs at the next start (it takes a few seconds). A missed Drill waits
  until the PC has been idle for 10 minutes.
- Laptops keep running the tasks on battery.
- Panel and Worker skip themselves when one is already running, for example in a terminal.
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

- `-Action Install` registers all five tasks again, so it also updates an older
  install. It never starts one.
- `-Action Start` / `-Action Stop` (also `npm run local:start` / `local:stop`)
  start or stop the Panel and Worker. Stop ends the runners, whatever listens on
  3033 and the local worker.
- `-Action Remove` removes the tasks but does not stop running processes.

## Production build (6 November 2026)

The Panel task serves a production build from `.next-local` instead of the development server.

- **Why:** pages load faster. The development server sent unoptimised code, so data requests only started after about 2.8 seconds, and it ran every data request twice.
- **Safer migrations:** a running production build never hot-reloads, so it cannot pick up a half-written migration.

**After a code change**

1. Stop the panel: end its `next start` process, or stop the Panel task.
2. Rebuild:

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/local-run.ps1 -Mode build
   ```

   It refuses to run while port 3033 is in use.
3. Start the Panel task again from Task Scheduler.

**Developing with hot reload**

```bash
powershell -ExecutionPolicy Bypass -File scripts/local-run.ps1 -Mode panel-dev
```

This runs `npm run dev` on the usual `.next` folder.

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
