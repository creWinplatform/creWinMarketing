# Ryzevo release status - 20 October 2026

The core monolith is suitable for continued isolated testing. It is NOT yet an
accepted public/paid production service. An implementation, a local fixture test
and an operator-approved live acceptance are different milestones.

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
- **Schema 45.** `MAX_RECOVERY_SCHEMA` is 45. Migrations 43–45 were dry-run on a copy of the local database (integrity and foreign keys valid). The local `data/platform.sqlite` is still at schema 42 and moves to 45 the next time the signed-in app opens it; a backup at schema 42 exists.
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
| Paid subscriptions | Sandbox checkout/callback/inquiry and catalog/quotas exist. Live paid activation, renewal, cancellation, reconciliation and fiscal invoicing are NOT implemented or enabled. Merchant account and approved USD/recurring/tokenization contract plus pricing/entitlement/fiscal decisions are prerequisites to finish those adapters safely. This is not merely a missing API key. |
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
5. PayTR merchant/USD/recurring contract and fiscal-invoice approach before live
   billing implementation/acceptance. No live charge, mandate, refund or paid access
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
