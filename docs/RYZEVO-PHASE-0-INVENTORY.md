# Ryzevo Phase 0 inventory - 2026-10-15

## Verified baseline

The platform remains a Next.js modular monolith. Baseline platform suite: 51
passing tests. Build uses `.next-monolith-platform`, separate from the running
3033 dev cache. No credentials, customer data or external provider were changed.

| Need | Existing implementation | Reuse / actual gap | Acceptance |
| --- | --- | --- | --- |
| Organization/project identity | platform repository, session, access | Reuse; do not build a second tenant system | Cross-scope and revoked membership tests |
| Project configuration | catalog, project profile/goals | Reuse; do not add sector-specific goal services | Standard project cannot enable Crewin tools |
| Credential storage | connections, AES-GCM envelopes, key backup | Reuse for product source credentials | No tokens in DTO/logs; project-bound decryption |
| Jobs and worker | platform_jobs, ConnectionJobs, platform worker | Extend existing queue for product.sync | Lease, cancellation, revision and idempotency tests |
| HTTP safety | Site Audit public-IP resolver, pinned requests, bounded reader | Reuse with HTTPS-only, no-redirect REST adapter | No private network, redirect or unbounded response |
| Campaign/content | existing scoped draft adapters | Keep unchanged; segmentation/dispatch remain later phases | Existing HTTP contract and legacy boundary tests |
| Product ingestion | No generic source/mapping/record store found | Add scoped versioned REST source and record projection | Two sector fixtures, no cross-project records |
| Events/webhooks | Crewin-specific/public delivery callbacks exist | Generic signed product event ingestion is NOT present | Separate Phase 1B; do not expose an unsigned route |
| Segmentation | Crewin-specific audiences | Generic typed segment engine remains Phase 2 | Same engine across sectors |
| Reporting | Manual standard-project metrics | Keep source attribution; automatic event metrics remain later | Do not turn imported records into invented conversions |
| Sending/billing | Standard publishing disabled, pilot quotas | Preserve gates; no payment or send enabled here | publishingEnabled remains false |

## First bounded delivery: Phase 1A

Read-only REST source setup, versioned typed mappings, bounded dry-run preview,
explicit activation/pause, resumable bounded sync in the existing queue, scoped
current-version records and operational status. Only explicitly mapped properties
are persisted. Consent remains unknown; this is not a recipient/permission import.

Product source setup is enabled only for standard projects with existing
connection-management permission. Crewin's remote adapters and tenant remain
untouched. Signed webhooks/events, continuous scheduling, generic audiences,
automated reporting and sending are not claimed as delivered by this slice.

## Phase 1A verification

Implemented and checked: 64 unit/SQLite tests, HTTP integration, TypeScript and
isolated production build pass. Chrome disposable-fixture QA covers source
samples, pause, edit/version reset, blocked activation and private-network errors,
TR/EN, desktop and mobile. No real provider/customer import or send occurred.
See [Product data operations](SAAS-PRODUCT-DATA.md) for contracts, limits and the
explicitly outstanding Phase 1B / later work.

## Phase 1B follow-up

Generic HMAC-signed product events now reuse the same source/version, credential,
record and permission boundaries. New event history/replay receipts are scoped
and bounded. The existing worker prunes payloads and expired tombstones. This
supersedes the original inventory's missing generic-webhook entry, not Crewin's
existing delivery callbacks. Segments and automatic reporting remain Phase 2+.
See [Signed product events](SAAS-PRODUCT-WEBHOOKS.md).

Verification: 74 unit/SQLite tests, 22 legacy agent tests, HTTP integration,
TypeScript and isolated production build pass. Chrome desktop/mobile checks use
disposable fixtures only; no real customer sender, send or deployment was tested.

## Phase 2 follow-up

Typed dynamic segments now reuse product source versions and existing goal/stage
definitions. Standard-project Campaigns > Audiences includes preview evidence,
immutable versions and archive/restore. Campaign drafts retain a pinned audience
reference; preview receipts are checked before a new binding. Migration 13 adds
scoped tables without replacing existing campaign or Crewin audience stores.
This supersedes the original missing generic-segment entry. Automatic conversion
metrics and dispatch remain later phases. See [Dynamic audiences](SAAS-SEGMENTS.md).
