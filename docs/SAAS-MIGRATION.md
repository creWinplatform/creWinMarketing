# Modular monolith SaaS migration

Latest social-publication follow-up: migration 20 adds project-scoped LinkedIn
personal text publishing, exact approval, rehearsal, scheduling and cancellation
on the existing queue/calendar. Actual publishing defaults OFF and has not been
live-provider verified. Other social/media adapters remain pending. See
[Social publishing](SAAS-SOCIAL-PUBLISHING.md).

Latest automatic-measurement follow-up: migration 19 adds source-linked GA4,
Search Console and received product-event counts through the existing queue and
metric table, with provenance and separate manual reporting. No live provider
grant, campaign-attribution guarantee or deploy is implied. See
[Automatic measurements](SAAS-MEASUREMENTS.md).

Latest (2026-10-16), Phase 3C2b: project-bound SES checks and bounded real pilot
transport extend the existing queue. Migration 18 preserves rehearsal records.
Sending remains OFF by default; AWS/DNS/public HTTPS setup and one approved live
pilot remain release gates. See [SES delivery](SAAS-SES-DELIVERY.md) and
[remaining sequence](SAAS-NEXT-DELIVERY.md). Earlier descriptions are historical.

## Current scope and invariants

The platform identity backend runs inside the existing Next.js monolith. SQLite
stores users, organizations, projects, memberships and an audit trail with
transactions and foreign keys. Layer 1 supplies the typed project/module catalog.
New accounts are onboarded with deployment-owner-issued single-use invitations.
Team invitations, scoped campaign/content drafts, project goals, work plans,
manual measurement reports, CSV export and public-HTML audits run in this monolith.
Google, LinkedIn and Meta onboarding and SMTP/social access checks are implemented;
real provider grants still need configuration and verification. Public signup,
paid billing and customer publishing/dispatch are not enabled. Unscoped Crewin
APIs remain denied to customer accounts. See `SAAS-PILOT-READINESS.md` for the
current release boundaries, commands and operational requirements.

As of 2026-10-15, roadmap Phase 0 and Phase 1A add a generic read-only REST product
source with typed/versioned mappings, dry-run preview, explicit activation/pause,
credential revocation and bounded resumable sync in the existing queue. Migration
11 preserves existing connections/jobs. The new section is limited to standard
projects; Crewin adapters remain unchanged. Signed events/webhooks, generic
segments and automatic conversion reports are not delivered. Operational contract
and limits: [Product data sources](SAAS-PRODUCT-DATA.md).

Phase 1B follow-up: signed generic event ingestion is implemented using the same
source/version tables, encrypted connection registry and record projections.
Migration 12 adds event history, replay receipts and a live source-manager binding.
The existing private worker handles bounded retention cleanup. No generic segment,
automatic conversion report or sending capability is opened by this phase.
Contract: [Signed product events](SAAS-PRODUCT-WEBHOOKS.md).

Phase 2 follow-up: standard projects now have typed dynamic audiences in the
existing Campaigns area, existing goal/stage bindings, immutable rule versions,
masked evidence previews and pinned campaign draft references. Migration 13 is
additive. One source/version per definition; no cross-source identity inference.
Automatic conversion reporting and customer dispatch remain closed. Contract:
[Dynamic audiences](SAAS-SEGMENTS.md).

Phase 3A follow-up: saved email preview, content/audience preflight and auditable
owner/admin content decisions are implemented without enabling delivery. Existing
drafts, segment evaluator and RBAC are reused. Migration 14 preserves prior data.
Consent/email mapping, suppression/unsubscribe, sender readiness and controlled
dispatch remained subsequent work. See [Campaign review](SAAS-CAMPAIGN-REVIEW.md).

Phase 3B follow-up: explicit source/version email mapping, encrypted consent
evidence review, permanent project/address suppression, durable source-identity
opt-out tombstones and project-bound unsubscribe now feed aggregate campaign
preflight. Migration 15 is additive. Existing RBAC, segment evaluator, queue
cleanup and unsubscribe paths are reused; Crewin legacy token handling remains.
Actual sender-domain/allowlist checks and controlled idempotent dispatch remain
Phase 3C work. No customer sending is enabled. Contract:
[Recipient safety](SAAS-EMAIL-RECIPIENTS.md).

