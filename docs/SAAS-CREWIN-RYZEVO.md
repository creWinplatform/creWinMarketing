# Ryzevo features in the Crewin workspace (29 October 2026)

## Decision
Ryzevo's features that Crewin had no tool for are now open in the Crewin workspace. Where Crewin already has its own tool, that tool stays:
- campaigns
- content library
- post calendar
- prospects
- ads
- automations
- WhatsApp / Telegram
- social publishing

The workspace still opens with the single Crewin login. Team accounts are a separate step.

**Why not convert Crewin into a standard project:**
- A platform session would cut the 17 Crewin tabs off. The middleware blocks every legacy API for platform sessions.
- The four shared routes (campaigns, content history, connections, automation) would switch from the Crewin backend to empty SQLite tables.
- Setting the pack to `standard` fails plan validation (no entitlement row) and drops the Crewin-only tabs.

## How it works
- **Access:** `getRyzevoAccess` (`lib/platform/workspace-server.ts`) accepts a platform session, or the legacy session of `legacy-admin` on `crewin/crewinjob`.
  - `coachRoute` and the routes of the opened features use it: alerts, approvals, push, compass, measurements, monthly-report, operations, google, meta and their callbacks.
  - Every other route keeps its platform-only check.
- **Features:** `ryzevoFeature(pack, feature)` (`lib/platform/ryzevo-features.ts`) is the single rule.
  - Standard projects get everything.
  - Crewin gets: coach, compass_api, brand, seo_ops, ai_visibility, alerts, push, approvals, measurements, monthly_report, budget, inbox, connections_google, connections_meta.
  - The stores of these features, and their worker steps, use it instead of `productPack==='standard'`.
- **Connections:** `marketing-routes.ts` `context()` still returns null for legacy sessions, so the Crewin tabs keep their data sources.
  - Only Project settings → Connections asks for the Ryzevo store explicitly (`?store=ryzevo`). There, Crewin can list, verify and revoke its Google and Meta connections.
  - Generic connection saves are refused for Crewin.
- **Quota:** the Crewin entitlement has no limits (`Infinity`). Usage is still recorded in `platform_usage_reservations`.
- **Coach on Crewin data** (`lib/platform/coach-activity.ts`):
  - Activity counts come from `data/content-history.json` and `data/post-history.json`. Ad drafts do not count as channel posts.
  - Channels Crewin already reaches count as connected: legacy social tokens, SMTP, WhatsApp, ad accounts.
  - No starter drafts are written to the platform library.
  - Coach actions open Crewin tabs. Social accounts → Social media, email → WA & Telegram → Email re-activation, ads → Ad content.
- **Monthly report:** for Crewin, posts come from its post history. There are no engagement or site figures, and none are made up.
- **Measurements:** product-data event sources exist only in standard projects. Crewin's measurements come from GA4 and Search Console.
- **Brand voice:** `repository.updateBrandVoice` stores only the brand voice. Crewin's name, site and goals stay with its adapter.
- **Shared file summaries:** `lib/platform/file-summary.ts` re-reads a large JSON file only when it changes. The job guide and the coach both use it.

## Where things are in Crewin
- **Overview:**
  - under the heading: "What would you like to do?", Needs attention, Decisions waiting;
  - after the Crewin figures: Growth coach, Weekly review, Monthly refresh, My assigned work.
- **SEO & Blog:**
  - new sub-tabs: Automatic scan (`?view=ops`), Search opportunities, AI visibility, SEO topics;
  - the Crewin tools (blog, site audit, low-CTR report…) are unchanged.
- **Campaigns → Inbox** (`?view=inbox`).
- **Analytics:** below the Crewin charts: source-linked measurements, the monthly report and the budget planner.
- **Calendar:**
  - Post calendar (Crewin's own) and "Work and content plan" (Ryzevo work items from the coach and SEO findings, plus the coach's content plan);
  - `?view=work` or the coach's `?planning=content` opens the plan;
  - there is no social publication queue for Crewin.
- **Project settings:**
  - Connections: Google (GA4, Search Console) and Meta only, with a note saying the Crewin tools keep their own accounts;
  - Brand voice & competitors.
- **Job guide:**
  - four new jobs: growth strategy, appear in ChatGPT and Gemini, automatic tracking on Google, answer comments and messages;
  - a monthly-report step in the results job;
  - missing server settings are named (Google OAuth, Meta app, search-grounded Gemini).
- **Tab switching:** switching tabs from the menu drops the sub-view parameters (`view`, `section`, `planning`, `seoView`, `campaignView`, `settings`).

