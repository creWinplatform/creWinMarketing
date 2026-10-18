# Customer social publication pilot

## Delivered boundary

The existing modular monolith now supports LinkedIn **personal-account text
posts** and Facebook **Page text posts**, using its encrypted project connection registry, saved content/campaigns,
permissions, audit log and private `platform_jobs` worker. No legacy Crewin social
token file, global posting adapter, campaign launch or ABP service is reused.

Calendar has two views: existing work plans and social publications. A work plan
is still not a dispatch. The publication queue holds scheduled times and receipts;
it does not duplicate those rows into the manual task table. Email approvals and
jobs are not implicitly started by a social publication.

Facebook setup and grant checks are documented in SAAS-FACEBOOK-PUBLISHING.md.
Instagram single-image publishing is documented in SAAS-INSTAGRAM-PUBLISHING.md.
X text publishing is documented in SAAS-X-PUBLISHING.md.
LinkedIn company-page consent and author selection are documented in SAAS-LINKEDIN-COMPANIES.md.
The provider-specific flow below describes LinkedIn; shared queue controls apply
to all four. Other media formats and provider
engagement analytics are NOT delivered by this pilot. Their existing account
connections remain intact and are not advertised as publishable. No reach,
impressions, clicks or causal conversion metrics are fabricated.

## Operator setup

Use the existing separate SaaS LinkedIn app and exact callback. Enable its
appropriate Sign In/OpenID and Share on LinkedIn products/access. Keep private
settings server-side, never in chat or NEXT_PUBLIC values:

```dotenv
PLATFORM_LINKEDIN_CLIENT_ID=YOUR_APP_ID
PLATFORM_LINKEDIN_CLIENT_SECRET=YOUR_APP_SECRET
PLATFORM_LINKEDIN_REDIRECT_URI=http://localhost:3033/api/platform/social/callback
PLATFORM_LINKEDIN_API_VERSION=YOUR_ENABLED_YYYYMM_VERSION
PLATFORM_SOCIAL_PUBLISH_ENABLED=0
```

The version must be a currently supported version enabled for this app; no version
is guessed or downgraded automatically. The server flag defaults OFF. Do not
enable it until app access, current customer consent and an authorized live pilot
are ready. Production requires HTTPS and a durable single-host database/worker.

In Project Settings > Connect LinkedIn, the new publishing checkbox is OFF by
default. Only choosing it requests `w_member_social` in addition to openid/profile.
Existing read-only grants are NOT expanded automatically. The user personally
approves the provider consent. Reconnect for changed scopes or token expiry;
automatic refresh is not claimed. A manual token must belong to the configured
SaaS app, the exact selected member and an authorized 3-legged grant.

## Customer flow

1. Create or edit a LinkedIn text in the EXISTING content library, or include
   LinkedIn in an existing campaign draft. Per-platform text is used when present;
   the saved CTA is appended once and is visible in the exact preview.
2. Open Calendar > Social publications, choose the saved source and account.
   The selector explicitly lists only the latest 50 applicable sources. Image/HTML
   content, unresolved variables, control characters and text outside 1-3000
   UTF-16 code units are blocked, not silently stripped.
3. Run a rehearsal, now or scheduled. It validates local authority/content only;
   it neither calls a publishing endpoint nor proves provider write permission.
4. For a live post, Check publishing access performs official token introspection
   and exact UserInfo account matching. App ID, member grant, scope and expiry must
   match. Evidence is bound to encrypted credentials, server configuration and live
   manager permissions; it expires after at most five minutes.
5. Select live mode, inspect exact content/account/time and explicitly approve
   PUBLIC publication. The saved source and opaque target revision must still
   match. Source/account/schedule changes invalidate the UI acknowledgement.
6. The EXISTING private worker processes due jobs; saving does not install a cron.
   `npm run worker:platform` uses the existing CRON_SECRET. Manual Process due job
   uses the same service, not another posting path. Both recheck permissions,
   credentials, source digest, server gate and current provider grant before POST.
7. Inspect the provider receipt or controlled failure. A valid HTTP 201 and
   x-restli-id records Provider accepted and a LinkedIn permalink. It is not an
   independently read-back post or proof of reach. No r_member_social is requested.

## Scheduling and cancellation