Phase 3C1 follow-up: selected project SMTP sender, exact DNS TXT ownership proof,
masked project pilot allowlist and 1-5 recipient caps now feed campaign preflight.
Migration 16 preserves the existing registry/queue and revokes stale manager
grants. DNS ownership is separate from SPF/DKIM/provider authentication, which
is still unverified; real customer delivery remains closed. The next slice,
Phase 3C2, is the controlled existing-queue delivery worker and provider gates.
Contract: [Sender and pilot safety](SAAS-EMAIL-SENDER.md).

Phase 3C2a follow-up (2026-10-16): persisted pilot rehearsal now reuses the existing
job queue and shared recipient evaluator, with encrypted immutable snapshots,
bounded deterministic recipients, cancellation, lease fencing and conservative
interruption recovery. It is a no-send rehearsal, not a delivery worker release.
Migration 17 is additive. Provider authentication and real transport remain
closed subsequent work. Contract: [Pilot queue rehearsal](SAAS-EMAIL-QUEUE.md).

Existing services are reused: MarketingCampaign, MarketingContentHistory,
MarketingCalendar, MarketingActivity, MarketingAsset, MarketingProspect,
GrowthAnalytics, SiteSeo and SiteSeoAction. No replacement backend is introduced.

The SaaS organization ID, project ID and external ABP tenant ID are distinct.
Crewin's external tenant configuration stays in its server-side connector.

## Delivery order

| Layer | Scope | Acceptance gate | Status |
| --- | --- | --- | --- |
| 1 | Project profile, module catalog, Crewin product pack, authenticated workspace read endpoint | Catalog/scope unit tests, TypeScript, build; authenticated UI review | Implemented; catalog and authenticated isolated UI checks pass |
| 2 | Persistent organizations, projects, memberships, roles, session scope and data isolation | Cross-organization identity isolation; legacy marketing remains blocked for new accounts | Local identity backend implemented and tested; marketing data/connector migration remains |
| 3 | Project brand, goals, metric definitions and server-side connections | Connector credentials and callbacks scoped and tested per project | Profiles, goals, drafts, encrypted registry, Google OAuth/refresh and SMTP access checks implemented; live provider approval, social adapters, sending and metric ingestion pending |
| 4 | Onboarding and configurable workflows | Independent non-maritime product setup; only connected capabilities enabled | Invitation onboarding, brand/goals, content drafts, work plans and manual reporting implemented; automatic publishing/approval orchestration remains |
| 5 | Shared shell and component system across all modules | Desktop/mobile, accessibility and existing workflow regression checks | Grouped sidebar, mobile drawer, query navigation, settings sections, public landing and shared visual system implemented |
| 6 | Persistent queue, quotas, usage metering and subscription lifecycle | Idempotent jobs, bounded usage, billing reconciliation | Connection verification worker, pilot quotas, usage counters and online backup implemented; subscription/payment reconciliation is not implemented |
| 7 | Pilot with a second business | Full onboarding, campaign approval, reporting and export verified | Isolated second-product fixture validated; real business/provider/publishing pilot remains a release gate |

## Layer 1 ownership

- `crewinjob-web/lib/platform/catalog.ts`: public project/module definitions.
- `crewinjob-web/lib/platform/workspace-server.ts`: authorized legacy context.
- `crewinjob-web/app/api/workspace/route.ts`: authenticated, read-only profile.
- `crewinjob-web/components/platform/ProjectSettings.tsx`: read-only goals/tools.
- Existing Home consumes the catalog for both mobile and desktop navigation.

Module scope describes intended product availability. Shared modules still have
Crewin-specific adapters, prompts and defaults that must be extracted in layer 3.
Catalog filtering is never a substitute for backend authorization.

## Layer 2 implementation boundaries

Platform identity belongs to the local monolith. The external ABP backend is a
Crewin product connector, not the SaaS account system. Existing marketing/SEO
services stay in use for the legacy Crewin account. Migrate shared marketing
storage and integrations incrementally before enabling them for new customers.

