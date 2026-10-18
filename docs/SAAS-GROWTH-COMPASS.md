# Ryzevo Growth Compass

## Scope

The compass is an orchestration layer over existing standard-project tools, not a second campaign, connection, calendar, approval or reporting system. The legacy Crewin workspace is unchanged.

On the first authenticated visit to a standard project, each member chooses a priority, an existing project goal, guidance density and up to three pilot channels. They can defer and return from the persistent Compass header action or the overview rail. A project member's choices never alter another member's choices or the project's shared goals. Visiting an OAuth callback does not automatically open first-run onboarding over account selection.

Available paths:

- Qualified leads and customers: product profile, selected channel accounts, existing content, campaign, no-send rehearsal, separately approved live pilot and measurement.
- Social reach: the same existing social-content/publication queue, with personal LinkedIn and company pages distinguished.
- Retention: actual product records, sender ownership and test recipients, existing campaign content/audience review, no-send rehearsal, gated pilot and observed measurements.
- SEO: public HTML audit receipt for the project's current origin, real Search Console access, an audit-related implementation task (or a clean-audit result), and measurement. Audit success never implies indexing or Core Web Vitals success.
- Mobile: an existing app selection, current active-source production events, content/campaign and the existing mobile rehearsal/message flow. Saving credentials alone never completes event verification.

The first selected pilot channel determines the rehearsal route. Connecting additional channels does not publish to them. Mobile provider connections remain optional according to the app's requirements; one primary attribution source prevents duplicate acquisition counting.

## Evidence and Safety

Progress is derived at read time; there is no client-controlled `complete` operation. It can regress after source revocation, permission expiry, content changes or source-version changes. Selecting a channel or reading a guide grants no account access.

Connection states distinguish missing, configured-but-unverified, verified access, verified publishing access, pending Ryzevo operator setup, and insufficient project permission. A saved SMTP credential does not establish domain ownership, consent or delivery. A rehearsal is not a real send. Provider acceptance is not delivery, revenue, attribution or a causal uplift claim.

The compass calls no external providers, publishes nothing, adds no SDK to a customer's app and never enables live gates. Provider setup links use the existing settings/campaign/mobile screens. Handoff creates an explicitly requested, deduplicated open task in the existing Calendar; it sends no email or notification and does not assign anyone automatically. Task text is fixed setup guidance and public documentation, never credentials.

## Connection Guidance

Guides cover LinkedIn personal/company, Facebook Page, Instagram Professional, X, GA4, Search Console, email/SES, product data and mobile providers (Firebase, OneSignal, AppsFlyer, Adjust, Branch, RevenueCat and Google Play Publisher).

Each guide includes prerequisites, setup order, common blockers, the correct existing setup screen and official documentation. The user can record “not sure”, “no account/page”, “need access” or “later”; none counts as completion.

Responsibility is explicit:

- Customer account owner: create/select their existing account or business Page and give the user's own account appropriate access. Do not share account passwords or OTPs.
- Ryzevo operator: configure and approve Ryzevo's OAuth applications, callback URLs, API versions and server gates. Standard customers are not asked to create their own OAuth developer application to compensate for a missing Ryzevo setup.
- Product/mobile team: configure source contracts, stable customer IDs, SDK/relay and device consent. The panel does not automatically modify native apps or production websites.

The current Instagram adapter uses Meta/Facebook Login and requires a professional Instagram account linked to a Facebook Page. This guide describes that adapter, not every possible Instagram API. LinkedIn sign-in alone is not personal publishing permission; company Page publishing uses the separate company grant and eligible Page roles.

Primary references in the catalog include:

- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
- https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/
- https://developers.google.com/analytics/devguides/reporting/data/v1/property-id
- https://support.google.com/webmasters/answer/9008080
- https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html

## Persistence and API

Schema 30 adds only `platform_compass_preferences`, with a user/organization/project primary key and a project/organization foreign key. Existing migrations, encrypted credentials, campaign queues, records and legacy APIs remain in place. Offline backup inspection accepts schema 30. Preference writes use an immediate transaction and an optimistic revision; stale updates return HTTP 409. A GET never creates preferences, schedules jobs, consumes quota or writes progress.

`/api/platform/compass` is session-protected, scoped server-side, private/no-store and standard-project-only:

- `GET`: safe preferences, existing goal/campaign/app choices, provider readiness and derived steps. No provider token, recipient list or account credential is returned.
- `POST { action: "save", expectedRevision, intent, experience, goalId?, campaignId?, appId?, channels, obstacles }`: save personal preferences. Foreign identifiers fail validation.
- `POST { action: "defer", expectedRevision }`: persist first-run deferral.
- `POST { action: "handoff", provider }`: reuse/create a Calendar setup task; requires existing content-write permission.

Writes require a same-origin request and use the existing bounded JSON reader. A viewer may save personal needs but cannot gain connection-management or delivery privileges. If the compass cannot load, the existing tools remain accessible.

## Verification

Run `npm run test:platform`, `npx tsc --noEmit`, an isolated `NEXT_DIST_DIR=.next-monolith-platform npm run build`, and `npm run test:platform:http`.

An isolated Chrome fixture is available through `node scripts/preview-design.cjs --compass` (optionally combine with `--mobile`). It uses disposable project data, non-real credentials and disabled live gates. Never interpret fixture measurements as production results.

Browser acceptance: first-run setup, save/resume, defer/reload, provider blocker, deduplicated handoff in Calendar, the correct expanded existing connection form, viewer restrictions, OAuth callback non-interruption, keyboard Escape/focus and desktop/tablet/390px/320px layout.

Real OAuth approvals, customer-owned provider accounts, DNS/SES verification, SDK deployment and separately authorized live pilots remain operator/customer setup work. A completed compass implementation is not a claim these external prerequisites have been completed.

### Local results: 18 October 2026

- TypeScript and the isolated production build passed (28 static pages).
- Full platform regression: 467 passed, 0 failed, including 21 compass tests.
- The production HTTP suite passed: authentication, same-origin writes, bounded JSON, rejected client completion requests, optimistic revision and cross-project preferences.
- Chrome verified first-login setup, explicit deferral persisting after reload, later path selection, existing goal reuse, connection guidance, a deduplicated handoff visible in Calendar, the existing company LinkedIn form opening without an OAuth grant, and separately scoped viewer preferences. Viewer setup/handoff controls remained unavailable.
- Desktop 1440px, mobile 390px and narrow 320px were inspected. The inspected dialog/page/control widths had no horizontal overflow. Escape closed the dialog and returned focus to the Compass action. Background scroll is locked while the dialog is open; switching views focuses the heading and resets the guide scroll position.
- Browser control was disabled in Work settings before the final tablet and last-build visual recheck. Those checks must not be reported as passed. The latest build and automated tests include the final scroll-reset and first-pilot-channel compatibility fixes.
- The real 3033 dev server was narrowly restarted with all external send/link/signup/payment gates disabled and a separate dev build directory. Public health and identity capabilities returned 200. Local database migrated to schema 30: integrity `ok`, 0 foreign-key violations, 0 automatically created compass preference rows. A sealed backup was taken before migration. No customer project or provider permission was created by the tests.

Visual proof: `docs/screenshots/compass-first-login-390.jpg` contains disposable fixture data only.
