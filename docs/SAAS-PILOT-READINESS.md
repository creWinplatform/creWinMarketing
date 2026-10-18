# SaaS pilot delivery - 2026-10-14

Current 18 October release summary: see SAAS-RELEASE-STATUS.md. Historical phase
boundaries/results below are not current completion claims. The seven build-chain
advisories described later were removed with the Tailwind/PostCSS 4.3.3 migration;
full npm audit now reports zero. AWS EC2 Windows and HSS Digital are confirmed
targets, not a completed deployment or real customer pilot.

Update 2026-10-18: version-2 sealed backups and offline verify/restore-drill
commands now check hashes, matching key, schema, scoped references and encrypted
records without starting the app/worker or replacing the active database. See
[Recovery operations](SAAS-RECOVERY.md). Off-host retention, Windows ACLs, container
acceptance and supervised production recovery remain operator release gates.

Update 2026-10-16: Phase 3C2b implements controlled SES delivery, default OFF,
inside the existing queue; migration 18 preserves prior work. No live email was
sent. AWS/DNS/HTTPS configuration and a real authorized pilot remain required.
See [SES contract](SAAS-SES-DELIVERY.md) and [remaining work](SAAS-NEXT-DELIVERY.md).
The earlier delivery boundaries below apply to their original phase.

## What is delivered

The backend remains in the existing Next.js modular monolith. Existing Crewin
services, tab IDs, business models and external ABP tenant configuration are kept.
Customer accounts cannot call unscoped Crewin APIs or reuse Crewin credentials.
No deploy, email send, social post, payment or production-data mutation was made
as part of verification. Browser write tests use disposable SQLite fixtures.

- Shared desktop sidebar, grouped tool search, accessible mobile drawer, query
  navigation/back, light/dark themes and visible Crewin activity/model controls.
- Public `/welcome` landing using real product screenshots with explicitly named
  example data. `/login` and invitation-only `/join` match the shared design.
- Product/brand/goals setup, distinct profile/connections/team settings sections.
- Independent organizations, scoped RBAC, single-use invitation links, password
  change and session-version revocation. Public signup stays closed. Self-service
  email recovery and automatic invitation email delivery are NOT implemented.
- Search, filter, pagination, edit, delete and duplicate campaign/content drafts.
  AI drafts need independent platform key AND explicit model configuration.
- Persistent work plans and manual measurement snapshots linked to project goals.
  CSV is scoped and formula-safe. Work plans are NOT scheduled publishing jobs.
- Customer public-HTML SEO checks reuse the existing `auditPublicPage` engine.
  Only the project's website origin is accepted; private IP protection remains.
  Findings can become work plans; they do not edit or deploy the target website.
- Existing connection-verification queue can run via the authenticated worker.
  Leases, live membership, encrypted credentials and revision checks are retained.
- Server-side pilot ceilings: 500 campaigns, 1000 content drafts, 500 work plans,
  10 team accounts, 50 AI drafts/month, 25 audits/month. No paid-plan simulation.
- SQLite online backup with the generated encryption-key file when applicable.

## Operational commands

Phase 3C2a update (2026-10-16): approved standard campaigns can enqueue, process,
inspect and cancel a persistent pilot REHEARSAL using the existing queue/worker.
No real transport is present; validated recipient rows are not sent messages.
Provider authentication, real delivery and ambiguous-provider reconciliation
remain release gates. See [Pilot queue rehearsal](SAAS-EMAIL-QUEUE.md).

Phase 3C1 update: standard Campaigns > Sender & pilot now selects one scoped SMTP
account, performs exact TXT ownership checks and manages the project's bounded
test-address allowlist. Saved campaign preflight shows the consent/allowlist
intersection after the configured cap. Provider authentication, real delivery
and the recipient worker remain closed Phase 3C2 work, not a completed pilot.
See [Sender and pilot safety](SAAS-EMAIL-SENDER.md).

Phase 3B update (2026-10-15): Campaigns > Recipients & consent adds explicit
source/version email mapping, encrypted evidence review and permanent project
suppression. Scoped unsubscribe reuses existing public paths without forwarding
Ryzevo tokens to Crewin. Campaign preflight reports current eligible unique
recipients and invalidates stale checks after safety changes. Actual sending
remains disabled; sender verification, allowlist and idempotent recipient delivery
are Phase 3C gates. See [Recipient safety](SAAS-EMAIL-RECIPIENTS.md).

Phase 3A update: standard campaign drafts now support saved-message preview,
current-audience preflight and owner/admin content approval with history. This
does not enable sending or prove communication permission. See
[Campaign review](SAAS-CAMPAIGN-REVIEW.md) for the explicit Phase 3B gates.

Phase 2 update (2026-10-15): standard-project Campaigns > Audiences supports typed
rules, real observed-population previews, existing goal/stage references and
immutable campaign bindings. Source freshness, incomplete event history and
project permissions fail closed. Counts are not conversions or sendable recipients.
See [Dynamic audiences](SAAS-SEGMENTS.md). Approval/dispatch, automatic conversion
reports and commercial self-service remain outstanding release gates.

Run from `crewinjob-web`:

