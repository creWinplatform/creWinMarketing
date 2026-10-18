# Ryzevo private operator monitoring

Phase 6 increment, 2026-10-18. This extends the existing modular monolith and
worker, not a second scheduler, job queue, notification service or public API.
Crewin's external services and its product pack are unchanged.

## Boundaries

- Public `/api/health` remains liveness only: `{ ok, ts }`. It does not disclose
  database, job, customer, backup or credential information.
- The existing authenticated `/api/platform/worker` records one bounded latest
  tick observation. `CRON_SECRET` is still required; a customer's browser session
  cannot create a heartbeat. No heartbeat HTTP endpoint is added.
- `npm run monitor:platform` is a one-shot, local operator probe. It opens the
  configured SQLite file read-only and checks the latest private backup and disk.
  It does not migrate data, start the worker, execute/retry/cancel a job, change a
  payment, enable a provider gate or send a notification.
- The JSON report is intended for trusted operator logs, not a tenant dashboard.
  It contains aggregate counts/codes, not account names, member emails, job IDs,
  database paths, tokens, decrypted credentials or exception bodies.
- This is not active external monitoring until an operator schedules the probe
  and connects its result to an approved alert destination. No recurring task,
  email/Slack alert, watchdog, production deploy or external provider call was
  enabled during development. `notificationsSent` is always false.

## Configuration and command

Run from a trusted `crewinjob-web` checkout under the service account:

```powershell
npm run monitor:platform
npm run test:platform:monitor
```

`PLATFORM_DATABASE_PATH`, `PLATFORM_BACKUP_PATH` and the private encryption-key
configuration reuse the existing backup/worker settings. No secrets belong on
the command line. New defaults are recorded only in `.env.local.example`; the
actual `.env.local` has not been changed:

| Setting | Default | Meaning |
| --- | --- | --- |
| PLATFORM_WORKER_EXPECTED | 0 | Set 1 only when an operator-supervised worker should run. Does not start it. |
| PLATFORM_MONITOR_WORKER_STALE_SECONDS | 180 | Maximum age of a confirmed tick/unfinished run; range 60-3600. |
| PLATFORM_MONITOR_QUEUE_DELAY_MINUTES | 15 | Ready queued work older than this raises a warning; range 1-1440. |
| PLATFORM_MONITOR_BACKUP_MAX_AGE_HOURS | 26 | Latest verified backup older than this raises a critical alert; range 1-168. |
| PLATFORM_MONITOR_MIN_FREE_MB | 512 | Available disk floor; range 16-1048576. |

Reports use exit code 0 for no alert, 1 for warning and 2 for critical or invalid
configuration. The Next environment loader can print a load notice before the
JSON. `status: ok` means only that these configured checks raised no alert; it is
not proof of provider availability, successful delivery, uptime or SaaS readiness.
HTTP uptime must be checked separately; the report explicitly says `not_checked`.

The probe authenticates/decrypts a full latest backup using the existing recovery
verifier. Schedule it conservatively on large databases to avoid excess disk I/O;
do not poll it every few seconds. It does not verify off-host backup availability.
The operator scripts are now packaged and exercised in an isolated Linux runner;
see [runtime acceptance](SAAS-RUNTIME-ACCEPTANCE.md). Actual production scheduling,
durable volumes and external alert routing remain release gates.

## Persisted observation and schema 27

Migration 27 adds two bounded deployment-level tables, not tenant records:

- `platform_worker_observations`: one checked component, latest opaque run ID,
  first/start/finish timestamps, last fully successful tick, outcome, checked and
  handler-error counts, capped consecutive failures. No payload/error string.
- `platform_operation_metadata`: one random `database_id`. It is stable across
  restarts and recovery copies and is never exposed by the public health route.

An observation starts only after worker authentication. A completion may update
only its current still-running run ID; older overlapping ticks cannot overwrite
the latest observation. A thrown tick is recorded as `failed`; its HTTP response
is a controlled 503 with no SQL/path/provider details. Existing successful worker
response fields remain unchanged. A partially failed handler loop is `partial`,
not a claimed whole-worker crash. `checked` counts handlers, not delivered emails.