Resolve organization/project from a verified session and server-side membership.
Never accept an arbitrary request header as authority. Persist scope on business
records, queries, foreign keys, uniqueness constraints, files, automation jobs,
OAuth state, rate limits, token caches and idempotency keys.

Global state discovered during inspection:
- `lib/auth.ts`: deployment administrator, signed username session.
- Agent `modules/api.js`: process-level backend token/data caches.
- `lib/gsc.ts`: environment-level Google property/credential configuration.
- Local/browser history, campaign and scheduler persistence: audit every store.
- OAuth callbacks, public tracking and cron requests: resolve scope from signed
  state or persisted job/connection identities; do not default to Crewin.

Public paths and existing auth checks must retain their current behavior during
legacy migration. Inventory each background entry point separately.

## Crewin compatibility

Preserve the full Crewin catalog and current tab IDs. Keep seafarer activation,
retention, bots, KPI, credit/orders and CV unlock workflows in the Crewin pack.
Reuse the existing Marketing services for other product packs through adapters.
Do not publish changes to crewinjob.com or alter its business API contracts.

## Validation

Run catalog/scope boundary tests, TypeScript, isolated production build and
desktop/mobile checks. After layer 2, require cross-tenant integration tests
before exposing customer signup or workspace switching.

Layer 1 checks: five catalog/scope tests passed, `npx tsc --noEmit` passed,
isolated `npm run build` passed. An anonymous request to `/api/workspace`
returned HTTP 401. Chrome opened localhost:3033 and redirected to login;
authenticated desktop/mobile review has not been performed yet.

## Historical external-backend plan (superseded)

First provide an inventory of the existing identity, tenant, role and organization
APIs and their DTOs. Do not implement a parallel account system if these already
exist. The platform needs the following behaviors, without prescribing duplicate
endpoint names:

1. Verified current identity with organization memberships and role grants.
2. Accessible organizations/projects with stable IDs and enabled module settings.
3. Server-authorized active project resolution, verified on every operation.
4. Persisted organization/project ownership on all marketing entities, jobs,
   integrations and assets. Migrate existing Crewin data to its legacy scope.
5. Scope-aware query, write and relationship checks, including lookups by ID.
6. Existing service tokens separated from platform user sessions; external ABP
   tenant values belong to connection configuration, not UI-supplied authority.
7. Tests covering denied cross-organization reads/writes, revoked membership,
   expired sessions, background processing and OAuth/public callback resolution.

Document request methods, permissions, example wrapped responses, migration order
and rollback. Preserve current Crewin service contracts and production workflows.
Customer signup stays closed until this contract and isolation tests are ready.

## Layer 2A implementation (historical)

Sessions now issue a signed v2 payload with subject, expiry, organization and
project. Existing legacy cookies still verify and migrate on sliding refresh.
Unknown workspace scopes, malformed signatures and invalid/expired timestamps
are rejected. Internal scheduler actors retain the existing short-lived flow.

`lib/platform/access.ts` defines membership permission checks with subject,
organization, project, active membership and role requirements. Current workspace
access maps only the configured administrator to Crewin owner. This is a legacy
compatibility adapter, not a persistent membership system or full API RBAC rollout.
No second account can be provisioned through it.

Eleven scope/catalog/session tests, TypeScript and isolated production build passed. Database isolation,
worker scope, entity ownership and cross-tenant API tests remain layer 2B work.
The forwarding prompt is retained as history and superseded by the local monolith.

## Local backend implementation

- `lib/platform/database.ts`: versioned idempotent schema, SQLite WAL, foreign keys,
  busy timeout. Default file `data/platform.sqlite`; override with
  `PLATFORM_DATABASE_PATH`. Use a durable disk volume on one application host.
  Multi-host deployment needs a shared transactional database adapter.
- `lib/platform/repository.ts`: legacy Crewin bootstrap, scrypt password hashes,
  scoped memberships, transactional provisioning, role updates, audit events and
  protection against removing the last owner.
- `lib/platform/workspace-server.ts`: live database authorization on each platform
  request. Session signatures alone do not grant membership access.