```powershell
npm run dev
npm run test:platform
$env:NEXT_DIST_DIR = '.next-monolith-platform'
npm run build
npm run test:platform:http
Remove-Item Env:NEXT_DIST_DIR
```

Development stays at `http://localhost:3033`; landing is `/welcome`. Build output
is isolated from the running dev server. Tests bind temporary ports 31449/31450
and never reuse the application's SQLite data file.

Optional connection worker, in another managed process:

```powershell
npm run worker:platform
npm run backup:platform
```

The worker requires `CRON_SECRET` and trusted `PLATFORM_WORKER_ORIGIN`. It verifies
connections and, since Phase 1A, executes explicitly queued read-only product
sync jobs and bounded Phase 1B event-retention cleanup. It does not send
messages/posts or automatically schedule imports.
It was not enabled against real customer connections during QA. The HTTP worker
endpoint rejects anonymous access.

Backups go to `PLATFORM_BACKUP_PATH` or private `data/backups`. If the credential
key comes from `PLATFORM_ENCRYPTION_KEY`, retain it in a secure vault separately.
Protect the backup directory with service-account filesystem permissions. Restore
only with the app/worker stopped, into a separate volume first; verify integrity,
key matching and membership isolation before replacing the active database. Never
delete the source database during backup. A temporary-database restore test passes.
Rotate `AUTH_SECRET` after restoring an older snapshot so revoked sessions cannot
become valid again; review memberships and clear pending OAuth requests. Keep the
credential encryption key stable and restore it securely with the matching data.

## Configuration still needed

- Separate Google OAuth app/API products, redirects and authorized properties.
- Separate LinkedIn/Meta apps, app approval, scopes, roles and live token lifecycle.
- Real SMTP credentials, sender-domain authentication and provider restrictions.
- `PLATFORM_GEMINI_API_KEY` and `PLATFORM_GEMINI_MODEL` available to that API key.
  No hard-coded model fallback or legacy Crewin key fallback. Review the provider's
  [current model schedule](https://ai.google.dev/gemini-api/docs/deprecations/).
- Durable single-host disk, stable AUTH/encryption secrets, HTTPS/reverse proxy,
  process supervision and scheduled private backups. SQLite here is not a
  multi-host shared database; scaling needs a tested storage adapter/migration.

## Development still required before selling a full SaaS

Update 2026-10-15: generic read-only REST ingestion is delivered as Phase 1A,
with 64 passing unit/SQLite tests and HTTP/Chrome checks. This does not complete
generic event ingestion, audiences, automatic reporting or dispatch. See
[Product data operations](SAAS-PRODUCT-DATA.md).

Follow-up on the same date: signed server-to-server event ingestion is implemented
as Phase 1B. It reuses source versions and entity projections, records consent
claims without granting marketing permission, and adds bounded retention cleanup.
See [Signed product events](SAAS-PRODUCT-WEBHOOKS.md). Real customer sender
configuration and public HTTPS acceptance have not been performed.

These are not merely missing keys and must not be called complete:

1. Customer campaign approval, audience/consent/suppression and controlled dispatch;
   sender verification, provider write scopes, scheduled publishing, tracking and
   failure reconciliation. Legacy Crewin dispatch stays isolated and unchanged.
2. Customer Google report ingestion and automatic conversion metric derivation.
   Signed product event storage exists, but current customer growth reports still
   contain only explicit manual observations. Generic segments are not implemented.
3. Billing provider checkout/portal/webhooks and subscription entitlement lifecycle.
   No prices, paid subscription status or completed payments are invented.
4. X OAuth/refresh onboarding, further social provider integrations and live
   provider end-to-end acceptance. Manual X access checks are already present.
5. Verified-email recovery/invitation delivery, retention/deletion/export policy,
   legal documents, monitoring and load/abuse testing for public release.
6. Build-toolchain dependency remediation: production `npm audit --omit=dev`
   returns zero vulnerabilities; full audit still reports 7 Tailwind 3 toolchain
   advisories (5 high, 2 moderate). Tailwind 4 migration needs UI regression tests.

## Verification

- Next upgraded to 15.5.27 with official async-request codemod. Existing dynamic
  route parameters and cookies were adapted; external Crewin DTOs did not change.
- PostCSS override and Sharp updated. Production dependency audit: 0 findings.
- 51 unit/SQLite tests, 22 legacy agent contract/regression tests and 1 real HTTP
  integration scenario pass. ExcelJS workbook roundtrip and offline Nodemailer
  message rendering were also checked; no SMTP message was delivered.
- TypeScript and isolated production build pass. Main first-load JavaScript is
  137 kB versus 332 kB before tab splitting. This is bundle size, not a measured
  PageSpeed/Core Web Vitals improvement.
- Chrome fixture checks cover desktop/mobile navigation, campaign save, calendar,
  reports, settings and landing. Public product images are fixture-only screenshots.
- Real provider consent, AI generation, sending, paid billing and live production
  customer use are not claimed as verified.

The legacy agent's production dependencies were audited separately, then patched
with compatible updates, Nodemailer 10.1.1 and an ExcelJS-only UUID 11 override.
Both web and agent production audits now return zero findings. The remaining seven
full-audit findings are in the web build toolchain, not concealed as resolved.