Starting repeatedly without ever finishing cannot masquerade as health: the probe
also checks the last completed success, or the first observation if none exists.
No job is retried because a probe or a failed observation occurred.

Migration is applied through the existing application initialization, not by the
probe. A pre-27 database is reported with `database_schema_upgrade_pending`.
After a schema deployment, restart the existing app under normal procedures and
take a new backup after initialization. Do not start a live worker just to obtain
a green heartbeat during local QA.

## Backup binding

New schema-27 version-2 backup manifests include `databaseId` in their key proof.
The snapshot's ID must match that manifest, and the probe requires the latest
backup to match the active database. A different customer's deployment backup
cannot satisfy the check even when it uses the same encryption key.

Existing pre-27 version-2 snapshots remain independently verifiable, but source
binding cannot be proved; the probe raises `backup_database_binding_unknown`.
The newest incomplete/corrupt backup is reported, not silently hidden behind an
older healthy one. No old backup is deleted, rewritten or automatically restored.
See [offline recovery operations](SAAS-RECOVERY.md).

## Alert handling

| Code/group | Operator response |
| --- | --- |
| database_unavailable / database_schema_unsupported | Check service-account access, disk and deployment/schema compatibility. Do not create a replacement empty database. |
| worker_not_observed / worker_stale / worker_stalled / worker_no_recent_success | Check the existing supervisor, worker process and authenticated tick logs. A new start alone is not a completed tick. |
| worker_tick_failed / worker_tick_partial | Investigate through protected logs and existing job views; never log raw provider responses or tokens. |
| queue_delayed / queue_expired_leases | Inspect existing scoped job views and gates. The probe must not reset a lease or replay work. |
| queue_unsupported_jobs / queue_missing_payload | Investigate deployment compatibility or missing job data. Do not manufacture a payload. |
| queue_recent_failures | Review the last 24 hours of job failures; this may include controlled business/safety rejection, not a provider outage. |
| email_delivery_uncertain / social_publication_uncertain / identity_delivery_uncertain | Inspect provider state before any operator action. Unknown is not unsent; do not automatically resend. |
| billing_requires_review / billing_inquiry_interrupted | Use existing explicit PayTR test inquiry/review controls. Never infer failed payment or upgrade access from this probe. |
| backup_missing / backup_missing_or_incomplete / backup_verification_failed / backup_stale | Inspect the newest protected backup and take/verify a new one through the existing command. No implicit fallback or restore. |
| backup_database_mismatch / backup_database_binding_unknown | Confirm the intended database/backup root and take a freshly bound backup. |
| disk_space_low / disk_check_unavailable | Check the service volume, private retention and filesystem permissions. No automated deletion is performed. |

Future social schedules and future Instagram container checks are excluded from
ready/overdue queue counts. Delay starts at the effective due/check time, not at
draft creation. Cancelled/completed jobs do not become overdue. Unknown submitted
delivery states remain separate attention signals, never a trigger for replay.

## Still needed for production

Configure external uptime and alert routing, process supervision, protected log
retention, backup scheduling/off-host storage and an authorized incident drill.
Load/abuse tests and a real non-Crewin pilot remain. No real PayTR merchant, mail
or social acceptance is implied by a healthy local fixture.

## Local acceptance record - 18 October 2026

- All 378 platform tests passed with no skipped tests, including 17 monitoring
  cases and backward-compatible backup binding verification.
- TypeScript and isolated production build passed. The pre-existing workspace
  multiple-lockfile warning remains; no unrelated lockfile was removed.
- The real production HTTP integration fixture passed: a worker tick persists,
  an authenticated browser without the cron credential cannot forge it, a forced
  tick failure returns sanitized 503 and preserves last success, and public
  health exposes only `ok`/`ts`. No real provider call was made.
- The read-only probe against the existing local schema-24 database returned
  warning, not fabricated success: queue empty, latest backup verified, disk
  available; schema upgrade and source-binding warnings remain until normal app
  initialization applies schema 27 and a fresh backup is taken. No forced local
  migration or live worker tick was performed for this check.
- No actual environment file, provider gate, scheduler, production data, payment
  entitlement, Crewin external endpoint or public health contract was changed.
