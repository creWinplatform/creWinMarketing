# Signed product events - Phase 1B

This extends the existing modular monolith, connection envelopes, source/version
tables, typed record projections, permissions, quotas, audit and private worker.
There is no second tenant system, entity store or queue. Only standard projects
with `connections.manage` can configure a source. Crewin endpoints are unchanged.

## Setup

Project Settings > Product data > Signed webhook:

1. Define entity type, accepted event names and typed attribute keys.
2. Enter a cryptographically random 32-byte signing key as 64 lowercase hex
   characters. Generate and retain it in the sender's secret manager. Ryzevo
   encrypts it in the existing connection envelope and never returns it in a DTO.
3. Save the source and validate a sample payload. Preview writes no event or
   entity and is not proof that a real sender has delivered a signed request.
4. Explicitly activate the source after preview. A preview expires after one hour
   and is bound to source version and credential revision.
5. Configure the sender with the exact source ID and endpoint shown in the panel.
   The deployment must have public HTTPS for an external sender; localhost QA
   does not configure or prove any customer/provider integration.

The current contract is fixed and versioned. The customer's server maps its own
fields into this envelope; Ryzevo does not execute arbitrary mapping code.
Every configured attribute is required in each event; undeclared attributes are
rejected. Dates require ISO 8601 with timezone and a valid calendar date.

```json
{
  "sourceVersion": 1,
  "events": [{
    "id": "product-event-001",
    "entityId": "customer-001",
    "eventName": "profile.updated",
    "occurredAt": "2026-10-15T10:00:00Z",
    "attributes": { "progress": 25 }
  }]
}
```

`entityId` is a stable external identifier, not necessarily an email. Scope comes
from the server-resolved source, never organization/project fields in the body.
REST and webhook projections share storage but remain source-scoped. This phase
does not automatically merge identities across sources or count global users.

## Signature contract

POST `/api/platform/product-events/{sourceId}` without a login cookie or Origin
header. Browser-origin requests are rejected. Content-Type: `application/json`.

- `X-Ryzevo-Timestamp`: current Unix seconds (10 decimal digits).
- `X-Ryzevo-Signature`: `v1=` plus lowercase hex HMAC-SHA256.
- Signed bytes: UTF-8 `timestamp + "." + sourceId + "."`, then the exact raw
  request body bytes. Decode the 64-character signing key from hex before HMAC.
- Timestamp skew is bounded to 300 seconds. Signature comparison is constant-time.
- Do not reformat/re-serialize the JSON after calculating the signature.

