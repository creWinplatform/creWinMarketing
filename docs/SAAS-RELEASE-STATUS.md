# Ryzevo release status - 23 October 2026

The core monolith is suitable for continued isolated testing. It is NOT yet an
accepted public/paid production service. An implementation, a local fixture test
and an operator-approved live acceptance are different milestones.

## Delivered on 23 October 2026

- **Pilot account checklist** (`PILOT-HESAP-KONTROL-LISTESI.md`): what to prepare for SES, the live server, Google, Meta (Page, Instagram, WhatsApp, ads), LinkedIn and X, with the exact callbacks and permissions, and how each is tested.

- **Terms page and user guide:**
  - `/legal/sales` is a draft template and is noindex until the seller details and the legal review are complete; live payment refuses it until then. See `SAAS-PAYTR.md`.
  - `/guide` is the pilot team's user guide.
- **Coach reaches WhatsApp, paid ads and video** (`SAAS-GROWTH-COACH.md`, Phase 5):
  - one new budget question;
  - paid ads only with a budget, and WhatsApp for individual and local buyers;
  - a Reels draft for teams with the video skill.

  No schema change.
- **WhatsApp messages in the inbox (schema 55)** (`SAAS-PHASE5-MODULES.md` section 13):
  - messages arrive through the signed webhook;
  - replies go only within 24 hours, behind `PLATFORM_WHATSAPP_SEND_ENABLED`.

  Migration 55 was dry-run on a copy of the real local database. It is not applied yet.
- **Privacy notice** (`/legal/privacy`), a draft like the terms page.
- **Contract email (schema 56):**
  - the accepted terms text is frozen with each live order, and a copy is emailed once after the payment is confirmed;
  - the owner can download it from the payment history.

  Migration 56 was dry-run on a copy of the real local database. It is not applied yet.
- **Checks:** 684 platform tests, i18n and TypeScript pass.

## Delivered on 22 October 2026

- **Operator console** (`SAAS-OPERATOR-CONSOLE.md`): it shows go-live readiness without printing any values, plus a customer setup funnel that holds counts only. Only the operator session can open it.
- **Ready first week:** once the plan is approved, starter drafts appear with a placeholder first line. Publication refuses a draft until the team has rewritten it.
- **Live prepaid plans (schema 54)** (`SAAS-PAYTR.md`, "Live prepaid plans"):
  - Launch and Growth, paid monthly or yearly in USD, with a 7-day grace after a period ends;
  - no stored card and no automatic renewal;
  - rights open only from PayTR's signed, amount-matching notification;
  - pilot projects cannot buy a period.

  The code is off by default, and no live PayTR request was made. Migration 54 was dry-run on a copy of the local database (integrity ok, no foreign-key problems, repeatable). It is not yet applied to the real local database.

## Pre-launch configuration check - 21 October 2026

A read-only review of the local configuration (no secret values printed or
recorded here) found these items to close before any public launch, in addition
to the infrastructure list below.

| Priority | Item | State / action |
| --- | --- | --- |
| Critical | `ADMIN_PASSWORD` | A former hard-coded default remains in git history (`c48ac30`, `lib/auth.ts`; removed from code in `c3cb60d`). Set a new, long, unique admin password on every environment; it must not match any value that ever appeared in the repository. Rotating it is an owner action. |
| Critical | Public origins | `NEXT_PUBLIC_APP_URL` still points to `http://localhost:3033`; `PLATFORM_PUBLIC_ORIGIN` and `PLATFORM_AUTH_ORIGIN` are unset. Set them to the production HTTPS origin, otherwise OAuth callbacks, email links and unsubscribe links point to the wrong host. |
| Done (local) | Credential encryption key | `PLATFORM_ENCRYPTION_KEY` is now set locally to the same value as `data/platform-credentials.key` (23 October 2026), so nothing stored changed. In production supply it from the protected runtime config and back it up apart from database backups; never replace it without a credential migration. |
| High | Email feedback | `SES_SNS_TOPIC_ARN` and `SES_CONFIGURATION_SET` are unset: bounces and complaints are not received. Required before any real sending beyond the bounded pilot. |
| High | Backups | `npm run backup:platform` works (snapshots exist under `data/backups`), but no scheduled task is registered locally and backups live on the same disk. Register tasks with `deployment/windows/Register-RyzevoTasks.ps1` and point `PLATFORM_BACKUP_PATH` to an off-host destination. |
| High | HSS invitation | The local owner invitation expired on 20 October 2026, 22:44 Istanbul time; issue a new one when the owner is ready. |
| Done | Tracking signature | `TRACKING_SECRET` is now set separately (same value as the previous fallback, so links in sent emails stay valid). |
| Done | Local Claude settings | Permission rules that contained a provider password were removed from the git-ignored `.claude/settings.local.json`; the Crewin API password itself should still be rotated by the owner. |
| OK | Dependencies / history | `npm audit --omit=dev`: 0 findings. No `.env`, database, key or local settings file was ever committed. `AUTH_SECRET` and `CRON_SECRET` have adequate length. |

