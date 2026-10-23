# HSS Digital - first non-Crewin pilot

Business and website confirmed by the owner: HSS Digital,
https://www.hssdigital.com. Target hosting: AWS EC2 Windows.

## Proposed setup, pending business approval

HSS describes custom software, ERP/system integration and business automation,
with a separate partnership path for ERP resellers/software businesses on its
[public site](https://www.hssdigital.com/), reviewed 18 October 2026. The journeys
below are configuration proposals, not observed conversion performance.

| Goal | Proposed stages | Proposed audience |
| --- | --- | --- |
| Qualified project demand | Request -> discovery meeting -> proposal -> won project | Businesses evaluating custom software or system integration |
| Partner acquisition | Partner inquiry -> qualification meeting -> active partnership | ERP resellers and software businesses |

Use the existing standard product pack, project profile, roles, brand voice,
goals, content/campaign drafts, work calendar and sourced measurements. Do not
enable Crewin's seafarer/credit/job-bot tools or inherit its credentials.
No new HSS-specific backend, queue, taxonomy or customer database was introduced.

## Local acceptance

`test/hss-pilot-fixture.cjs` contains the proposed profile for a temporary QA
account only. `scripts/preview-design.cjs --hss` runs it in separate SQLite with
all send/signup/payment gates OFF. The fixture intentionally seeds NO conversion
metrics, traffic, customers, provider verification or billable subscription.
Its two example work plans are labelled QA, not real customer activity.

The pilot regression uses the existing repository/store/operations APIs and checks
standard module selection, two goals, draft-to-task linkage, foreign tenant denial
and absence of invented measurements. This is not live HSS user acceptance.

## Actual onboarding sequence

### Owner-selected local pilot: 18 October 2026

The product owner authorized preparing the HSS account and selecting its pilot
scenario. The selected first journey is **qualified project demand for software /
ERP integration**, followed by request -> discovery meeting -> proposal -> won
project. Partner acquisition remains the second existing goal, not a second CRM.

The reserved invitation username is `hss-digital-owner`. Account activation must
use the existing single-use invitation flow so the human owner chooses their own
password. An invitation is not an active account or completed customer acceptance.
Its private local handoff file is excluded from Git; no invitation token or
password belongs in this document or the chat. Organization/project/website
prefills are editable public setup data, not authorization or provider grants.

The explicitly approved owner invitation is now prepared and verified. Private
handoff: `crewinjob-web/data/private-onboarding/hss-digital-invitation.html`.
Expiry: 20 October 2026, 22:44 Europe/Istanbul. The directory ACL allows the
current Windows user and SYSTEM only; Git ignores the directory. The token is in
the localhost link fragment, not the server request query. The owner said account
activation cannot be completed now. Therefore the actual HSS user, organization,
goals, campaign and source events have NOT been provisioned; do not replace this
pending human step with a generated/shared password or a QA identity.

The real localhost invitation-inspection API returned HTTP 200 and the expected
username/new-organization scope. Activation was not submitted. Final local
verification: 469 platform tests, TypeScript, production build and production
HTTP acceptance passed. No real provider request or pilot message was sent.

First campaign draft: “ERP integration discovery”. Intended channel: HSS's own
LinkedIn company Page, once the owner grants access; email is a later optional
channel only for separately reviewed consented contacts. Proposed offer: a
technical discovery conversation about existing systems and integration needs.
Do not claim a free service, quantified ROI, existing customers or deliverability.

Until real HSS events and provider permissions exist, keep traffic, lead counts,
conversion rates and revenue unavailable. Do not copy disposable QA users/events
into the actual account. The isolated automated email-rehearsal scenario exercises
the common review/consent/measurement engines; it is not permission to email HSS
prospects and does not change the selected LinkedIn-first business journey.

Safe next steps after the owner activates the account: review the two existing
goal definitions above, set brand voice, save the campaign as a draft, and create
existing Calendar setup tasks for the LinkedIn Page, successful-lead webhook and
approved measurement mapping. Never bypass missing provider grants with fixtures.

1. Privately identify the HSS workspace owner; use the EXISTING invitation/new
   organization flow. Do not reuse the QA password, create a public demo login or
   silently add HSS to Crewin's organization. Owner sets their own password.
2. Enter and review the two proposed journeys in Project Settings. Enable only
   applicable shared tools. Keep all metrics as unavailable until actually sourced.
3. Attach HSS's own approved Google properties/social accounts and sender identity
   through existing connections. Review scopes/account selection and retain grants
   only in the existing encrypted store. Real provider acceptance is separate.
4. Connect successful HSS server-side form/CRM events to the EXISTING signed
   product webhook. Do not emit successful-lead events merely on a browser click
   or failed email/form submission. No HSS frontend/backend source was supplied or
   modified here, so those event producers are NOT claimed integrated.
5. Prepare an ERP-evaluation content/campaign draft, review its destination,
   audience/permission evidence and saved content approval. Start with an explicitly
   approved small allowlist pilot; never contact website visitors by inference.
6. Verify actual request/meeting outcomes against the source, not a manually
   invented conversion count. Check opt-out and error recovery before expansion.

## User guide for the pilot team

`/guide` (public, TR/EN, `app/guide/page.tsx`) walks a team without a marketing
specialist through day one (account, product profile, diagnosis, brief review and
approval), the weekly rhythm (This week, actions, measuring, weekly review), the
monthly renewal, the tools, roles, a short glossary and common sticking points.
The coach's first screen links to it. Screen names match the app labels; keep
them in sync when a label changes. Collect the team's notes (screen, intent,
what happened) and update the guide from them.

