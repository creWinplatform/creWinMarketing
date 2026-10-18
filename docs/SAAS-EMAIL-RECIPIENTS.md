# Phase 3B - recipient safety (no sending)

Phase 3C1 follow-up: [Sender and pilot safety](SAAS-EMAIL-SENDER.md) implements
explicit sender selection, DNS ownership checks and project pilot allowlisting
on this recipient engine. Sending and provider authentication remain disabled;
the delivery worker is subsequent Phase 3C2 work.

Standard projects now reuse the existing Campaign Center, source/version registry,
segment evaluator, RBAC, encrypted credential envelope and SQLite monolith for
recipient checks. This does not replace the Crewin external campaign system.
No provider send, deployment, billing or public customer signup was enabled.

## Operator flow

1. Campaigns > Recipients & consent: select a product source and explicitly map a
   declared string attribute to email. No address guessing or name/domain joins.
2. Inspect the original permission evidence outside the panel. Choose its masked
   source identity, enter the reference, original time and review note, then
   explicitly confirm the review. A webhook opt-in claim alone grants nothing.
3. Return to the saved campaign review and run preflight. It evaluates the same
   pinned segment, then reports eligible unique addresses, invalid addresses,
   unconsented/suppressed unique addresses and duplicate record count.
4. Unsubscribe/test link opens a confirmation page without modifying consent.
   Explicit confirmation adds permanent project/address and source/identity
   suppression. The test creates a link only, never an email.

Consent evidence tracking is a software control, not proof that a campaign is
lawful or that an address belongs to a particular person. The operator is
responsible for reviewing the original evidence. No permission is invented.

## Persistence and identity boundaries

Migration 15 adds source/version email mapping, append-only consent reviews,
project safety revision, project/address suppressions, persistent source/identity
opt-out tombstones and hashed unsubscribe tokens. All queries/keys/FKs are scoped.
An additive file-backed migration test checks data preservation and repeatability.

- Email normalization accepts strict ASCII addresses, lowercases case, preserves
  dots/plus tags, and never joins sources or strips aliases. This pilot does not
  accept internationalized email local parts. No delivery/existence claim is made.
- Contact identity binds source ID, schema version, mapping revision, external ID
  and normalized address using scoped HMAC with the existing private encryption
  key. A changed field/schema/address does not inherit a previous consent review.
- Consent reference/time/note use the existing project-AAD AES-GCM envelope.
  Management responses expose masked ID/address and decision state only, not raw
  proof, source identity, address, credential or token hash. Existing product-data
  screens retain their own documented access contract.
- Multiple matching source entities sharing an address count once and all must
  have current reviewed permission. Any suppressing identity suppresses the group.
  Missing/invalid addresses and unknown segment matches cannot become recipients.
- Signed webhook opt-outs are recorded transactionally with their event, including
  when no email mapping exists. A mapping backfills retained pre-feature opt-outs.
  Tombstones survive payload pruning and schema changes. Later opt-in claims cannot
  clear an opt-out. Known address suppression also covers other source identities
  in the same project. No cross-source identity is guessed when email is unknown.
- In this conservative pilot all suppressions are permanent in the UI, including
  manual blocks. There is no re-subscribe/restore route. A future explicit verified
  re-subscription policy must not erase protected opt-outs silently.
- Owner/admin `recipients.manage` is checked live for management. Removing this
  authority appends consent revocations in the existing membership transaction;
  restoring the role does not resurrect old consent. Editor can run aggregated
  campaign checks, not inspect/manage consent evidence.
- Mapping changes invalidate the campaign content digest. Mapping, consent and
  block changes invalidate the preflight through the project safety revision.
  Old counts become unavailable until preflight runs again. Content approval
  remains distinct from recipient permission and dispatch readiness.

## APIs and limits

Authenticated, same-origin, private/no-store `/api/platform/email-recipients`:

- GET `sourceId?`, `page=1`, `blockPage=1`: 20 contacts and 20 blocks per page.
- POST `action:mapping`: `sourceId, sourceVersion, field, expectedRevision`.
- POST `action:review`: `sourceId, contactKey, expectedDecisionId, decision`
  (`reviewed` or `withdrawn`), `evidenceRef, recordedAt, note, acknowledged:true`.
- POST `action:suppress`: `email, acknowledged:true` (permanent manual block).
- POST `action:test_link`: `sourceId, contactKey`; returns a relative path and
  expiry, not an email send. Treat the path as a temporary bearer credential.