## Delivered on 21 October 2026

See `SAAS-PHASE5-MODULES.md` sections 7–11 for scope and safety details.

- **Messaging:**
  - separate reading, suggesting and publishing duties;
  - Telegram channel source reading;
  - WhatsApp template sending with its own consent, signed delivery receipts and STOP opt-outs;
  - an inbox for comments and Page/Instagram messages answered only after approval.
- **Ads:** Google Ads (Search) and LinkedIn next to Meta, with per-provider caps and plans.
- **Social formats:** single images on LinkedIn and X; Instagram Reels/Story and Facebook Page video from a team-hosted https file.
- **AI and planning:** AI suggestions that land only in the team's text box; provider-reported AI token usage (not a price); published, sourced reference values in the budget planner.
- **Accessibility:** keyboard support for all new tablists and one contrast fix.

### Pre-launch hardening (same day)

- **Production build:** `next build` passes with no warnings.
- **Security review:** a read-only review of the new code found five issues, all fixed and covered by tests:
  - ad *create* and *start* now claim the plan before any provider call (schema 52: `creating`/`starting` states), so double clicks cannot create duplicate campaigns and two starts cannot pass the monthly cap together;
  - pause waits for a running start, and interrupted claims are settled after ten minutes;
  - start, pause and spend use the plan's own ad account; connecting Google Ads needs the approval right, and only one Google Ads account stays active;
  - a queued WhatsApp batch stops when its approver loses the approval right;
  - nobody can change their own messaging duties, and only a project owner gives the publish duty.
- **Checked as fine:**
  - webhook signature and verify-token handling;
  - send-once claims for WhatsApp and inbox replies;
  - GAQL inputs;
  - video and upload URL handling;
  - no secrets in URLs, logs or audit rows.
- **Schema:** migration 52 was dry-run on a copy and then applied with the owner's go-ahead (backup at schema 51 first); the local `data/platform.sqlite` is at schema 52. `MAX_RECOVERY_SCHEMA` is 52.
- **Not checked against real services:**
  - Telegram, Meta, WhatsApp, Google Ads, LinkedIn ads and SES;
  - every new provider path was tested only with disposable stubs and the isolated QA fixture.

### Optional additions (same day, schema 53)

See `SAAS-PHASE5-MODULES.md` section 12.

- **Social formats:** Instagram image Story, Facebook Reels, and a video in campaign drafts.
- **WhatsApp:** templates with an image, video or document header and one URL button.
- **Inbox:**
  - automatic reading every 30 minutes;
  - instant updates through one signed Meta webhook (`/api/platform/meta/hooks`, an exact-path middleware exception);
  - X replies and LinkedIn personal profile comments, each behind its own server switch.
