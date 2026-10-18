# Dynamic audiences - Phase 2

Implemented in the existing Next.js monolith on 2026-10-15. This extends the
scoped product sources, campaign drafts, project goals and RBAC. It does not
introduce a second tenant, goal, campaign or queue system. Crewin's existing
audience adapters and external ABP contracts are unchanged.

## User flow

Standard project: Campaigns > Audiences > New audience. Select a versioned product
source, optional existing goal/stage and maximum source age. Build typed AND/OR
rules, preview and save. Edits append immutable versions. Archive/restore keeps
versions and existing campaign references intact.

In a campaign draft, select an audience version and preview it before saving a
new/changed binding. An existing binding remains pinned when content is edited;
later audience edits never silently move that campaign to the latest rule.

## API and authorization

`/api/platform/segments`, authenticated session scope only, private/no-store:

- GET: project audience summaries, existing goals, timezone and writable source
  schemas. Source URLs, credentials and encryption envelopes are not returned.
- GET `?id=SEGMENT_ID`: scoped immutable version history.
- POST `action: save`, `name`, `definition`, optional `id` and current `version`.
- POST `action: preview`, either saved `id`/`version` or unsaved `definition`.
- POST `action: archive` or `restore`, `id`, current `version`.

Writes require same origin and existing `content.write`. Saved preview counts
require `read`; samples and unsaved definitions require `content.write`.
Crewin accounts cannot use the standard-project segment API. Cross-project
source/version references are denied in queries and composite foreign keys.

Example definition (replace the source identity with the project's source):

```json
{
  "sourceId": "32-character-source-id",
  "sourceVersion": 1,
  "maxAgeHours": 24,
  "goalId": "activation",
  "stageIndex": 0,
  "rules": {
    "kind": "group",
    "op": "and",
    "children": [
      {"kind": "attribute", "field": "completion", "op": "lt", "value": 50},
      {"kind": "event", "eventName": "lesson.started", "op": "absent", "days": 7}
    ]
  }
}
```

Attribute operators: eq, neq, gt, gte, lt, lte, in, empty, not_empty. Numeric
comparisons require a number schema; lists and scalars match their declared
type without coercion. Missing values do not satisfy neq. Empty means missing,
null or blank text; wrong-type values remain unknown. Unknown operators/fields
are rejected, never ignored. There is no custom SQL, JavaScript or eval.

Webhook sources additionally support event exists/absent and activity
within/not_within. Activity means accepted configured product events, not website
visits or assumed user engagement. REST snapshots do not prove event absence.

## Evidence and correctness boundaries

- Each definition uses ONE source/version. Equal external IDs in different
  sources are not joined. Counts are observed source entities, not globally
  deduplicated users or the whole upstream population.
- Active current-version source, no pending REST cursor, and last successful
  ingestion within maxAgeHours are required. Stale, partial, paused or changed
  sources fail with 409, not an invented zero population. Source update time is
  not a guarantee that every entity's upstream attributes are current.
- Results are true/false/unknown. AND and OR propagate uncertainty; only true
  enters matched. Unknown/excluded/total are separate actual counts.
- Positive event evidence uses occurredAt. Absent events remain unknown until
  the source's continuous locally enabled observation interval covers the full
  requested window. This is NOT proof that upstream sent every event. Pause,
  revoke, schema/key rotation or delegated operator authority loss resets that
  interval. Role restoration alone never re-enables delivery.
- Migration 13 starts existing active webhook coverage at migration time, never
  backdates it from historical events. Existing records/jobs are retained.
- Windows are rolling UTC 24-hour durations, inclusive at the cutoff; project
  timezone is used for display. Future events do not satisfy a window. Event
  retention remains 30 days, and only current-version observations are used.
- Existing goal/stage content is fingerprinted. Deletion/reordering/replacement
  invalidates the definition until explicitly re-saved; no second goal registry.
- Preview shows computed time, source provenance, at most five matched samples
  with masked IDs and rule evidence. Samples are not saved as a recipient list.
  Persisted receipts contain only hashes, counts and computation time.
- New campaign binding requires a preview from the last 15 minutes with the
  same rule and data revision, recomputed with this same engine. Changes to
  membership caused by a rolling window also invalidate a stale receipt.

Campaign POST/PATCH accepts `segmentId` and `segmentVersion`; server creates
`segmentBinding` with rule digest/source version/goal/stage. Client-supplied
binding objects are not trusted. Existing bindings can be retained while editing
content, even if archived/stale. This is not dispatch permission: a future sender
must re-evaluate freshness, permissions, consent and suppression before sending.

## Pilot limits

100 audiences/project including archived, 25 immutable versions/audience,
20 leaf conditions, root plus two nested group levels, 10 children/group,
20 values/list. Preview: 200 attempts/project/UTC day, including failed attempts;
maximum 10,000 records/events and 8 MiB aggregate attribute payload per evaluation.
Excess fails explicitly rather than silently truncating a population. Request
body is bounded at 16 KiB. Maximum source age is 1-720 hours; event windows 1-30 days.

## Verification and next gate

`npm run test:platform` includes three sector configurations on the same engine,
strict types/empty values, DST/cutoff boundaries, unknown event history, stale and
partial sources, migration 13, scoped permissions, authority loss and byte limits.
`npm run test:platform:http` exercises actual login/API calls, cross-project
denial, invalid rules, immutable campaign binding, archive/restore and pause.
Use `node scripts/preview-design.cjs --product-data --product-webhooks --segments`
for disposable Chrome QA, never the customer's database.

This phase does NOT create automatic conversion metrics, a cross-source identity
graph, sendable email lists, consent grants or publishing permission. Manual
reports stay manual. Next is Phase 3: approval, explicit recipient/consent mapping,
suppression and unsubscribe, scoped sender readiness, bounded dispatch jobs and
fake-transport tests before any explicitly approved real pilot. Public signup,
billing and unrestricted customer sending remain closed.

Verified on 2026-10-15:

- 86 platform unit/SQLite tests, 22 existing Crewin agent tests and the actual
  localhost HTTP integration scenario pass. TypeScript and isolated production
  build pass. The existing multiple-lockfile warning remains; no dependency
  changes or major upgrades were made by this phase.
- Chrome normal-login disposable fixture: nested number/boolean rules, preview,
  save, edit to v2, history, archive/restore, draft binding with preview and saved
  pinned-v2 display. No real recipient, provider write or send was used.
- Desktop 1440x1000, tablet 820x1180 and mobile 390x844 inspected. Both languages
  and themes checked. Mobile width 375/375 and tablet 805/805 (client/scroll), no
  document overflow. A 640px sample table scrolls inside its 337px mobile region.
  Deepest supported rule groups stay within the viewport. No console errors.
- Screenshots: `screenshots/segments-desktop.jpg`, `segments-mobile.jpg`,
  `segments-tablet.jpg` and `segments-campaign-binding.jpg` in this docs directory.
- Local database backed up before migration/restart. Schema 13 integrity check
  is `ok`, foreign-key error count 0. The real dev app was restarted at 3033;
  fixture server stopped and test tab closed. No deployment occurred.