Bodies are bounded at 16 KiB. Source scans fail closed above 10,000 records / 8 MB
instead of truncating an audience. Consent notes max 1,000 chars, references max
200; original consent time must be valid/past. Quotas per project/UTC day: 100
review attempts, 100 manual blocks, 20 test links. Storage: 20,000 consent reviews,
20,000 email blocks, 20,000 entity tombstones, 1,000 stored unsubscribe tokens.
No second worker was added; the existing worker prunes up to 1,000 expired tokens.
Expiry never deletes suppression. Capacity exhaustion blocks the operation rather
than silently dropping opt-outs. Monitor these pilot limits before production use.

## Public unsubscribe and Crewin compatibility

The existing `/unsubscribe` and `/api/unsubscribe` paths are reused. `rzv1_` plus
32 random bytes is the reserved Ryzevo token format. Only a SHA-256 hash is stored;
scope comes from the token row, never from a client-supplied tenant/project ID.
Unknown, malformed and case-altered `rzv` namespace tokens fail locally and are
never sent to the Crewin backend. Other legacy tokens retain their existing flow.

Ryzevo JSON `action:inspect` is read-only. JSON `action:process` confirms, or a
valid RFC 8058 form `List-Unsubscribe=One-Click` processes the query token.
GET only opens/redirects to the confirmation page. Repeats are idempotent; tokens
expire after 30 days. Pages are noindex/nofollow/no-referrer; API responses are
private/no-store. No arbitrary return URL, remote media or email in token URLs.
Malformed JSON is rejected without logging the body or token.

Configure `PLATFORM_PUBLIC_ORIGIN` to the trusted deployed HTTPS origin (for
example `https://ryzevo.com`), never from an incoming Host header. The readiness
gate stays closed if this is absent/invalid. Relative test links work locally.
Configure reverse-proxy/access/error log redaction for unsubscribe token query
strings before production. Keep the existing stable encryption key with backups;
losing/rotating it without a key-migration plan breaks identity comparisons.

## Remaining Phase 3C release gates

`sendingEnabled` remains false for every standard campaign. Next implement sender
selection/domain readiness, project-owned test allowlist and bounded idempotent
recipient dispatch using the existing queue. The worker must re-evaluate live
permission, source freshness, mapping, consent, suppressions, caps and quotas
immediately before provider submission; a preflight receipt is not authorization
to send. Add ambiguous-provider-outcome handling (no blind retry), cancellation
and per-recipient outcomes. Then fake-transport failure tests, and only afterward
an explicitly approved small real-email pilot. No existing Crewin sender is reused.

## Validation

Automated: 106 platform tests, including recipient mapping, encrypted evidence,
optimistic review races, project/role boundaries, duplicate consensus, opt-out
retention, authority revocation/restoration, token opacity/expiry/replay, scoped
suppression, changed-preflight counts and additive migration. Actual temporary
HTTP server verifies login/origin isolation, evidence review, aggregate preflight,
anonymous inspect, RFC one-click, malformed namespace and disabled launch.
The 22 existing Crewin agent regression tests pass. TypeScript and isolated
production build pass; existing multiple-lockfile warning remains.

Visual fixture (temporary database, no real mail):

```powershell
node scripts/preview-design.cjs --product-data --product-webhooks --segments --campaign-review --recipients
```

Chrome: mapping, 22-record pagination, evidence review, 21 segment matches -> 1
eligible recipient, unsubscribe confirmation, stale preflight, recompute -> 0
eligible / 1 suppressed. Desktop, tablet/mobile and TR/EN checks are recorded
with screenshots under `docs/screenshots/`.

Final visual checks on 2026-10-15: desktop 1440x1000 -> 1425/1425 document
scroll/client width, tablet 820x1180 -> 805/805, mobile 390x844 -> 375/375.
The horizontally scrollable table does not enlarge the document. A screen-reader
header causing overflow was fixed. Mobile evidence form fits at 339px; successful
save feedback scrolls into view (95px top). TR/EN and light/dark were inspected,
with no console errors. Reopening a used unsubscribe link remains successful.
Proof: `screenshots/recipient-safety-desktop.jpg`,
`screenshots/recipient-safety-mobile.jpg`, `screenshots/recipient-evidence-mobile.jpg`.

Local DB backup before migration: `data/backups/2026-10-15T20-19-29-254Z-d9a15c1c`.
Migration 15 applied locally; integrity `ok`, zero foreign-key violations. Dev
server restarted on 3033; disposable QA server stopped. No deployment or real send.
