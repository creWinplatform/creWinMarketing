# LinkedIn company-page text pilot

## Delivered boundary

Company-page text posts extend the existing project connections, content/campaign
drafts, Calendar > Social publications, permission proof, encrypted snapshots,
audit and private worker. There is no second publishing service, table or schema22.
Schema remains21. Crewin's legacy adapters, credentials and ABP services are not
used or modified. Personal LinkedIn, X, Facebook and Instagram flows remain intact.

Channel stays `linkedin`, so content is not duplicated. Organization connections
use canonical integration IDs `linkedin:organization:ID`, while existing personal
connections retain `linkedin:ID`. The explicit `social.accountType=organization`
and OAuth member/grant metadata live in the existing scoped AES-GCM envelope.
Public metadata and immutable publication previews identify company vs person.
Old snapshots without accountType continue to mean a personal account. A queued
job cannot silently switch author type, credentials, selected Page or source.

## Operator setup

Reuse the EXISTING separate SaaS LinkedIn app and private configuration:

```dotenv
PLATFORM_LINKEDIN_CLIENT_ID=YOUR_APP_ID
PLATFORM_LINKEDIN_CLIENT_SECRET=YOUR_APP_SECRET
PLATFORM_LINKEDIN_REDIRECT_URI=http://localhost:3033/api/platform/social/callback
PLATFORM_LINKEDIN_API_VERSION=YOUR_ENABLED_YYYYMM_VERSION
PLATFORM_SOCIAL_PUBLISH_ENABLED=0
```

Register the exact HTTPS callback for production. Verify Community Management API
access, applicable product approval and current enabled version with LinkedIn.
This code does not obtain app approval or expand any existing customer's grant.
No actual provider consent or live post was performed by this delivery. Live
publishing remains OFF and requires separately authorized provider acceptance.

## Connection flow

1. Project settings > Connections > Connect LinkedIn company page. Read-only
   default requests `openid profile r_organization_admin`. Only explicit publishing
   checkbox consent adds `w_organization_social`, NOT `w_member_social` or broad
   organization-management write permission. Existing personal consent is unchanged.
2. Existing OAuth request store binds state and browser cookie to actor/project/
   organization with 10-minute expiry, encryption and single-use claim. Provider
   completion uses the existing LinkedIn callback and creates a selection grant,
   not an automatically connected Page. No tokens enter redirect URLs or client JSON.
3. GET `/api/platform/linkedin-organizations` lists approved role-assignee records
   from versioned `/rest/organizationAcls`, then batch-loads public names through
   `/rest/organizationsLookup`. Results are paged at25 and capped at200 raw ACL
   records, deduplicated by Page. Next URLs are never followed; only numeric local
   offsets are sent to the fixed provider host. Missing/mismatched names are disabled.
4. User explicitly chooses a Page; there is no first-page default. Read-only
   grants can connect approved-role Pages. Organic publishing permits only known
   ADMINISTRATOR / CONTENT_ADMINISTRATOR / CONTENT_ADMIN roles. Analyst and
   sponsored-content-only roles are not treated as organic publishing permission.
   Unknown/new roles conservatively remain blocked pending provider validation.
5. Selection rechecks the token's member identity, selected Page at its source
   offset, name and role before saving exactly one connection. Changed role, name,
   expiry, app configuration, revocation, project, browser, replay or concurrent
   consent fails closed. Another OAuth flow/cancellation invalidates stale state.
   No automatic token refresh or grant expansion is implemented.

LinkedIn recommends permission-based organizationAuthorizations where available.
This pilot deliberately uses the documented, conservative role finder with the
read scope instead of requesting broad `rw_organization_admin` solely for that
check. Roles alone are NOT sufficient: current write scope/app/token/identity are
also verified before live publication. Provider-required access can still reject
the operation; the interface must not fabricate readiness or fall back to v2.

## Publication flow

The existing saved LinkedIn text/campaign source can target either a personal
account or an explicitly selected company connection. Source/account/time changes
invalidate approval. Rehearsal is local only; it does not establish provider write
permission. Scheduling/cancellation use the existing queue and worker.

Publishing check and execution both require:

- Server live flag, current owner/admin authority and explicit exact-post approval.
- Encrypted server-created organization consent with explicit publishing opt-in.
  Generic connection JSON cannot supply or preserve this provenance.
- Current official token introspection: active3-legged token, exact SaaS app,
  `r_organization_admin` and `w_organization_social`, future expiry.
- Fresh OIDC member identity matching the encrypted grant, and an approved organic
  role for the exact organization. OIDC subject is not assumed equal to ACL person
  URN; the authenticated role-assignee finder establishes that association.

The check has a20-second overall deadline, bounded individual requests/replies,
fixed hosts and no redirects. It is re-run at execution, not replaced by a cached
UI badge. Existing revision-bound five-minute proof, role-loss invalidation,
fenced leases, idempotency, quotas, expiry and duplicate-post protections apply.

ONE reserved `POST /rest/posts` uses `urn:li:organization:ID`, exact escaped plain
text (1–3000), PUBLIC visibility and MAIN_FEED distribution. Known201 header URNs
are recorded as provider receipts with a safe fixed-origin permalink. A lost
response, malformed receipt, network error or server ambiguity is NOT retried.
An uncertain send is not called unsent; cancellation after submission does not
delete/retract a post. No company images, ads, engagement analytics or fake reach/
click/conversion numbers are added here.

## Validation commands

- `npm run test:platform` includes16 organization-specific cases plus existing suites.
- `npm run test:platform:http` tests OAuth URLs, cookie/scope boundary, CSRF/RBAC,
  ignored forged grant fields, author metadata, rehearsal and live-OFF behavior.
- `npx tsc --noEmit` and isolated `NEXT_DIST_DIR=.next-monolith-platform npm run build`.
- `node scripts/preview-design.cjs --linkedin-organizations` creates a disposable
  DB and fake Pages on127.0.0.2:31450, isolating browser cookies from the real panel.
  Its one-shot random-path portal on31451 only places a cached TEST selection cookie.
  There is no fixture endpoint in production Next. UI fixtures are not provider
  acceptance evidence; never submit real consent or publishing from them. The
  fake callback is not the browser fixture origin, so starting real OAuth there
  is intentionally not a supported test. Use the isolated HTTP suite for URL checks.

## Primary References

Local verification on 2026-10-16 passed:250 platform tests,22 legacy-agent tests,
production HTTP suite, TypeScript and isolated production build. Existing inferred
workspace-root/multiple-lockfile build warning remains, with no new compile error.
Chrome verified1440/768/390 widths, TR/EN, light/dark, no horizontal overflow,
no initial Page choice, disabled analyst selection, explicit selection enabling
the confirmation button, selection cancellation, default-OFF consent, company
rehearsal and cancellation of future work. Console had no errors/warnings.
The Page fixture is simulated: provider consent and actual Page connection/token
exchange were covered with mocks, NOT with live LinkedIn. No real post, deploy,
main-database fixture or schema migration was performed. QA servers were stopped.
Screenshots under `docs/screenshots/`: `linkedin-company-selection-desktop.jpg`,
`linkedin-company-selection-mobile.jpg`, `linkedin-company-publication-mobile.jpg`,
`linkedin-company-publication-desktop-dark.jpg`.

- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09)
- [Organization roles and read scopes](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-03)
- [Organization batch lookup](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-09)
- [Permission-based checking guidance](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-authorizations/getting-started?view=li-lms-2026-04)
