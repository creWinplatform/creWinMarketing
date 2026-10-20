# Ryzevo remaining delivery sequence

Reuse existing project identity, RBAC, encrypted connections, product events,
segments, approval, consent, sender and queue. Crewin tools remain in its pack.
All phases stay in the modular monolith, with no duplicate services.

Current release gate and owner-input summary: SAAS-RELEASE-STATUS.md. Hosting is
AWS EC2 Windows; the first non-Crewin business is HSS Digital. See
SAAS-WINDOWS-EC2.md and HSS-DIGITAL-PILOT.md. These prepared paths are not a live
deployment or completed customer/provider acceptance.

| Order | Deliverable | Current boundary |
| --- | --- | --- |
| 1 | Amazon SES real pilot | Bounded transport, scoped feedback, existing worker implemented. Default OFF; operator AWS/DNS/public HTTPS setup and one authorized live pilot still needed. See SAAS-SES-DELIVERY.md. |
| 2 | Automatic conversion measurement | Source-linked GA4/GSC and received product-event measurements implemented with provenance, freshness, independent manual records and the existing queue. Live customer Google grants and provider acceptance still required. Causal/cross-source attribution is not delivered. See SAAS-MEASUREMENTS.md. |
| 3 | Social publishing/scheduling | LinkedIn personal/company-page, Facebook Page and X text plus Instagram single-image pilots implemented on existing registry/content/calendar/worker, with exact approval, rehearsal, scheduling and cancellation. Default OFF and not live-provider verified. Company Pages require explicit selection/consent and fresh exact organic role/scopes. X has weighted 280-character validation and expiry-limited schedules; no automatic refresh. Additional media formats, provider acceptance and engagement adapters remain. See SAAS-SOCIAL-PUBLISHING.md, SAAS-LINKEDIN-COMPANIES.md, SAAS-FACEBOOK-PUBLISHING.md, SAAS-INSTAGRAM-PUBLISHING.md and SAAS-X-PUBLISHING.md. |
| 4 | Onboarding/recovery | Verified recovery mailbox, single-use reset, isolated verified-mailbox self-service enrollment and persistent abuse limits implemented using existing identity/memberships/worker. Both email and public signup default OFF. Dedicated Ryzevo SES/HTTPS/worker setup and an authorized live verification/reset pilot remain. Existing project goals/tools provide the onboarding path. Mailbox verification is not website ownership. See SAAS-IDENTITY.md. |
| 5 | Paid subscriptions | Approved monthly catalog, owner preference, new verified-signup trial and exact quota ledger implemented. Owner-only USD PayTR sandbox checkout, signed callbacks and explicit status inquiry with race/lease protection are implemented, default OFF. No live subscription, paid entitlement or quota upgrade exists. Merchant setup is not ready (owner confirmed 18 October). USD/recurring merchant acceptance, live lifecycle/reconciliation, conflict resolution, cancellation/tax/invoice flows remain. Team and annual sales deferred. See SAAS-PLAN-USAGE.md, SAAS-PAYTR.md and SAAS-PRICING-PROPOSAL.md. |
| 6 | Production/second-business pilot | Sealed backup/recovery, private probe and bounded worker observations implemented. Node-22 Linux runner packages operator commands and checks native dependencies; offline build gate, isolated two-tenant parallel HTTP/backup/restore smoke and six-client SQLite quota/refund races added. Short bounded mixed-traffic, upload/abort, login-limit and session-revocation regressions extend that same harness; no duplicate test service or schema change. No production restore, deploy, scheduled monitoring, notification or provider call. Actual durable-volume/operator deployment, off-host retention, external uptime/alerts, secrets lifecycle, long-duration load/soak and internet-facing abuse acceptance, responsive/accessibility QA and a real non-Crewin customer remain. Not a production launch yet. See SAAS-RECOVERY.md, SAAS-MONITORING.md and SAAS-RUNTIME-ACCEPTANCE.md. |

19 October update: the growth coach and the Phase 5 shared modules (SEO operations,
lifecycle automation, B2B prospects, Telegram target, Meta ad management and the
budget and goal planner) are implemented for standard projects at schema 45, with
582 platform tests passing. Provider-backed acceptance for Telegram, Meta ads and
SES sends is still open. Next code-side items: WhatsApp target and separate
source-reading / suggestion / publishing permissions for messaging, then Google
Ads and LinkedIn ads. See SAAS-RELEASE-STATUS.md and SAAS-PHASE5-MODULES.md.

External credentials are entered privately in project settings, not in chat.
Phase 5 update, 18 October: approved monthly catalog (Launch 29 / Growth 79 USD,
Team 149 USD later), non-financial owner preference and new verified-signup
14-day trial implemented. Existing pilot rights remain. Paid activation is still
blocked on live lifecycle acceptance; see SAAS-ENTITLEMENTS.md.
Actual sends, financial and provider-access changes need operator approval.
Continue later code phases while setup is pending, without fabricated success.

18 October runtime update: production build and 395 offline platform regressions
passed. The same isolated runner passed a 30-second, four-client, 461-request
mixed-traffic check, actual upload deadlines, login limiting and password-change
revocation plus encrypted recovery. These bounded local checks do not close the
long-duration production load/abuse or external-provider acceptance gates. Next
independent code-side check: responsive/accessibility review of the SaaS flows.

18 October frontend update: representative SaaS flows passed Chrome desktop,
tablet, mobile and 320px narrow-screen checks with keyboard navigation. Shared
touch targets, form sizes, menu focus/inert behavior and scrollable regions were
improved without changing Crewin contracts. Final production build, 395 offline
tests and the production HTTP regression passed. See
SAAS-RESPONSIVE-ACCESSIBILITY.md for screenshots and limits. This completes the
bounded SaaS responsive pass, not full screen-reader/contrast, real-device or
every-legacy-module accessibility acceptance. Production and provider gates
above remain open.

18 October release-preparation update: the seven old build-toolchain advisories
were removed by moving to Tailwind/PostCSS 4.3.3, with a full-audit result of zero
and a CSS compatibility regression. Shared muted text contrast and desktop menu
visibility were improved. Windows private-path/secret/origin/native-runtime
preflight and non-overwriting Local Service task registration are prepared;
installation/ACL/IIS/reboot/off-host acceptance is NOT performed. The HSS fixture
uses standard modules, two proposed goals and no conversion measurements.
Live paid billing remains unimplemented beyond sandbox; it is not merely waiting
for a test key. Keep provider grants, actual sends and financial gates separate.