- V3 signed sessions carry platform user/project IDs; legacy cookies and internal
  Crewin runners preserve their existing flow.
- Middleware denies platform-account access to legacy marketing APIs. Legacy
  publishing/OAuth session helpers also reject platform sessions.
- Home verifies workspace before loading tools or stats. The Crewin GA4 tag is
  loaded only in the legacy Crewin workspace, not for other customer accounts.

Local routes (same Next.js application, no separate API process):

| Route | Method | Behavior |
| --- | --- | --- |
| /api/auth/login | POST | Existing deployment admin or persisted platform account |
| /api/workspace | GET | Current authorized workspace |
| /api/workspace | POST | Select a project after live membership validation |
| /api/platform/organizations | GET | Current user's accessible workspaces |
| /api/platform/organizations | POST | Deployment owner provisions customer and initial owner |
| /api/platform/members | GET | Members of the authorized active project |
| /api/platform/members | POST | Owner/admin creates new team user |
| /api/platform/members | PATCH | Role or active state; owner protections enforced |

The Project Settings screen includes member management and deployment-owner
customer provisioning. New accounts can save campaign/content drafts and configure
brand/goals/connection details. Provider verification, AI contexts, files and
workers still require project-scoped adapters. Do not advertise full marketing SaaS
availability yet. Password recovery/invitations and public onboarding also remain.

Validation: 16 catalog/access/session/repository checks and a real HTTP scenario
using a disposable SQLite file and two customer organizations. Covers provisioning,
login, cross-project denial, last-owner protection, member revocation and denied
legacy API/publishing access. No test accounts are written to the live database.

## Layer 3: scoped drafts, profile and encrypted connection registry

Schema migration 2 adds scoped campaigns, content history and connections with
organization/project foreign keys. Migration 3 adds brand voice, language and goal
configuration. Migrations do not import or rewrite existing Crewin JSON/history.
Crewing legacy data stays with its existing adapter; platform-account branches
never load its files, provider credentials or remote services.

Existing routes are reused:
- `/api/campaigns` and `/api/campaigns/{id}` use `UnifiedCampaign` and the extracted
  pure `buildCampaign` factory. Platform requests support draft CRUD only. Inputs
  cannot set backend IDs, scope, counters, running status or dispatch state.
- `/api/data/content-history` preserves the array/HistoryItem API for scoped manual
  text drafts. New project writes are local SQLite, with no remote fallback.
- `/api/marketing/connections` saves and revokes project-specific connection
  credentials. AES-256-GCM uses organization/project/connection ID as authenticated
  context. Responses never contain tokens or encrypted envelopes. Status remains
  `configured_not_verified`, with `isConnected: false`; no provider request occurs.
- `/api/workspace` PATCH saves project brand/goals only for standard projects and
  authorized owners/admins. Client scope and permission fields are ignored.

Encryption: optionally configure server-side `PLATFORM_ENCRYPTION_KEY` as 64 hex
characters. Otherwise a random independent key is created privately beside the
database as `platform-credentials.key`. Back up both database and key; do not rotate
or delete the key without re-encrypting existing connection records.

The shared catalog now enables campaign/content/settings for standard accounts.
ProjectDrafts is a domain-neutral view over existing campaign/history contracts,
not a second campaign service. Crewin retains its existing campaign center and
library. Dispatch, paid ads, scheduling, audience previews and legacy integration
helper routes remain blocked for platform users until their adapters are scoped.

Validation: 19 unit checks, expanded real HTTP scenario with two isolated customers,
production build and TypeScript passed. Chrome QA used a temporary fixture database:
desktop layout and 390px mobile layout; draft edit/save and custom goal creation
worked. Mobile document width did not exceed viewport width. QA server was stopped.

Next: provider-specific credentials/config validation, explicit connection tests,
scoped event/metric ingestion and durable job execution before enabling sending.

## Layer 3 follow-up: connection verification jobs

Migration 4 persists project-bound connection verification jobs and check results.
The existing `/api/marketing/automation` route has a platform-account adapter;
legacy Crewin requests retain their original remote automation behavior.
New accounts can enqueue, inspect, cancel and explicitly run `connection.verify`.
Jobs are idempotent per project, deduplicated while active, claimed transactionally
with a lease, and recoverable after an interrupted request (maximum three attempts).
No unattended scheduler or general-purpose dispatch worker is enabled yet.

