# Faz 5: shared modules for standard projects (October 19, 2026)

Roadmap Phase 5: make the shared modules work end to end for standard (non-Crewin) projects, one at a time.

Social publishing (LinkedIn, Facebook, Instagram, X) existed before this phase. This phase adds:
- SEO operations;
- lifecycle automation;
- B2B prospects;
- a Telegram channel target for social publishing;
- ad management.

All of it lives in the modular monolith and reuses existing pieces: RBAC, encrypted connections, the job queue and worker, segments, consent and suppression, campaign review, the email pilot, the social pipeline and the Calendar.

None of the modules publishes, sends or spends on its own:
- every outward action needs a person's approval;
- real sends and spending stay behind the existing server switches;
- Crewin legacy routes, tabs and data are untouched.

## 1. SEO operations (SEO & Blog → Site scan, Search opportunities)

### Scan

- **What it reads:** up to 20 pages of the project's own site. It uses the sitemap, or home-page links when there is no sitemap. Only the public HTML is read, with the existing SSRF-safe audit engine (`lib/site-audit.ts`).
- **Quota:** one audit credit per scan.
- **How it runs:**
  - The page drives the scan one page per request; each page is leased, so several tabs are safe.
  - If the tab closes, the worker continues the scan (`advanceSeoScans`).
  - A changed project website cancels a running scan.
  - The worker cancels a scan if its starter loses content rights.

### Findings (schema 40)

Tables: `platform_seo_scans`, `platform_seo_scan_pages`, `platform_seo_findings`, `platform_seo_finding_events`.

- **Identity:** a finding is identified by page, category and rule title. robots.txt and sitemap findings are counted once per site.
- **State changes:**
  - a new finding is **detected**;
  - a fixed finding that comes back is **reopened**;
  - an ignored finding stays ignored when it is seen again;
  - a finding is **fixed** only when its page was audited successfully in a completed scan and the finding no longer appears.
- **What never marks a fix:** a page that failed to load, or a cancelled scan.
- **History:** every change is an event: detected, fixed, reopened, ignored, restored or planned.
- **Work plan:** "Add to work plan" creates **one** Calendar task per finding while that task is open. The site is never changed.
- **Coach and Compass:** completed scans write the same audit receipts as the single-page audit, so the coach and the Compass see the audit.

### Search Console opportunities

- **Source:** the coach's stored query snapshot. Only members who manage connections see query rows.
- **Fixed rules:**
  - average position 8–20 with at least 20 impressions → "close to page one";
  - top 5, at least 50 impressions and CTR under 2% → "ranks high, few clicks".
- **Numbers:** only the numbers Search Console reported; no forecasts.

**Files:** `lib/platform/seo-operations.ts` and `seo-operations-types.ts`; `app/api/platform/seo`; `components/platform/SeoOperations.tsx` and `SeoOpportunities.tsx`; the tab views are in `ProjectAudit.tsx`.

## 2. Lifecycle automation (Campaigns → Automations)

### Rule and enrollment

- **Trigger:** a contact joins a saved segment, or a product event arrives.
- **Wait:** 0–30 days, then checks.
- **Exits:**
  - the goal event arrives;
  - the contact leaves the segment (optional);
  - the contact can't be emailed (no consent, suppressed or invalid).
- **Loops:** each contact enters a rule only once (`UNIQUE(automation_id, entity_id)`).
- **Frequency cap:** 1–90 days per contact across all of the project's rules. A capped contact waits; it is not dropped.

### Approval and sending

- **Approver:** the email pilot manager (approval, connection and recipient rights).
- **Rehearsal:** checks recipients and sends nothing.
- **Real send:** uses the existing email pilot. Before queueing, the campaign must still be approved and its preflight is refreshed.
- **Pilot queue change:** `EmailPilotQueue.enqueue` gained an optional `onlyEmailKeys` filter. Consent, suppression, allowlist, at most 5 recipients, daily reservations and the SES switch apply unchanged.

### Permissions, worker and storage

- **Permissions:** activation needs the approval right. Any writer can pause.
- **Worker:** `evaluateDueAutomations` only does bookkeeping (enrollments and exits), at most every 6 hours per rule. It never sends. A rule whose activator lost the right is paused.
- **Schema 41:** `platform_automations`, `platform_automation_enrollments`, `platform_automation_runs`.

**Files:** `lib/platform/automations.ts` and `automation-types.ts`; `app/api/platform/automations`; `components/platform/ProjectAutomations.tsx`.

## 3. B2B prospects (Campaigns → B2B prospects)

- **Separate list:** it is not mixed with the product's own users.
- **What is stored:** companies the team enters (name, website, sector, country, fit reason, suggested contact **role**).
- **Never stored:** personal data. Email addresses, phone numbers and handles are refused.

