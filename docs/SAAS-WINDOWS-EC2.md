# Ryzevo - AWS EC2 Windows deployment

Target confirmed by the owner on 18 October 2026. This is a prepared operator
path, not evidence of access to, or deployment on, the EC2 instance. The Linux
Docker tests do NOT certify Windows native modules, Task Scheduler or IIS.

## Isolation and prerequisites

- Use a dedicated Ryzevo release, IIS site/binding, protected state directories,
  instance permissions and configuration. Do not overwrite Crewin's IIS site,
  database, certificates, scheduled tasks, payment configuration or credentials.
- Install official Node **22** for Windows on the EC2 host and build/install
  native dependencies there. Do not copy Linux Docker or local Node-20 native
  modules into Windows production. Local development is deliberately unchanged.
- One durable host, one SQLite store. A durable encrypted EBS volume is required;
  no network-share SQLite database. Restrict RDP to operator access. Expose HTTPS
  through the reviewed proxy, not Node port 3033. Require IMDSv2 on EC2; grant the
  instance role only the dedicated backup/log destinations actually required.
- Install/configure IIS ARR and URL Rewrite using Microsoft's supported path.
  Any shared server-level change must be reviewed against existing sites first.
  Configure certificate renewal and an external HTTPS probe separately.

Suggested layout (replace RELEASE_ID):

```text
C:\Ryzevo\releases\RELEASE_ID\crewinjob-web
C:\ProgramData\Ryzevo\config\runtime.env
C:\ProgramData\Ryzevo\data\platform.sqlite
C:\ProgramData\Ryzevo\backups
C:\ProgramData\Ryzevo\legacy-agent
```

Protect config/data/backups with Administrators, SYSTEM and Local Service only.
Local Service (SID S-1-5-19) needs read-only access to the release/Node executable,
read access to configuration and modify access to state/backups. It must not be
able to replace application code. Verify ACL inheritance and reparse points on
the actual host. The scripts do not claim to certify ACLs automatically.

The existing legacy agent writes to its own installation's data/log/output paths.
Keep a separate persistent agent installation, including its Windows-installed
production dependencies, under the private state root. No invented agent data
environment variable is used and no legacy module path is changed. Updating it
requires preserving its state. SaaS database backup does NOT back up that whole
legacy tree; retain a separately protected filesystem backup for it if enabled.

## Build and prepare

In a clean reviewed release on EC2, with Node 22 and no production secrets copied
into the release or build context:

```powershell
npm ci
$env:NEXT_DIST_DIR = '.next-production'
$env:NEXT_PUBLIC_APP_URL = 'https://ryzevo.com'
npm run build
npm run test:platform
npm run test:platform:http
npm prune --omit=dev
```

Review `deployment/windows/.env.example`. Put real values only in the protected
runtime.env outside the release. Generate independent AUTH/CRON secrets and a
stable 32-byte encryption key privately; never regenerate that key on restart or
release upgrade. Existing encrypted data needs its original matching key.
Complete the existing deployment-owner bootstrap configuration privately too.
All send/signup/payment gates start OFF. The example is not runnable with its
placeholder secrets; no price or paid entitlement is invented.

```powershell
& 'C:\Program Files\nodejs\node.exe' '--env-file=C:\ProgramData\Ryzevo\config\runtime.env' .\scripts\platform-windows.mjs preflight
.\deployment\windows\Register-RyzevoTasks.ps1 -ReleaseRoot $PWD.Path -NodeExe 'C:\Program Files\nodejs\node.exe' -EnvFile 'C:\ProgramData\Ryzevo\config\runtime.env' -WhatIf
```

The preflight checks Windows/Node 22, loopback binding, build ID, native SQLite,
stable secrets, matching HTTPS origins, private paths and state not redirected
inside the release. Actual .env/.env.local/production environment files in the
release are rejected; load configuration from the protected runtime.env instead.
It returns only check names and enabled gate names. It does
not open/migrate the customer database or prove DNS, TLS, AWS access or ACLs.
With operator approval, run the registration command without `-WhatIf`. It never
overwrites existing tasks and never starts one automatically. A partial
registration is reported for explicit review, not silently deleted/retried.

The four Local Service tasks are App and Worker at startup, Backup daily at
03:00 server-local time, and Monitor every five minutes. Set the host clock/time
zone consciously. IgnoreNew prevents concurrent instances of the SAME task;
do not add another external worker/backup scheduler. Scheduler retries are bounded.
Review child-process cleanup on the actual Windows host before accepting recovery.
Start App first, verify local health and authentication, then explicitly start
Worker only after queue review. Existing uncertain-send safeguards remain.

Monitor writes only status/alert codes to Application/RyzevoMonitor. This source
is registered only through the reviewed installer. CloudWatch Agent collection,
alarm subscription and real failure notification still require AWS operator
configuration; a local Event Log write is NOT an external notification.

## Proxy acceptance

`deployment/windows/iis.web.config.example` is a candidate for the NEW Ryzevo
site, not a global install. Preserve the original Host, allow only its named
forwarded server variables and replace spoofable forwarded headers. ARR may
append X-Forwarded-For itself: inspect the effective policy and ensure the
application sees exactly one trusted client IP before enabling PayTR sandbox.
Do not relax the application's multi-value rejection to make a bad proxy pass.
Do not change global ARR behavior affecting Crewin without a supervised test.

Node is loopback-only. Validate the actual host's login redirect remains on
https://ryzevo.com, cookies are Secure, Origin checks reject foreign sites,
callbacks use exact HTTPS URLs, HTTP redirects to HTTPS and unknown Host is denied.
No real certificate, IIS binding or firewall rule was changed during development.

## Backups, recovery and release gates

The existing backup command seals the SQLite copy and verifies matching key and
schema. After first boot, run a backup, offline verify and separate restore drill
as Local Service using the private environment. Rotate AUTH_SECRET after an
actual restore and review memberships, suppressions and uncertain sends before
reopening the worker. See SAAS-RECOVERY.md.

Use an independent private S3 destination with encryption, versioning, bounded
retention and least-privilege instance-role access. Copy only sealed backups
after local verification; protect the matching key separately. Test download,
verification and restore on a separate volume. EBS persistence and a same-volume
daily backup are NOT off-host disaster recovery. S3 bucket/account/KMS policy and
retention must be supplied and reviewed before any actual transfer or automation.

Acceptance on EC2 must include a reboot, task recovery, volume persistence, disk
pressure/backup-age alerts, external HTTPS outage notification and offline restore
from an off-host copy. None is claimed complete by local helper tests.

## References

- [Microsoft IIS reverse proxy](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing)
- [Microsoft URL Rewrite configuration](https://github.com/MicrosoftDocs/iis-docs/blob/main/iis/extensions/url-rewrite-module/url-rewrite-module-20-configuration-reference.md)
- [AWS instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)

Provider configuration, live PayTR lifecycle, real-device/screen-reader checks
and a live HSS Digital user acceptance remain separately tracked release gates.