Node sender example (runs in the customer's server, never browser JavaScript):

```js
import { createHmac } from 'node:crypto';
const sourceId = process.env.RYZEVO_PRODUCT_SOURCE_ID;
const key = process.env.RYZEVO_PRODUCT_SIGNING_KEY;
const origin = process.env.RYZEVO_ORIGIN;
if (!/^[a-f0-9]{32}$/.test(sourceId || '') || !/^[a-f0-9]{64}$/.test(key || ''))
  throw new Error('Configure source and signing key in the secret manager.');
const body = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', Buffer.from(key, 'hex'))
  .update(`${timestamp}.${sourceId}.`).update(body, 'utf8').digest('hex');
const response = await fetch(`${origin}/api/platform/product-events/${sourceId}`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
  headers: {
    'Content-Type': 'application/json',
    'X-Ryzevo-Timestamp': timestamp,
    'X-Ryzevo-Signature': `v1=${signature}`,
  }, body,
});
```

## Delivery, replay and lifecycle

- Acknowledgement: `{ accepted, duplicates, recordsUpdated, receivedAt }`.
  These are ingestion counts, not campaign conversions or delivered messages.
- Source + event ID identifies one event across source versions. Identical
  retries acknowledge without new rows, usage, projection updates or audit counts.
  Reusing an event ID with different normalized content returns 409.
- Event receipt, history, usage and record projection commit in one SQLite
  transaction. A bad/conflicting event rejects the whole batch; there is no
  ambiguous partial success. Keep event IDs stable when retrying a timed-out POST.
- On retry, generate a new signature/timestamp over the same event payload.
  Back off on 429/temporary network or 5xx errors. Do not blindly retry schema,
  inactive-source, changed-version or event-ID-conflict errors.
- Occurrence and receipt times are distinct. Events up to 30 days old are allowed;
  more than five minutes into the future are rejected. Late events remain history
  but cannot overwrite newer entity snapshots. Same-time conflicting snapshots
  fail, including during dry-run. No timezone-naive date conversion is performed.
- Changing configuration/key creates a version, stops ingestion and invalidates
  preview. Pause blocks new deliveries. Revoke clears credentials and retains
  history subject to retention. A revoked manager's membership also blocks future
  deliveries; a current manager must preview/activate as needed.
- Rotation is fail-closed with one active key, not a dual-key grace period. Pause
  the sender, save the new key/schema, preview, activate, update sender version/key
  and resume. Old keys cannot authenticate new requests.

## Communication permission evidence

An optional `consent` member records a sender's claim:

```json
{
  "channel": "email",
  "status": "opted_out",
  "evidenceRef": "consent-record-001",
  "recordedAt": "2026-10-15T10:00:00Z"
}
```

Use an opaque evidence reference, not email, free text or a secret. Timestamp must
be at or before the event and at most 30 days earlier. The UI reports only claim
status, not the evidence reference. Absence is unknown, not opt-in. This is NOT
verified marketing permission, an unsubscribe/suppression service or legal proof.
Consent resolution and durable suppression remain dispatch-phase gates. Neither
reported opt-in nor imported event data enables sending or automatic campaigns.

## Limits, retention and deployment

- Shared REST/webhook source ceiling: 5 per project, including retired sources;
  25 versions/source and 12 typed attributes. Up to 20 accepted event names.
- 64 KiB raw body, 5-second read deadline, 20 events/request.
- 120 attempts/minute per known source, including failed signature attempts;
  1,000 newly accepted events/project/UTC day. Identical retries do not use the
  event quota. Use reverse-proxy global/IP/concurrency limits in production too;
  application source limits are not a full DDoS/WAF solution.
- 10,000 retained events/project, 100,000 receipt tombstones/project. The existing
  10,000 product-record cap includes all source versions, REST and webhook.
- Payloads (including reported consent) and webhook projections retain for 30
  days from receipt/update; reads hide expired payloads immediately. Idempotency
  tombstones (ID/digest, no attributes) retain for 90 days, then expire.
- Existing private `/api/platform/worker` prunes up to 1,000 rows/table per run.
  Keep `worker:platform` supervised with its existing `CRON_SECRET` and trusted
  `PLATFORM_WORKER_ORIGIN`; cleanup is not an anonymous endpoint. No worker was
  enabled against real customer data during QA. If it is off, physical cleanup
  waits and storage caps fail closed. Monitor capacity/lag. Backups require their
  own deletion/retention policy; database pruning does not rewrite old backups.
- SQLite remains a single-host pilot. TLS/reverse proxy, persistent disk, stable
  secrets, backups, monitoring and real-sender acceptance are deployment gates.

## Management API

`GET /api/platform/product-webhooks?sourceId=...&page=1` lists source DTOs and a
20-row paginated history for the selected source. IDs are masked in event samples.
`POST` uses the existing authenticated, same-origin, bounded JSON interface:

- `save`: name, config, secret?, id?, version?.
- `preview`: id, payload (no ingestion).
- `activate`, `pause`, `revoke`: id, version.

No credentials are returned, no arbitrary URL is fetched, and no endpoint can
fall back to Crewin credentials. Migration 12 is additive and preserves Phase 1A
REST versions, encrypted connections, queues and records.

## Verification

Test commands: `npm run test:platform`, `npx tsc --noEmit`, isolated production
`npm run build`, `npm run test:platform:http`. The HTTP tests use a temporary
database and actual localhost requests/signatures, not a public auth bypass.
`node scripts/preview-design.cjs --product-data --product-webhooks` provides
disposable visual fixtures. No real messages, provider data or payments are used.

Verified on 2026-10-15:

- 74 unit/SQLite tests and 22 existing Crewin agent regression tests pass.
- TypeScript, isolated production build and real localhost HTTP integration pass.
  HTTP checks cover missing/wrong signature, source/version scope, duplicate/conflict,
  size bounds, browser-origin denial, pause/revoke and exact public-route matching.
- Chrome disposable-fixture checks cover TR/EN, normal login, retained events,
  masked IDs and reported opt-out, pause/reactivation, invalid/valid dry-run,
  edit/version reset and collapsed sample-payload controls.
- Desktop 1440x1000 and mobile 390x844 were inspected. Mobile document scroll
  width matched its 375px client width; tables scroll within their own region.
  No console errors were recorded. Preview did not increment the two fixture events.
- The existing multiple-lockfile workspace-root warning remains; no dependency
  upgrade or lockfile churn was introduced by this phase.
- Screenshots: `docs/screenshots/product-webhook-desktop.jpg` and
  `docs/screenshots/product-webhook-mobile.jpg`. QA server was stopped; the real
  dev app remains at port 3033. No deploy or real customer sender test occurred.

Phase 2 follow-up: [Dynamic audiences](SAAS-SEGMENTS.md) now adds typed rules,
existing goal/stage bindings and campaign draft references. Each definition uses
one source/version; no cross-source identity inference. Automatic metrics,
campaign approval/dispatch, billing and public signup remain future gates.

## Optional `attribution` field (30 October 2026)

An event may carry `attribution: {campaign, source?, medium?, touchedAt?}`: the first tagged link its person arrived through (the snippet keeps it in the site's `ryz_touch` cookie).
- A malformed value is dropped and counted in the response (`attribution.ignored`); the event is still accepted.
- Events without the field keep their previous digest, so earlier retries stay duplicates.
- Accepted events also write a pseudonymous trail used by first-touch attribution. See `SAAS-ATTRIBUTION.md`.