### Evidence and AI

- **Website check:** reads the company's own public page with the same safe fetcher. It stores the final address, title, summary, an evidence line and the check time. A redirect to another site counts as unreachable. Limit: 50 checks a day.
- **Optional AI fit reason:** the quote must appear word for word on the fetched page, and roles only, never names. A broken or rule-breaking answer is rejected and refunded.
- **Real-Gemini check:** 4/4, verbatim quotes, honest "weak fit" for unrelated organizations.

### Decisions

- **Approval:** needs a checked page, a written reason and the approval right. Editing the reason sends the prospect back to "candidate".
- **Outreach:** an approved prospect becomes one Calendar task. Nothing is sent to anyone.

**Schema 42:** `platform_prospects`.

**Files:** `lib/platform/prospects.ts` and `prospect-types.ts`; `app/api/platform/prospects`; `components/platform/ProjectProspects.tsx`.

## 4. Telegram channel publishing (existing social pipeline)

### Connection

- The project connects its own bot: BotFather token plus the channel's `@username` or `-100…` id, entered in Project settings → Connections.
- The connection check confirms the token belongs to a bot and the target is a **channel**; groups are refused.

### Publishing

- **Publish proof:** the bot is an administrator with "Post messages" (`getChatMember`).
- **Content:** text only, up to 4096 characters. Content drafts and AI drafts can target the `telegram` channel.
- **Same rules as other providers:** rehearsal, approval, acknowledgement, the `PLATFORM_SOCIAL_PUBLISH_ENABLED` switch, scheduling, 5 posts a day, and the duplicate-text guard.
- **Result:** the post link is `t.me/<channel>/<message>`. Engagement is reported as unsupported.
- **Privacy:** the bot never reads private chats or groups.
- **Token:** stored encrypted. It is used only in the Bot API path, never in logs or in browser responses.

**Schema 43:** `platform_social_accounts` rebuilt so its platform list includes `telegram`; all rows kept.

**Files:** `lib/platform/telegram-publishing.ts`; the platform lists in `social-publications.ts`, `social-configuration.ts` and `social-connection.ts`; content whitelists; `ProjectConnections` and `SocialPublicationCenter`.

## 5. Ad management (Campaigns → Ads)

### Account and budget

- **Account:** the project connects its own Meta ad account with a system-user token. The token is checked against the account and stored encrypted. The currency comes from Meta.
- **Caps:** daily per plan and monthly total, in the account currency. Setting them needs connection management and approval rights.

### Plans

- **Objectives:** awareness or traffic, with an optional special ad category.
- **Limits:** an end date is required (at most 31 days); daily budget ≤ daily cap; daily × days ≤ monthly cap; 1–10 countries; https link.
- **Approval:** each plan is approved on its exact content. An edit clears the approval.

### On Meta

- **Create:** the campaign and ad set are created **PAUSED**. Creatives are added in Ads Manager.
- **Start delivery requires all of:**
  - an explicit acknowledgement;
  - `PLATFORM_ADS_ENABLED=1`;
  - an unchanged approval;
  - the daily cap;
  - this month's planned spend of running plans plus this plan within the monthly cap.
- **Failed start:** the campaign is paused again.
- **Pause:** always allowed to any writer.
- **Spend:** shown only as Meta reports it.

### Graph client and storage

- **Graph client:** fixed host, token only in the `Authorization` header, path allowlist.
- **Schema 44:** `platform_ad_policies`, `platform_ad_plans`.

**Files:** `lib/platform/ad-manager.ts` and `ad-types.ts`; `app/api/platform/ads`; `components/platform/ProjectAds.tsx`.

## Tests and verification

- **Tests (in `test:platform`):**
  - `platform-seo-operations`, `platform-automations`, `platform-prospects`, `platform-telegram-publications` and `platform-ads` `.test.cjs`;
  - recovery and schema fixtures updated.
- **Recovery:** `MAX_RECOVERY_SCHEMA` is 44.
- **Browser QA** on isolated fixtures, TR/EN, 375–1440, light/dark:
  - a real public-HTML scan of example.com, a rescan without duplicates, one work item, opportunities, and viewer read-only;
  - an automation created, activated, evaluated (21 enrolled) and rehearsed (pilot limit 3; send disabled without SES);
  - a prospect checked against a real public page;
  - the Telegram connection form;
  - ad caps, approval and the paused-on-Meta state, with start disabled.
- **QA fixture flags:** `--ads` (fake ad account, no Meta call) and the `ryzevo-automation-qa` and `ryzevo-ads-qa` launch configurations.
- **Not verified against real providers:**
  - a Telegram bot posting to a real channel;
  - a real Meta ad account (create, start, pause, insights);
  - a real email send from an automation (needs SES).

  Each needs the operator's own account and an approved test.
