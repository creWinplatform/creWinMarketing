# Product data sources - Phase 1A

Implemented on 2026-10-15 in the existing Next.js modular monolith. This is a
read-only REST connector, not a campaign audience, event pipeline or consent
system. Crewin's existing adapters, tenant and publishing flows are unchanged.

## Operator flow

In a standard project, open Project Settings > Product data. Existing
`connections.manage` permission is required. The section is not exposed to the
legacy Crewin product pack.

1. Add a source: name, entity type, public HTTPS URL and optional Bearer token.
2. Map the records array, stable record ID, source update time and typed fields.
3. Save. Saving never starts ingestion. A new mapping creates a new version.
4. Preview. This reads the first page, validates types and shows up to five
   masked-ID samples. It does not write product records.
5. Activate explicitly after a successful, nonempty, error-free preview. The
   preview receipt expires after one hour and is bound to the exact source
   version and encrypted credential revision.
6. Sync. The existing queue handles the job; browser execution or the existing
   private platform worker can run it. Job status is polled every 2.5 seconds.
7. Use Continue sync when a cursor remains. Each job reads at most three pages;
   further batches are not silently enqueued. Pause cancels pending/running jobs.

Editing pauses ingestion and invalidates the preview and checkpoint. Historical
versions remain stored, but the UI shows only the current version's records.
There is no physical source/history deletion in this slice. The Revoke connection
icon clears credentials through the existing connection registry, cancels jobs
and retains records. Reconnecting requires saving settings and a new preview.

## Example source contract

```json
{
  "result": {
    "items": [
      { "id": "user-1", "updatedAt": "2026-10-15T10:00:00Z", "progress": 25 }
    ],
    "nextCursor": null
  }
}
```

Mapping: `itemsPath=result.items`, `idPath=id`, `updatedAtPath=updatedAt`,
attribute `progress` from `progress`, type `number`. For pagination, set
`nextCursorPath=result.nextCursor` and a cursor query parameter such as `cursor`.
The backend must return a string cursor or null. An empty items path supports a
root array. Dot paths support nested objects and numeric array indices, not
executable expressions. Missing fields and implicit type conversion are rejected.

The API URL must use HTTPS on the default port, without userinfo, an existing
query string or a fragment. The only added query parameter is the mapped cursor.
Custom headers, query API keys, POST sources, arbitrary pagination links and
private-network sources are deliberately not supported.

## Persistence and safety

- Reuses scoped sessions, RBAC, AES-GCM connection credentials, usage accounting,
  audit log, durable jobs and the existing authenticated worker. No second tenant,
  credential service or queue was introduced.
- Migration 11 adds versioned source configuration and record projections,
  encrypted checkpoints and a job discriminator. Old verification jobs retain
  their type and encrypted credentials. Migration is additive and idempotent.
- DNS resolves to public IPs only. Requests pin the resolved IP, preserve TLS
  hostname validation, reject redirects, require JSON and bound time/size.
- Only configured attributes are stored. Sensitive field/path names are rejected;
  operators must still avoid mapping personal or secret data into innocent names.
  The connector is not a general-purpose PII classifier.
- IDs are masked in public samples; tokens, full upstream payloads and cursors
  never appear in source DTOs or public error messages.
- Stable source IDs and timestamps make replays idempotent. Older records cannot
  replace newer ones. Conflicting values at the same timestamp fail the batch.
- Commit rechecks the job lease, live initiating/running permissions, active
  connection, mapping revision and checkpoint. Cancellation, revocation or an
  edit during a request prevents the import from committing.
- Record updates and cursor advancement commit atomically. Failed batches can
  retry without advancing the checkpoint or partially storing records.
- Communication consent remains `unknown`. Imported records do not enable
  sending, automatic campaigns, conversion metrics or subscription entitlements.

## Pilot limits

| Boundary | Limit |
| --- | --- |
| Sources per project, including retired sources | 5 |
| Mapping versions per source | 25 |
| Mapped attributes per version | 12 |
| JSON response size per page | 512 KiB |
| Records per page / pages per job | 200 / 3 |
| Stored records per project, including old versions | 10,000 |
| Preview attempts per UTC day | 50 |
| New sync jobs per UTC day | 100 |
| Cursor history per traversal | 100 |

## HTTP interface

`GET /api/platform/data-sources?sourceId=...` returns scoped sources, sync jobs and
up to ten current-version record samples for the selected source.

`POST /api/platform/data-sources` accepts `action`:

- `save`: `id?`, `version?`, `name`, `config`, `token?`.
- `preview`: `id`.
- `activate` / `pause`: `id`, `version`.
- `revoke`: `id`, `version`; clears credentials, retains records.
- `sync`: source `id`, `idempotencyKey`.
- `run` / `cancel`: job `id` (product sync jobs only).

The existing session determines organization/project; client-supplied scope is
not trusted. Writes require same-origin requests. No unsigned public endpoint
or browser-side token bridge was added.

## Verification and remaining work

- 64 unit/SQLite tests pass, including two-sector isolation, encrypted secrets,
  dry-run, versioning, quotas, cursor resume, rollback, late data, cancellation,
  stale lease recovery and migration compatibility.
- HTTP integration passes: anonymous 401, Crewin denial, cross-project denial,
  spoofed client scope ignored, private-IP preview rejection, generic-route
  mutation denial, scoped credential revocation and cross-origin rejection.
- 22 existing Crewin agent contract/regression tests also pass.
- TypeScript and isolated production build pass.
- Chrome QA used a disposable SQLite fixture at port 31450: normal login,
  imported samples, pause, edit/version reset, blocked activation before preview,
  private-network error, TR/EN, light/dark, desktop and 390px mobile. No console
  errors or document-level horizontal overflow were found.
- No real customer/provider import, email, social post, payment or deploy occurred.

Phase 1B is now implemented: [Signed product events](SAAS-PRODUCT-WEBHOOKS.md)
adds replay protection, event schema/version policy, reported consent evidence
and retention using the same source/record storage. Generic segments,
automatic measurements and controlled dispatch are later phases, not delivered
by this connector. Full SaaS readiness is not claimed.