Timestamps are persisted as UTC instants. Date entry explicitly uses the DEVICE
timezone, with a preview in the project timezone. The source project's current
timezone is stored on the immutable job. Choose now or the next 30 days; known
token expiry before the scheduled time blocks live enqueue. The worker does not
claim future jobs. More than 24 hours overdue is blocked rather than surprise-posted.

Content, brand/project profile or account changes block unsent jobs. Losing the
approving member's required permissions permanently settles unsent jobs and clears
their readiness evidence. Restoring the role does not revive approval.

Cancellation before the durable submission reservation prevents POST. After
submission starts, cancellation is a request only: it is NOT described as unsent
and does not delete/retract the provider post. Late valid acceptance can still be
recorded. Deleting provider content is not implemented.

Every publish reserves a durable attempt BEFORE HTTP POST. Expired leases after
reservation and ambiguous network/5xx/malformed-success responses become uncertain,
with NO automatic retry or second live enqueue of the same text/account. Check
the relevant social account manually before deciding on a new, independently reviewed publication.
This is at-most-once automatic submission, not guaranteed exactly-once delivery.

## API, storage and limits

- `/api/platform/publications` GET: scoped paged jobs (20/page), optional `id`.
  Read-only users see project history, but cannot select connections or approve.
- POST `check`: connectionId. Owner/admin only. No caller-supplied proof is trusted.
- POST `enqueue`: sourceKind, sourceId, connectionId, expectedDigest,
  expectedTargetRevision, mode (rehearsal/publish), optional scheduledAt,
  idempotencyKey, and acknowledged=true for live PUBLIC publication.
  Text, target identity, scope, timezone and provider receipt are server-derived.
- POST `run` or `cancel`: id. Same-origin, bounded JSON and verified project session
  required. Legacy automation endpoints cannot run these jobs.

Migration 20 is additive: scoped permission evidence and publication queue details
with scoped foreign keys to EXISTING connections/jobs. Snapshots are encrypted with
the existing project-bound envelope. No old content, email or measurement record
is rewritten. Back up SQLite plus the existing credential key before upgrading.

Pilot bounds: 500 retained jobs/project, 20 new enqueue intents/project/UTC day,
100 explicit access checks/project/day, 5 durable live submissions/project/day.
Idempotent replay does not consume another quota. One lease has one POST attempt;
up to three claims are allowed only while nothing was submitted. Broad retention,
media and billing policies remain launch work. Receipts/errors expose no tokens,
secrets or raw provider errors. Provider requests use fixed official HTTPS hosts,
bounded responses/time and no redirects. Concurrent readiness checks are fenced.

## Verification boundary

Automated provider responses and disposable visual fixtures are not live LinkedIn
acceptance. Do not mark this channel production-verified until a real operator
performs consent, permission check and one expressly authorized public post.
No live post, grant expansion, worker activation or deployment is performed by
implementing this code.

Verification on 2026-10-16:

- 205 platform tests pass, including 19 original publication and 11 Facebook tests. Provider replies are
  mocked; account/source changes, scope denial, quotas, cancellation, lost replies,
  stale leases, role restoration, exact approvals and schema19 upgrade are covered.
- The production HTTP suite passes, including anonymous/legacy/cross-project
  denial, server-derived content, rehearsal, future-job exclusion and cancellation.
- `npx tsc --noEmit`, isolated production `npm run build` and 22 legacy Crewin
  agent tests pass. Existing lockfile-root and future Node/AWS SDK warnings remain.
- Chrome disposable-fixture QA passes: source/account preview, local rehearsal,
  scheduled time persistence, desktop/mobile cancellation and keyboard tab switching.
  Native date autofill and stable accessible naming were verified in the final build.
  Desktop 1440px, tablet 768px and mobile 390px have no horizontal overflow.
  TR/EN and light/dark checked; no console errors. Test server stopped afterwards.
- Example-only evidence: [desktop](screenshots/social-publications-desktop.jpg),
  [mobile](screenshots/social-publications-mobile.jpg),
  [mobile cancellation](screenshots/social-publications-mobile-result.jpg).
- Main local DB was backed up before migration to
  `data/backups/2026-10-16T15-44-13-227Z-2af9fd5d`. Migration20 integrity is ok,
  with zero foreign-key errors and zero real publication records.
- Main dev panel remains on port3033, with email and social live-send gates OFF.
  No real provider consent/check/post, running system worker or deploy occurred.

Primary references: [Token introspection](https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection),
[Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api),
[Plain-text escaping](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format).