Google checks use only fixed Google API hosts, bounded requests and no redirects.
GA4 requires a numeric property ID; Search Console accepts a URL-prefix or
`sc-domain:` property. Success requires a matching authorized property response,
not merely HTTP 200. Credentials are decrypted only server-side with project AAD.
Both job initiator and runner need live permission before and after execution.
Credential replacement, revocation and cancellation cannot be overwritten by an
older in-flight check. Successful access checks expire after one hour and do not
promise that an OAuth token remains valid; downstream operations must check again.
Refresh-token exchange and customer OAuth onboarding are still pending.

Project Settings now offers access tests for GA4/Search Console, pending-job resume
and translated states. Email/social remain registry-only until their provider
adapters exist. These access tests do not fetch marketing reports, send messages
or manufacture metrics. The local panel remains on port 3033.

Validation: 23 unit tests, an isolated production HTTP integration scenario,
TypeScript and isolated production build passed. Tests cover cross-project denial,
idempotency, lease recovery, cancellation, permission revocation, credential
replacement and fail-closed provider responses. Real customer Google credentials
were not supplied, so live authorized provider success remains unverified.
Chrome desktop and 390px mobile checks of the provider-specific form passed;
document width was 375px in a 390px viewport. The disposable QA server was stopped.

## Layer 3 follow-up: customer Google OAuth and renewal

Migration 5 persists short-lived OAuth requests scoped to actor, organization,
project and browser nonce. PKCE verifiers are encrypted with the existing key and
project AAD; state and browser nonce are stored only as hashes. The official
`google-auth-library` implements authorization URLs, PKCE and code/token exchange.
Only the selected provider's read-only scope is requested.

- `/api/platform/google` GET returns configuration availability, never secrets.
- POST starts OAuth only for a platform account with live connection-management
  permission and matching Origin/configured callback origin.
- `/api/platform/google/callback` is a public transport entry point with its own
  live authenticated permission, project, browser, expiration and single-use
  state checks. It does not accept arbitrary redirect destinations or transfer
  authorization codes/errors to the panel URL. Missing-session callbacks fail closed.
- The authorized property is verified before connection save. No tokens, account
  emails, upstream error payloads or PKCE verifier reach the browser response.
- New authorization starts, manual saves and connection revocation invalidate
  earlier in-flight OAuth requests for that target. Scope is never defaulted to
  Crewin. Existing legacy Google service-account flows are unchanged.
- Verification jobs renew expired OAuth access tokens from the project's encrypted
  refresh token, without shared token caches. Renewed tokens are persisted with
  compare-and-swap, live permissions and job lease validation; cancelled/revoked
  or replaced connections cannot be resurrected.

Setup: see `docs/SAAS-GOOGLE-OAUTH.md`. Actual `.env.local` has no SaaS Google OAuth
settings yet. Do not treat the connection as operational until a real customer
consent/property/refresh scenario passes. Email and social adapters, automatic
worker execution, reporting, OAuth disconnect at provider level and quotas remain
separate work. Local revoke erases stored credentials; it does not revoke other
connections' Google grants, since one Google grant can serve several properties.

Validation: 27 unit tests plus the isolated real HTTP scenario passed, including
cross-project/browser callback rejection, replay/expiry, insufficient scope,
concurrent revoke and encrypted token renewal. TypeScript and production build
passed. Chrome desktop/390px mobile forms passed without horizontal overflow.
No Google consent was approved and no live provider grant was created in QA.

Production security gate: npm audit currently reports 13 dependency advisories
(1 critical, 10 high, 2 moderate), including the current Next.js version. Plan a
tested framework/dependency upgrade before opening the SaaS publicly; no forced
major upgrade was mixed into the OAuth implementation.

## Layer 3 follow-up: project SMTP access checks

Existing connection registry and verification queue now support encrypted SMTP
settings. No parallel mail API, external backend or delivery worker was introduced.
No existing Crewin SMTP env credentials or process-wide transporter are reused.