## Proposed event mapping

Use `SAAS-PRODUCT-WEBHOOKS.md` without adding a second event API. Example source:
entity type `lead`; accepted names `lead.submitted`, `lead.qualified`,
`meeting.completed`, `proposal.sent`, `project.won`, `partner.activated`;
typed attributes `journey` (string), `stage` (string), `qualified` (boolean).
Every event supplies every configured attribute, stable pseudonymous entity/event
IDs and a timezone-aware occurrence time. Final names/stage meaning require HSS
business approval before preview and activation.

The HSS server keeps the source ID/version and signing key privately, signs the
exact JSON bytes and handles duplicate/uncertain retries according to that existing
contract. Never send signing keys from the browser, log contact payloads, or grant
email marketing consent just because a lead submitted a technical request.

## Live acceptance evidence still required

- Owner invitation completed, correct project and roles visible.
- EC2 reboot/persistence, HTTPS/proxy/cookie/origin checks and task supervision.
- Authorized provider connection and scoped real property/account data.
- One real successful HSS request recorded once; rejected/duplicate events handled.
- One explicitly authorized email/social pilot and its outcome, not just queueing.
- Opt-out/suppression, member revocation and a separate off-host restore drill.

The current local fixture is not any of those external approvals. Billing may
remain closed throughout this non-financial pilot.

## Local Chrome record - 18 October 2026

Production fixture checked at 1440px desktop, 768px tablet, 390px mobile and
320px narrow width. Saved an HSS ERP-assessment campaign draft against the
qualified-project goal; UI returned Draft saved. All ten visible editor fields
were 16px on mobile. Two HSS goals appeared and no Crewin-only tool appeared.
Keyboard reverse Tab stayed inside the drawer; Escape restored More; the
background inert state was removed. Sampled light muted text was 5.22:1 against
its surface. Dark-theme tablet was also inspected; this is not full WCAG audit.

An actual read-only public-HTML audit of https://www.hssdigital.com returned
HTTP 200, one H1, zero missing image-alt and one schema block. At the time of this
check, requests for robots.txt and sitemap.xml returned 404, producing two low
priority findings. They are timestamped observations, not permanent site claims
or Google index/Core Web Vitals measurements. Added the robots finding to the
QA work plan and verified it appeared as the third task in the existing calendar.
The live HSS site was NOT changed and the issue was NOT marked fixed/applied.

## Extended local activation regression

An additional isolated test now executes: first-use compass -> existing HSS goal
-> consent-reviewed fixture audience -> content/audience approval -> five-recipient
**no-send** rehearsal -> source-backed unique-entity measurement. Global network
calls fail the test. A changed campaign invalidates the rehearsal, a foreign
project cannot read its preferences, and no live email job is created. Historical
coverage/events are labelled disposable fixtures, never production performance.

- [Desktop fixture](screenshots/hss-pilot-desktop-20261018.jpg)
- [Mobile fixture](screenshots/hss-pilot-mobile-20261018.jpg)
- [Tablet dark fixture](screenshots/hss-pilot-tablet-dark-20261018.jpg)
- [Actual HTML audit in QA](screenshots/hss-audit-tablet-20261018.jpg)
