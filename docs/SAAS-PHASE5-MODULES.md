# Faz 5: shared modules for standard projects (October 19, 2026)

Roadmap Phase 5: make the shared modules work end to end for standard (non-Crewin) projects, one at a time.

Social publishing (LinkedIn, Facebook, Instagram, X) existed before this phase. This phase adds:
- SEO operations;
- lifecycle automation;
- B2B prospects;
- a Telegram channel target for social publishing;
- ad management;
- a budget and goal planner;
- messaging sources with separate duties;
- WhatsApp template sending.

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

## 6. Budget and goal planner (Analytics)

Answers questions such as "roughly what would SEO or Meta ads cost, and how many leads could that bring?" with arithmetic on the team's own assumptions. It is not a forecast: no industry averages or benchmarks are built in, and every result says so.

### Views

- **Ads (Meta):** budget, cost per click and click-to-lead conversion; optionally lead-to-customer rate and revenue per customer (for ROAS). Clicks = budget ÷ CPC.
- **SEO:** monthly hours × hourly rate, tools, and content pieces × cost per piece; today's monthly organic clicks and a change range. Clicks = today's clicks × (1 + change).
- **Budget from a goal:** the ad budget a lead target needs under the CPC and conversion ranges.

### Ranges and results

- **Ranges:** every assumption is a min–max range.
- **Results:** three columns.
  - **Worst:** combines the worst end of every range (highest CPC, lowest rates).
  - **Middle:** uses the midpoints.
  - **Best:** combines the best ends.
- **Never shown:** customers and ROAS are left out unless their rates are given. A cost per lead or customer is shown as "—" when there is nothing to divide by.
- **Sensitivity:** the planner names the assumption that moves the middle lead count most (each range swung alone), so the team knows what to measure first.

### Calibration with measured data

Values measured for this project can replace an assumption with one click. Each shows its source and period, and the label is saved with the scenario. Editing the field by hand removes the label.

| Value | Where it comes from |
|---|---|
| Cost per click and click-through rate | Meta-reported spend, clicks and impressions across this project's ad plans in one currency. Ad spend refresh now also stores impressions and clicks. |
| Organic clicks per day | The latest automatic Search Console "clicks" reading, divided by its period length. It can be used as × 30 days. |
| Stage-to-stage conversion | Automatic readings of the same goal, source and period (for example key events ÷ sessions). Only readings whose mapping still matches the goal as it is today count. Manual entries are not used. |

### Scenarios and storage

- **Scenarios:** saved per project, at most 30.
- **Who can do what:** viewers can read; writers can save, update (with a revision check) and delete. Opening a scenario and saving updates it; "Save as new" copies it.
- **Audit:** `budget.scenario.save`.
- **Schema 45:**
  - `platform_budget_scenarios`;
  - `impressions` and `clicks` on `platform_ad_plans`.

**Files:** `lib/platform/budget-math.ts` (pure, client-safe), `budget-planner.ts`; `app/api/platform/budget`; `components/platform/BudgetPlanner.tsx` (in Analytics, standard projects only).

## 7. Messaging sources and duties (Campaigns → Messaging)

Roadmap item 5: messaging sources per project, with reading, content suggestion and publishing as separate permissions.

### Duties

| Duty | Base permission it needs | What it allows |
|---|---|---|
| Read sources | read | See stored channel posts, read now, turn on automatic reading |
| Suggest content | content write | Write a suggestion, create a Telegram content draft, hide posts, edit the sector dictionary |
| Publish | connections, approval and dispatch | Queue a real Telegram channel post |

- **Who holds them:** project owners hold every duty they are eligible for. Everyone else, admins included, is given each duty on purpose by someone who manages members.
- **Publish duty:** checked when a real Telegram post is queued and again when the job runs. Taking it away while a post is queued stops the post. Rehearsals do not need it.
- **Reading duty:** taking it away also turns off automatic reading that person enabled.
- **Audit:** every grant and revoke is audited.

### Telegram sources

- **Which channels:** only channels the project's own bot was added to by that channel's administrator. Groups and private chats are refused, and private updates are skipped without being stored.
- **How posts are read:** through the Bot API (`getUpdates`, `channel_post` only), with one offset per bot.
- **What is stored:** the chat id, message id, date and text or caption. Before storing, emails, phone numbers and @handles are masked. Author signatures and sender fields are never read into storage.
- **Automatic reading:** Telegram keeps waiting posts about 24 hours, so a source can be read every 30 minutes by the worker, as the person who turned it on.
- **Limits:** 100 reads per project per day, 10 sources; posts are deleted after 90 days.
- **Webhook:** a bot with a webhook cannot be read; the UI says so.
- **Sector dictionary:** up to 20 topics with up to 30 terms each. Posts are tagged with every topic whose term they contain, and saving the dictionary re-tags stored posts.

### Suggestions

- **What a suggestion is:** the team's own text inspired by a post, never a copy.
- **Draft:** "Create Telegram draft" saves that text as a Telegram content draft. The source link is kept in the draft's prompt field.
- **Publishing:** goes through the existing social publishing flow, with approval and the publish duty.
- **Not done:** AI-written suggestions.
- **Never added:** reading through a user account, joining groups, or collecting contact details. The legacy Crewin userbot modules stay in the Crewin pack.

### Storage