- Project Settings collects host, port, username, password, sender address/name.
  Settings and password remain in the existing AES-GCM credential envelope and
  never appear in list/detail responses. Existing email placeholders remain
  readable; access tests explain that SMTP settings must be supplied.
- Server allowlist contains common SMTP providers and regional Amazon SES hosts;
  additional exact trusted hosts can be configured with
  `PLATFORM_SMTP_ALLOWED_HOSTS`. Only ports 465 and 587 are allowed.
- The existing Site Audit public-IP resolver is reused (only made exported).
  Private/loopback/metadata addresses are denied, including IPv6 variants. DNS
  results are pinned to the actual TCP socket; TLS validates the original hostname.
- Verification requires TLS, certificate validation and authentication. DNS/TCP/
  verification deadlines are bounded; sockets are destroyed in finally. SMTP
  logging and attachment file/URL access are disabled. Only `verify` is called:
  there is no `sendMail`, recipient list or message sent in this adapter.
- Nodemailer 10.1.1 is used in the monolith, compatible with Node 20 and without
  the advisory detected in the initial 9.x selection. Legacy agent dependencies
  are not modified. The other 13 framework/toolchain advisories remain a release gate.

An access check is not sender-domain verification, SPF/DKIM/DMARC verification,
SES sandbox removal, consent verification or proof of inbox delivery. Those gates
must be addressed before enabling real sending. Customer SMTP credentials were
not supplied, so successful live authentication remains untested.

Validation: 30 unit tests plus the isolated HTTP integration test pass. Covers
host/port restrictions, header injection, private networks, TLS configuration,
secret encryption, project isolation and concurrent revocation. Production build
and TypeScript pass. Chrome desktop and 390px mobile form/port selection pass with
375px document width. Temporary QA server stopped; real dev panel stays on 3033.
Next: scoped social-provider onboarding and verification, followed by controlled
dispatch, consent/suppression, sender checks and unattended job execution.

## Layer 3 follow-up: LinkedIn OAuth and social account matching

The first customer social adapters cover LinkedIn personal-account OAuth and
manual LinkedIn/X OAuth2 user tokens. Facebook/Instagram page/business-account
selection, X OAuth onboarding, TikTok and social publishing are not enabled yet.
Do not market this as complete multi-network integration.

- OAuth request persistence/claim/finish was extracted into `OAuthRequests` and
  reused by Google and LinkedIn, retaining Google's PKCE. Provider, actor, project,
  browser nonce, expiry, single-use and live permission boundaries are shared.
  Each provider callback can claim only its own provider's state.
- `/api/platform/social` reports capabilities and starts LinkedIn OAuth with
  SaaS-specific server credentials. The standard confidential-client flow uses
  `simple-oauth2`; only `openid profile` scopes are requested, not email or publishing.
- The callback reads LinkedIn UserInfo over TLS, captures only its stable subject,
  and stores a project-bound encrypted connection. Optional expected-account
  matching, concurrent revoke/replacement and callback replay are fail-closed.
  No ID token is used for platform login or as proof of someone's real identity.
- Migration 6 adds safe social account metadata next to existing connections.
  Canonical `platform:accountId` integration IDs upsert the same project account
  instead of duplicating it under different display names. Tokens remain encrypted.
- Existing connection verification jobs match LinkedIn UserInfo or X `/users/me`
  to the explicitly stored account ID. Fixed HTTPS hosts, no redirects, a 12-second
  deadline and a 64KB response bound apply; provider errors/emails are never returned.
- OAuth token expiry is persisted and expired LinkedIn tokens require reconnect.
  Refresh support is not assumed for LinkedIn, and X refresh-token exchange remains
  separate work. Account access does not imply page administration or publishing rights.
- Customer accounts still cannot use legacy Crewin social status/post/callback
  adapters, files, env tokens or global token caches. Legacy routes are unchanged.

Validation: 34 unit tests plus isolated HTTP integration, production build and
TypeScript passed. Includes shared-state regression tests for Google, provider
confusion, cross-project callback rejection, replay, account mismatch, secret
redaction, canonical upsert and concurrent revocation. Chrome desktop/390px forms
and platform selection passed without horizontal overflow. Test servers stopped.
Real LinkedIn OAuth env settings are absent; no live consent was granted and no
social post was published. See `docs/SAAS-SOCIAL-CONNECTIONS.md` for setup/gaps.