- **Fix:** LinkedIn comment times are now read, so company page comments are no longer skipped.
- **Legacy Crewin screens (accessibility, with the owner's go-ahead):**
  - modals and the activity slide-over move focus in, keep Tab inside, close on Escape and return focus;
  - the JobBot job row and the logo controls are real buttons;
  - visible labels are linked to their controls;
  - errors are announced and icon-only buttons have names;
  - tab bars follow the ARIA tabs pattern and toggles report their state;
  - weak focus rings are stronger;
  - light-mode grey text moved from slate-400 to slate-600, and dark-mode text from slate-500 to slate-400; dark panels are unchanged;
  - checked with `tsc`, the platform tests and a production build;
  - not opened in a browser, because the legacy tabs call the real Crewin backend.
- **Checks:** 633 platform tests pass.
- **Schema:**
  - migration 53 was dry-run on a copy, then applied after a backup at schema 52;
  - the local `data/platform.sqlite` is at schema 53;
  - `MAX_RECOVERY_SCHEMA` is 53.
- **Not checked against real services:** the Meta webhook, Reels, media WhatsApp templates, X search and LinkedIn member comments.

## Delivered on 19 October 2026

- **Growth coach** for standard projects (see `SAAS-GROWTH-COACH.md`):
  - growth diagnosis, an approved strategy brief and weekly actions;
  - monthly content plan, SEO topics and briefs, weekly review and its email;
  - learning loop: outcomes by week and source, monthly renewal, task owners.
- **Phase 5 shared modules** (see `SAAS-PHASE5-MODULES.md`):
  - SEO operations: site scan, findings without duplicates, Search Console opportunities;
  - lifecycle automation on segments, with approval and the email pilot;
  - B2B prospects with source URL, check date and evidence;
  - a Telegram channel target for social publishing;
  - Meta ad management: caps, exact approval, campaigns created paused, explicit start behind `PLATFORM_ADS_ENABLED`;
  - a budget and goal planner: assumption ranges, calibrated with this project's measured Meta, Search Console and GA4 values.
- **Schema 45.** Migrations 43–45 were dry-run on a copy of the local database and later applied (see 21 October).
- **Tests:** 582 platform tests pass; TypeScript and i18n checks pass.
- **Checked against real services:**
  - Gemini output on the coach paths and prospect evidence;
  - the GA4 and Search Console read pipeline through a service account;
  - a public HTML scan of example.com and public prospect pages.
- **Not checked against real services:** a Telegram bot posting to a real channel, a real Meta ad account, and SES sends from automations or the weekly review.

## Delivered on 18 October 2026

- Added a personal, resumable Growth Compass for standard Ryzevo projects.
  Reuses existing goals, campaigns, provider connections, Calendar and reports.
  Includes first-login needs selection, contextual account/permission guides and
  deduplicated explicit setup handoffs. Actual evidence, role restrictions and
  rehearsal/live distinctions drive progress; no external send is automatic.
  Schema 30, 467 regression tests, production build and HTTP checks pass.
  Chrome first-login/mobile/viewer flows passed; final tablet/last-build visual
  recheck is pending because browser control was disabled in Work settings.
  See `SAAS-GROWTH-COMPASS.md` for scope, safety and acceptance details.

- Replaced the vulnerable Tailwind 3 build chain with Tailwind/PostCSS 4.3.3.
  Kept the existing Crewin palette config and compatibility utilities. Full npm
  audit is now zero reported vulnerabilities, not a security certification.
- CSS contract regression covers legacy/shared classes. Desktop mobile-menu
  visibility is explicit, light-theme muted text/placeholder contrast improved.
  Normal muted text against the sampled workspace surface measures 5.22:1.
- Trusted configured-origin login helper avoids using a client-selected redirect
  host. No configured origin keeps legacy behavior. Actual IIS acceptance remains.
- Windows/Node-22 launch preflight, existing worker/backup/monitor wrappers,
  least-privilege task registration and aggregate Event Log integration prepared.
  Installer has WhatIf/confirmation support, never overwrites tasks or starts them.
  No EC2 task, certificate, IIS, role, firewall or access grant was changed.
- HSS Digital proposed profile and two business journeys reuse existing standard
  project/goal APIs. Temporary pilot checks draft/task scope isolation and zero
  invented measurements. The actual customer account is not silently provisioned.
- Existing isolated container harness now accepts 30-1800 seconds, with bounded
  request count and application-process RSS observations. It uses no external
  network, host data mount, published port or actual provider credentials.

## What is still not complete

| Area | State and next prerequisite |
| --- | --- |
| EC2 Windows operation | Target is confirmed, but no authorized host session/configuration was supplied. Node-22 native install/build, private EBS/ACLs, HTTPS/IIS and task/reboot acceptance must run there. Local tests and the Linux image cannot close it. |
| Disaster recovery/alerts | Local seal/verify/drill and Windows probe are prepared. Actual private off-host destination, account/KMS/retention policy, CloudWatch or equivalent notification destination and failure/recovery acceptance remain. Local Event Log is not a delivered alert. |
| HSS Digital | Proposed journeys and isolated QA exist. Owner identity/invitation, business review, real property/account grants and successful source events plus user acceptance remain. No HSS source project was supplied for its event producers. |
| Email/onboarding | Existing SES/consent/allowlist/identity code is default OFF. Separate Ryzevo domain/account setup and authorized successful/failure/opt-out pilots remain. |
| Google/social | Facebook photo, Instagram ordered 2-5 image carousel and receipt-bound Facebook/Instagram/X/LinkedIn-organization engagement adapters now extend the existing center. Real project-specific grants, permissions and controlled provider-backed acceptance remain. Video/Reels/Stories, LinkedIn/X image uploads and comment/DM workflows are not implemented. See the social format record. |
| Paid subscriptions | Live prepaid periods are implemented (schema 54, behind `PLATFORM_PAYTR_LIVE_ENABLED` and `PLATFORM_BILLING_TERMS_URL`). The renewal window, grace and fallback are covered too. The switch stays off until a few things exist: the PayTR merchant contract with USD approval, a published distance-sales contract page, and one operator-run real purchase with a manual refund. Not implemented: automatic recurring charges, stored cards, in-app cancellation or refund, and fiscal invoicing (invoices stay manual). |
| Phase 5 provider acceptance | Telegram bot, Meta ad account (create, start, pause, insights) and automation email sends are implemented with approval and server switches. Each needs the operator's own account and an approved live test. Google Ads, LinkedIn ads and WhatsApp targets are not implemented. |
| Accessibility/capacity | Sampled Chrome keyboard/mobile/tablet/desktop flows passed. Screen-reader/real-device and full legacy-module/contrast acceptance remain. Bounded local load is not production capacity, long-duration stability or internet-facing abuse certification. |

## Single operator input list

Latest owner confirmation (18 October 2026): EC2 access is **not ready**;
Ryzevo SES, Google/Meta/LinkedIn grants and PayTR USD merchant approval are
**not ready**. No deployment, provider-backed acceptance, live billing or real
device delivery can be closed from local fixtures. The owner delegated the HSS
pilot scenario/account preparation. The selected HSS journey and reserved local
invitation username are recorded in `HSS-DIGITAL-PILOT.md`; actual account
activation requires the human to set their own password through the existing
invitation page. Explicit scoped access approval was received and the local owner
invitation was created and verified. It expires 20 October 2026 at 22:44 Istanbul
time; its token is in the ACL-protected, Git-ignored local handoff file only.
The owner cannot activate it now. No HSS user/project has yet been created, and
it must not be reported as an existing activated account or accepted live pilot.

The latest local increment adds an integrated HSS compass -> consented fixture
audience -> approved campaign -> no-send rehearsal -> sourced measurement test.
469 platform tests pass, with TypeScript, production build and production HTTP
acceptance successful. The actual local invitation inspect API returned 200 for
the approved username/new-organization scope, without submitting activation or
printing the token. The private handoff directory ACL was verified to include
only the current Windows user and SYSTEM, with no inherited grants. New
invitation links use a URL fragment rather than putting the token in the server
request URL; previous query links continue to work. Public project setup fields
can be prefilled without granting access. Browser control remains disabled, so
the pending tablet/last-build visual check is still open.

The existing offline recovery drill also passed against the schema-30 local
backup: integrity and foreign keys are valid, app/worker were not started, no
provider was contacted and no production restore occurred. This local snapshot
contains zero encrypted provider records; it is not an off-host AWS/KMS or live
credential disaster-recovery acceptance.

Already answered: AWS EC2 **Windows**, first business **HSS Digital**, website
**www.hssdigital.com**. Do not ask for those again.

Supply access privately, not secrets in chat:

1. Authorized EC2 deployment access, Windows version/region, private durable volume,
   DNS/TLS plan and confirmation of any shared IIS/Crewin constraints.
2. Dedicated backup destination/account/encryption/retention and alert destination.
3. HSS owner identity and permission to complete the existing invitation flow;
   approved business journey and customer-owned Google/social/sender grants.
4. Separate Ryzevo SES identity/DNS and explicitly authorized pilot recipients.
5. PayTR merchant/USD contract, a published distance-sales contract page
   (`PLATFORM_BILLING_TERMS_URL`) and the fiscal-invoice approach before the live
   billing switch is turned on. No live charge, mandate, refund or paid access
   may be inferred from sandbox success or a browser return page.
6. Access to real-device/screen-reader and supervised production failure testing.

No secret, personal recipient list or provider key should be committed into the
release, fixture, audit report, screenshot or chat. Actual access expansion,
publication, payment and deployment still require the appropriate operator action.

## References and acceptance records

- [Windows EC2 runbook](SAAS-WINDOWS-EC2.md)
- [HSS Digital pilot](HSS-DIGITAL-PILOT.md)
- [Runtime acceptance](SAAS-RUNTIME-ACCEPTANCE.md)
- [Responsive acceptance](SAAS-RESPONSIVE-ACCESSIBILITY.md)
- [PayTR boundaries](SAAS-PAYTR.md)
- [Social formats and engagement](SAAS-SOCIAL-FORMATS.md)
- [Official Tailwind migration guide](https://tailwindcss.com/docs/upgrade-guide)

Windows scripts/XML were syntax checked and pure configuration checks tested.
The host development Node remains 20; the Windows deployment preflight intentionally
requires 22. Nothing was globally upgraded or deployed to EC2.

Previous release local results: TypeScript and production build passed; 402 platform tests
passed on Windows and in the offline Linux image (zero skips/failures); production
HTTP acceptance passed. Five-minute isolated soak completed 4,645 mixed requests
with zero unexpected failures, plus encrypted backup/restore and abuse/regression
checks. See the extended runtime record for exact budgets and RSS observations.
Chrome verified HSS draft saving, actual public HTML audit -> QA work-plan/calendar
linkage, responsive views and final landing scene pixel changes/nonblank mobile
rendering. Temporary QA was stopped; the main 3033 panel remains running.

## Social extension follow-up

Facebook photo and Instagram ordered carousel publication now reuse the existing
queue and encrypted snapshots. Four provider-specific read-only engagement
adapters use stored receipts, account ownership checks, cooldown/quotas and schema
28 last-success storage. See the social format record for the exact boundaries.

## Mobile growth follow-up

Schema 29 adds a standard-project mobile operation center: scoped application
profiles, ASO snapshots/tasks, normalized attribution and RevenueCat observations,
90-day bounded mobile event retention, consented pilot push/in-app jobs and Branch
link/association preparation. Existing vault/events/campaigns/calendar/worker are
reused. Firebase, OneSignal, AppsFlyer, Adjust, Branch and RevenueCat are covered
with explicit adapter boundaries, not silently connected accounts. Both mobile
live-send and Branch-create gates default OFF. Native app SDK/consent, provider
grants, real-device delivery and store purchase/deferred-link acceptance remain.
This does not implement live Ryzevo billing or replace the Crewin pack.
See [mobile growth contracts and acceptance](SAAS-MOBILE-GROWTH.md).

Current follow-up verification: 418 Windows platform tests (16 new cases), zero
failures/skips; TypeScript, production build and production HTTP tests passed.
Chrome checked carousel reorder/save and both media rehearsals, plus 320/390/768/
1440 responsive views. No real social publication or metrics collection occurred.
The earlier Linux/soak results above remain historical, not rerun claims for this
increment. Live permissions/provider acceptance and the remaining release gates
in the table above are still open.
