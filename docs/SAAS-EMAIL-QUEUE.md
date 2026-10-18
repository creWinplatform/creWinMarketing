# Phase 3C2a - persistent email pilot rehearsal

Phase 3C2b adds a separate real-pilot mode to this same queue, not another job
system. Rehearsal continues to be no-send. The historical section below describes
rehearsal only; [SES delivery](SAAS-SES-DELIVERY.md) is the current real-mode contract.

This slice validates the recipient queue lifecycle WITHOUT implementing or enabling
SMTP delivery. It is not a successful send, provider acceptance, inbox delivery,
SPF/DKIM verification or a production sending release. Every public response has
`mode: rehearsal` and/or `sendingEnabled: false`. Crewin adapters are unchanged.

## Operator flow

Campaigns > Drafts > saved email review > Pilot rehearsal:

1. Select a project sender, explicitly allow test addresses, review consent, run
   current preflight and approve saved content through the existing screens.
2. Acknowledge that no real email will be sent, then enqueue the rehearsal.
3. Use Process rehearsal, or let the existing authenticated platform worker pick
   up the job. Refresh/polling reads its persisted state; a browser disconnect
   does not delete or restart work.
4. Inspect masked per-recipient results and independent sender gates. Passed
   recipient checks are NEVER labeled sent or delivered. Authentication and real
   sending remain blocked, even if all recipient checks pass.
5. Cancel queued/running work. An in-flight row becomes uncertain rather than
   being falsely reported as cleanly cancelled; untouched rows are cancelled.

## Reuse and schema

Migration 17 extends `platform_jobs` with the `email.rehearsal` job type, plus
scoped child tables `platform_email_pilots` and `platform_email_pilot_recipients`.
There is no second campaign store, identity model, job scheduler, SMTP registry,
segment engine or consent evaluator. Connection jobs explicitly filter their own
types and cannot run/cancel a pilot through the connection automation API.

The existing worker API routes the type to its bounded handler; existing
`scripts/platform-worker.mjs` remains the only background worker entry point.
`POST /api/platform/email-pilots` also permits an authorized manual rehearsal run
when no background worker has been configured. It cannot accept a transport,
change mode to send, bypass checks or supply a success result.

## Safety and persistence

- An owner/admin with current campaign approval, connection and recipient
  management permissions may enqueue/run/cancel. Standard project scoping is
  always taken from the authenticated session. Viewers get aggregate counts only;
  per-recipient masks/reasons and sender metadata remain management-only.
- Queue selection recomputes the EXISTING pinned segment and consent/suppression
  evaluator, intersects the live pilot allowlist, sorts scoped email identities
  deterministically and caps at the configured 1-5 recipients. No inferred emails.
- The snapshot pins the saved message, subject, URL, preview, content digest,
  approval ID, selected sender credentials revision, pilot cap and chosen contacts.
  Full addresses/message are stored only in the existing project-bound AES-GCM
  envelope; public job results contain masks, positions and safe reason codes.
  No SMTP credentials are copied into the snapshot.
- A scoped idempotency key binds campaign/digest/approval. Replays return the
  original job, including after cancellation, without reserving quota again.
  A different payload with the same key conflicts. Only one active rehearsal per
  campaign is allowed. Limits: 20 jobs/project/UTC day, 500 stored jobs/project,
  max 5 rows/job, 60-minute job lifetime and at most 3 job claims.
- Each recipient rechecks the initiating actor's live authority, latest approval,
  content/sender/cap versions, source health/current segment membership, current
  identity/consent/suppression and active allowlist before AND after the async
  boundary. Manual execution separately rechecks its current runner's authority.
  Fresh segment evaluation uses the existing engine without consuming
  an operator preview or overwriting preflight history.
- A transactional 30-second lease fences concurrent workers and late results.
  Ownership/expiry is rechecked after synchronous validation, just before writing.
  Each local checkpoint has a two-second hard deadline. Recovery never reruns a
  `checking` row: it becomes `uncertain`; only untouched rows may resume. Finalized
  rows and terminal jobs cannot be blindly retried. Cancellation clears the lease.
- Sender gates remain separate live observations: selected SMTP access, DNS
  ownership, authentication (always unverified here). Rehearsal success cannot
  modify `platform_connection_checks`, create an unsubscribe token, make a
  campaign running/sent, invoke SMTP, or open any publishing gate.

## API

`/api/platform/email-pilots`, authenticated/private/no-store, same-origin mutations,
existing bounded authentication JSON parser:

- GET `?campaignId=`: latest ten scoped jobs with at most five masked rows each.
- GET `?id=`: one scoped job.
- POST `action:enqueue`: `campaignId, expectedDigest, expectedReviewId,
  idempotencyKey, acknowledged:true`.
- POST `action:run`: `id`; bounded local rehearsal, not sending.
- POST `action:cancel`: `id`; idempotent cancellation.

Technical job status uses the existing queued/running/completed/failed/cancelled
states. Recipient states are queued/checking/validated/skipped/uncertain/cancelled.
Outcome `blocked` after all validated means real sending is still blocked, not a
delivery failure or provider result. `partial`/`interrupted` preserve row evidence.

## Validation

The new suite covers approval/freshness/acknowledgement, cap/deterministic ordering,
scope/privacy/roles, idempotency, unchanged connection work, recipient validation,
suppression/allowlist edits mid-check, changed source/content/sender, revoked
initiator, concurrent workers, in-flight cancel, expired lease recovery, redacted
unknown outcomes, durable quota/expiry and file-backed restart/integrity checks.
It also covers manual runner revocation, mid-check lease expiry, trusted cleanup
of revoked legacy work, null-lease recovery, two independent SQLite writers and
a genuine schema-16-to-17 upgrade.
The aggregate platform suite passes 133 tests; 22 legacy tests pass. TypeScript
and the isolated production build pass. Real production-server HTTP checks cover
authenticated enqueue/idempotency, cron-worker processing, cancellation, ignored
client send-mode flags, cross-project denial and viewer aggregation. No real mail
or successful SMTP/DNS verification was performed.

Local pre-migration backup: `data/backups/2026-10-16T07-14-41-494Z-87c41d4d`.
The local database upgraded to schema 17 with integrity `ok` and zero foreign-key
errors. Main development server remains on 3033; production QA uses disposable
data and `.next-monolith-platform`. No deploy occurred.

Chrome checks passed using disposable data: acknowledgement disables/enables
enqueue, three-recipient processing completes, a second rehearsal cancels all
three untouched rows, and closing/reopening the review preserves both jobs.
An additional rehearsal was enqueued/processed from the mobile screen. TR/EN and
light/dark were checked with no console errors. Document width/scroll width:
desktop 1425/1425, tablet 805/805, mobile 375/375 (390px viewport). Recipient
tables scroll inside their own region. Screenshots: `screenshots/email-queue-desktop.jpg`
and `screenshots/email-queue-mobile.jpg`. These are QA data, not customer results.

Disposable visual fixture (no real SMTP/DNS credentials):

```powershell
node scripts/preview-design.cjs --product-data --segments --campaign-review --recipients --sender --pilot-queue
```

## Remaining release work

Real provider identity/authentication verification and a provider-aware delivery
adapter are NOT implemented by this rehearsal. Before a real explicitly approved
pilot, define durable per-recipient send reservation, provider idempotency and
reconciliation of ambiguous provider outcomes, real unsubscribe/header injection,
rate limits, bounce/complaint webhooks and live provider acceptance. Do not reuse
this rehearsal's `validated` state as proof of sendability or delivery. No blind
SMTP retry or environment flag may turn this rehearsal into a real transport.