## Layer 3 follow-up: Meta OAuth and explicit asset selection

Facebook Login for Pages/linked Instagram accounts uses a separate SaaS Meta app,
explicit server Graph version, existing OAuth request store and encrypted registry.
Crewin's legacy Facebook callback/token files and first-page behavior are unchanged.

- `/api/platform/meta` GET exposes configuration and sanitized pending page choices;
  POST starts, selects or cancels. The callback has its own authenticated project,
  actor/browser/provider/state checks. It redirects only to the configured origin.
- Facebook scope requests page listing/read engagement. Instagram additionally
  requests `instagram_basic`. No publishing permission, post or media upload occurs.
- Callback completion persists only a ten-minute encrypted selection grant. It
  does NOT create a connection, select the first page or auto-link Instagram.
- Page listing exposes IDs/names/linked Instagram username only, never user/page
  tokens. Paging follows bounded server-stored cursors, not provider `next` URLs.
  Lists cap at 200 pages; each request has a 12s deadline and 64KB response bound.
- Selecting a page re-reads its original page-list batch to check current access.
  Instagram must exist and match the reviewed account. Exactly one selected
  Facebook OR Instagram connection is upserted; tokens remain server-side.
- Selection cancellation, expiry, replay, local connection mutation/revocation or
  a new OAuth flow invalidate stale requests. No project/tenant fallback is used.
- Migration 7 preserves existing LinkedIn/X account metadata while adding Meta
  platforms and parent-page/Graph metadata. A file-backed migration test verifies
  preservation and foreign-key integrity.

Validation: 40 unit tests plus the isolated HTTP integration pass, TypeScript and
production build pass. Chrome desktop and 390px mobile tested the actual selection
component using a disposable, explicitly named fixture grant: no first-page default,
missing-Instagram radio disabled, valid selection enables confirmation, no overflow.
The one-shot cookie fixture portal is test-only; no test endpoint exists in Next.
QA servers stopped; the real local panel remains on port 3033.

Real Meta OAuth configuration is absent. App products/review, accepted redirect,
granted permissions, version compatibility, page roles and live token exchange/
selection still require provider-approved testing. Account checks do not establish
publishing rights. See `docs/SAAS-META-CONNECTIONS.md`. Next: X OAuth onboarding and
scoped refresh rotation, then controlled dispatch/worker/consent and provider write
permissions. TikTok remains separate if needed. Production dependency advisories
and the previously documented security release gate are unchanged.
# Instagram image publication follow-up

Migration21 additively extends the existing publication row with preparation start,
container ID, next-check time and image-byte count. Image bytes use the existing
scoped encrypted snapshot, not a second asset store. Old social/email/measurement
rows remain intact. See SAAS-INSTAGRAM-PUBLISHING.md for consent, signed temporary
handoff, quotas and the current live-provider verification boundary.

# X text publication follow-up

X OAuth PKCE onboarding and text publication now reuse the same encrypted registry,
pending OAuth requests, calendar and queue. No schema22 or duplicate service/table
is introduced. Existing `twitter` keys remain valid. OAuth write consent is explicit;
manual tokens do not acquire provenance. Expiry-limited scheduling is delivered,
automatic token refresh is not. See SAAS-X-PUBLISHING.md for setup, verified local
tests and the still-pending real provider acceptance gate. Live publishing is OFF.

# LinkedIn company-page follow-up

Company Pages now reuse the existing scoped OAuth pending store and publishing
queue without schema22. Account type stays in encrypted credentials and snapshots;
canonical `linkedin:organization:ID` avoids collisions with existing personal IDs.
The callback returns an explicit Page selection, never a first-Page default.
Fresh app/scope/member/organic-role checks apply before submission. Local250-test
suite, legacy22 tests, HTTP, TypeScript, build and Chrome responsive QA passed;
real provider approval and live acceptance remain pending. See SAAS-LINKEDIN-COMPANIES.md.