- **Schema 46:**
  - `platform_messaging_duties`, `platform_messaging_settings`, `platform_messaging_sources`, `platform_messaging_offsets` and `platform_messaging_posts`.

**Files:** `lib/platform/messaging-sources.ts`, `messaging-duties.ts`, `messaging-types.ts`; readers in `telegram-publishing.ts`; `app/api/platform/messaging`; `components/platform/ProjectMessaging.tsx`; worker step in `app/api/platform/worker`.

## 8. WhatsApp template sending (Campaigns → WhatsApp)

WhatsApp has no channel broadcast API. The Cloud API sends messages to individual people, outside a 24-hour reply window only with Meta-approved templates. So WhatsApp is a consented, template-based sending channel, not a publishing target.

### Number and templates

- **Number:** the project connects its own WhatsApp Business number:
  - a phone number ID, a WhatsApp Business account (WABA) ID and a system-user token;
  - the token must see the number, and the number must belong to that WABA;
  - the token is stored encrypted;
  - replacing the number cancels open batches.
- **Templates:** fetched from Meta. Only `APPROVED` marketing or utility templates whose variables are all in the body are kept. Media headers, dynamic buttons and authentication templates are left out.

### Contacts and consent

- **Separate consent:** contacts are added with their own WhatsApp consent: an evidence reference, a consent date that is not in the future, and an explicit acknowledgement. Email consent never counts.
- **Numbers:** must be international (E.164). Each is stored encrypted, de-duplicated by a keyed hash, and shown only as a hint (`+90•••67`).
- **Opt-out:** permanent for that number in the project. Pending messages to it are skipped.
- **Limits:** 500 contacts, 100 per add.

### Batches

- **Draft:** a batch is one template, its fixed variables (single-line text) and 1–20 contacts. It is approved on its exact content, and any edit clears the approval.
- **Rehearsal:** checks every message without contacting WhatsApp.
- **Real send requires all of:**
  - `PLATFORM_WHATSAPP_SEND_ENABLED=1` (default off);
  - dispatch rights and the "publish" messaging duty;
  - an explicit acknowledgement;
  - the daily limit (50 messages per project).
- **One message at a time:** the worker (or "Process now") sends messages one by one. Each is re-checked just before it goes: approval, the queuing person's duty, the number and consent. Each is marked as submitted before the network call.
- **Message results:** an interrupted send is recorded as uncertain and never repeated. Meta's answer is recorded as accepted (with the message id), rejected or uncertain.
- **Cost:** Meta bills each template message by category and country. No price is stored, shown or estimated; the UI points to the WhatsApp Business billing screen.

### Not done

- Delivery and read receipts.
- Inbound replies and STOP handling through webhooks: opt-outs are recorded by the team.
- Per-recipient personalisation.
- A real-account acceptance.

### Storage

- **Schema 47:**
  - `platform_whatsapp_templates`, `platform_whatsapp_contacts`, `platform_whatsapp_batches`, `platform_whatsapp_messages`.

**Files:** `lib/platform/whatsapp.ts`, `whatsapp-types.ts`; `app/api/platform/whatsapp`; `components/platform/ProjectWhatsApp.tsx`; worker step in `app/api/platform/worker`.

## Tests and verification

- **Tests (in `test:platform`):**
  - `platform-seo-operations`, `platform-automations`, `platform-prospects`, `platform-telegram-publications`, `platform-ads`, `platform-budget-planner`, `platform-messaging` and `platform-whatsapp` `.test.cjs`;
  - recovery and schema fixtures updated.
- **Recovery:** `MAX_RECOVERY_SCHEMA` is 47.
- **Browser QA** on isolated fixtures, TR/EN, 375–1440, light/dark:
  - a real public-HTML scan of example.com, a rescan without duplicates, one work item, opportunities, and viewer read-only;
  - an automation created, activated, evaluated (21 enrolled) and rehearsed (pilot limit 3; send disabled without SES);
  - a prospect checked against a real public page;
  - the Telegram connection form;
  - ad caps, approval and the paused-on-Meta state, with start disabled;
  - the budget planner: measured values used, a scenario saved, updated, saved as new and deleted, and no overflow at 375 px;
  - messaging: a draft created from a suggestion, a post hidden, a reading duty given to an editor (publish not offered for that role), the dictionary edited, TR/EN and no overflow at 375 px;
  - WhatsApp: an approved batch rehearsed (no call to Meta), a draft approved, an opt-out removing that contact from new batches, the switch-off state shown, TR/EN and no overflow at 375 px.
- **QA fixture flags:**
  - `--ads` (fake ad account, no Meta call);
  - `--budget` (with `--ads`: fake Meta totals and stub GA4 and Search Console readings);
  - `--messaging` (fake bot, one source, stored posts, an editor without duties);
  - `--whatsapp` (fake number answered by a stub Graph client, fixture contacts, an approved and a draft batch);
  - the `ryzevo-automation-qa`, `ryzevo-ads-qa`, `ryzevo-budget-qa`, `ryzevo-messaging-qa` and `ryzevo-whatsapp-qa` launch configurations.
- **Not verified against real providers:**
  - a Telegram bot posting to a real channel;
  - a real Meta ad account (create, start, pause, insights);
  - a real email send from an automation (needs SES);
  - Telegram source reading with a real bot;
  - a real WhatsApp Business number (templates, a send, an opt-out).

  Each needs the operator's own account and an approved test.