## Not opened
- Overlaps, where Crewin keeps its own tool: campaign drafts, review and email pilot, segments, recipients, sender and SES, automations, prospects, ads, messaging sources, WhatsApp, social publication queue and link tracking, repurposing, the Ryzevo library.
- Not applicable:
  - plan, billing, agency and portfolio;
  - product data;
  - mobile growth: no app is registered for Crewin.
- Compass screen: the Crewin job guide fills this role. The compass store stays reachable because an approved brief seeds it.

## Limits
- The Meta connection asks for the inbox permissions when its inbox box is ticked (ticked by default in Crewin); see `SAAS-META-CONNECTIONS.md`.
- Google and Meta must be connected again through Ryzevo OAuth. Crewin's env tokens and service account are not copied. The `PLATFORM_GOOGLE_*` and `PLATFORM_META_*` settings must be set.
- `legacy-admin` has no verified email, so the coach digest and alert emails are skipped. Web push works.

## Tests and checks
- **`test/platform-crewin-ryzevo.test.cjs`:**
  - the feature rule;
  - opened stores work for Crewin and closed ones stay 403;
  - Crewin's name, site and goals stay with its adapter, and only its brand voice is stored;
  - no quota cap, usage still recorded;
  - the coach reads Crewin files, connected channels, Crewin links and adds no starter drafts;
  - the monthly report includes Crewin posts;
  - the job guide shows the Ryzevo jobs.
- **Updated:** eight tests that asserted Crewin was refused (approvals, coach, coach brand/content/learning/review/seo, monthly-report sharing).
- **Isolated QA:** `scripts/preview-design.cjs --dev --crewin` prints a throwaway admin password for the Crewin workspace at each start.
  - Checked on it: every opened route returned 200, and the closed ones returned 403.
  - Overview, SEO views, Analytics, Inbox, Calendar plan, Connections and Brand all loaded.
  - Coach diagnosis → approval gave actions linking to Crewin tabs.
  - At phone width the page does not scroll sideways.

## Server setup guide (29 October 2026)

**Where:** Project settings → Operations → "Setup guide". Only the deployment administrator sees it; in Crewin, that is its single account.

**Cards:** one card each for Google (Search Console, GA4), Meta (Page and Instagram inbox), the search-grounded Gemini model, and scheduled jobs (worker). `lib/platform/server-setup.ts` builds them, `components/platform/ServerSetupGuide.tsx` shows them, and `GET /api/platform/operator?view=setup` serves them.

**Each card shows:**
- what the setting opens;
- the exact problem: a missing setting, a callback that is not https, the wrong callback path, a callback on another address, a Graph version in the wrong format, a model older than gemini-2, or a worker that never ran or ran too long ago;
- numbered steps with links to the provider's console pages;
- the values to register, derived from the address the panel is opened from (callback URLs, the Meta permission list including the inbox permissions, the worker address);
- `.env.local` lines with secrets as placeholders;
- the last step to try in the panel.

**Worker card:**
- On this machine: a one-off PowerShell command.
- On a live server: a `crontab` line.
- It reads the last successful run from `platform_worker_observations`.

**Safety:** setting values are never returned. A test checks that secret values never appear in the guide.

**Links into the guide:** `?setup=google|meta|gemini|worker` opens that card. These link to it:
- Crewin job-guide steps that wait for a server setting ("Open the setup guide");
- the "not configured" notes in Connections and in AI visibility.

**New job-guide step:** the Google tracking job has "Check that scheduled jobs run". It is done when the worker succeeded in the last 30 minutes.

**Tests:** `test/platform-server-setup.test.cjs` covers the missing, invalid and ready states; that no value leaks; local vs live commands; and the worker freshness check.

### Checks and address match (29 October 2026)

- **Credential checks:** the Google and Meta cards have a "Check" button, like Gemini (`probeGoogle`, `probeMeta` in `lib/platform/server-setup.ts`). Neither opens a consent screen or touches an account. Secrets go only to the provider and never into the result.
  - **Google:** a token request with a code that cannot be valid. `invalid_grant` means Google accepted the Client ID and secret; `invalid_client` means it did not; `redirect_uri_mismatch` means the callback is not registered.
  - **Meta:** an app access token (client credentials), then the app's name.
- **Panel address:**
  - `panelOrigin` and `callbackOnPanel` live in `lib/platform/request-origin.ts`.
  - `GET /api/platform/google` and `GET /api/platform/meta` return `callbackOrigin` and `originOk`.
  - When the panel is open from another address than the registered callback, Connections shows a notice with a link to the registered address instead of a form that would fail.
- **Job guide:** the Crewin job guide uses the setup guide's verdict for this address. A setting that is present but wrong also blocks its step, and the step quotes the problem.
- **What the guide cannot do:** create the Google or Meta apps, or give consent on their screens. Both need the account owner. Everything up to that point can be checked here.
