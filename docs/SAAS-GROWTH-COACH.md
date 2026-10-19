# Ryzevo Growth Coach

## Scope

The growth coach is a guidance layer for standard (non-Crewin) projects whose teams have no SEO, digital marketing or social media specialist. It adds a loop on top of the existing tools: **diagnosis → reviewed and approved strategy brief → weekly next-best actions**. It does not replace the content studio, campaign hub, SEO hub, Calendar, Analytics or the Growth Compass, and it never publishes, sends or schedules anything by itself. The legacy Crewin workspace, auth/session, middleware and tenant isolation are unchanged.

## Flow

1. **Diagnosis** (overview → *Growth coach* → *Start the diagnosis*). Ten plain-language questions: what you sell, who buys it, B2B/B2C, price point, where the sale happens, current channels, weekly team time, team skills, main obstacle and an optional "good first month" in the team's own words. The team picks the brief language (defaults to the project content language).
2. **Draft.** Two sources, both drafts for human review:
   - *AI* (only when `PLATFORM_GEMINI_API_KEY` and `PLATFORM_GEMINI_MODEL` are set): one Gemini call with JSON output. It reserves one AI usage unit through `ProjectOperations.reserveAi`, completes it only when a valid draft is stored and refunds it on any failure (provider error, unparseable output, failed content rules, stale revision). Questionnaire and product data are passed as data, not instructions.
   - *Starter template* (always available, no AI usage): a rule-based brief built from the answers. The rules are qualitative (e.g. business buyers → LinkedIn company page and email; visual skills + individual buyers → Instagram; online self-serve + writing → search/SEO). Customer pains are written as *assumptions to validate*, not facts. Each week's plan is trimmed to the stated weekly time.
3. **Review and approve.** The team edits every field: ICP summary, customer problems, positioning, 1–3 priority channels with rationale and the 30-day plan (1–16 actions; week, title, why, how, time estimate, tool, optional channel). Editors can save the draft; only members with `campaign.approve` (owner/admin) approve it. Approval replaces the active brief; a later draft does not change the weekly plan until it is approved.
4. **This week** (top of the workspace overview). Up to three open actions: at most two *prerequisites* derived from current project state, then plan actions (current/overdue weeks first; if the project has no drafts yet, drafting comes first). Each card shows why, how, a time estimate and a one-click link to the existing tool. Content studio and campaign links carry a pre-filled brief (title + why) and channel through `sessionStorage` in the same tab only — nothing is put in the URL, and nothing is generated or saved until the user acts. Actions can be marked *done* (persisted), *skipped for this week* (returns the next week) or sent to the Calendar.
5. **Content generation context.** Once approved, `/api/platform/generate` adds `approvedStrategy` (audience summary, positioning, priority channel ids) to the existing *Product data (not instructions)* block. The plan itself is not sent.

### State-derived prerequisites

| Action | Shown when | Resolves when |
|---|---|---|
| `setup:goal` | project has no growth goal | a goal exists |
| `setup:connect:<channel>` | a priority social/email channel has no saved active connection and the plan has no connection item for it | an active connection is saved (not a verification claim) |
| `setup:audit` | search is a priority, no public HTML audit receipt and no SEO item in the plan | an audit receipt exists |
| `setup:audit-task` | the latest audit had findings and no Calendar task was created since | a task is created after the audit |
| `setup:measure` | plan week ≥ 3, a goal exists and nothing was measured in the past three weeks | a dated measurement exists |

Plan items with tool `connections` also count as done once the channel has a saved active connection; a completed linked Calendar task marks its action done.

## Data model (schema 31)

Additive migration in `lib/platform/database.ts`; existing tables are untouched.

- `platform_growth_coach` — one row per project, primary key `(organization_id, project_id)`, foreign key to `platform_projects(id, organization_id)`. Columns: `revision` (optimistic concurrency), `answers_json`, `draft_json`, `draft_source` (`ai` | `template`), `draft_at`, `brief_json` (approved brief), `approved_by`, `approved_at`, `updated_by`, `created_at`, `updated_at`.
- `platform_growth_coach_actions` — primary key `(organization_id, project_id, action_id)`, same project foreign key. Columns: `state` (`open` | `done` | `skipped`), `week` (UTC Monday, `YYYY-MM-DD`, used for "skipped this week" and "handled this week"), `task_id` (linked Calendar work item; not a foreign key so deleting a task in the Calendar keeps working), `actor_id`, `updated_at`.

Plan action ids are `plan:` + a SHA-256 prefix of week, tool and title, so editing other parts of the brief keeps action states; editing an action's title starts it fresh. Writes use immediate transactions and append `coach.*` operations to `platform_audit`. The offline recovery tools accept schema 31 (`MAX_RECOVERY_SCHEMA`).

## API

`/api/platform/coach` — session-protected, scoped server-side to the session's organization/project, standard projects only, `private, no-store`. Writes require a same-origin request and a bounded JSON body (96 KB).

- `GET` → snapshot: answers, pending draft, approved brief, plan week, this week's actions, actions handled this week, `aiConfigured`, `canWrite`, `canApprove`. A GET never writes.
- `POST {action:'diagnose', answers, language, mode:'ai'|'template', expectedRevision}` — `content.write`.
- `POST {action:'save', brief, expectedRevision}` — `content.write`.
- `POST {action:'approve', brief, expectedRevision}` — `campaign.approve`.
- `POST {action:'act', actionId, state:'done'|'skipped'|'open'}` — `content.write`; the id must be one of the current derived actions.
- `POST {action:'schedule', actionId}` — `content.write`; creates one planned Calendar task (deduplicated while it stays open). It notifies no one and assigns no owner.

Stale revisions return 409. Viewers and analysts can read the brief and actions; tool links show as unavailable when the member lacks the tool's permission.

## Content rules

- AI suggests, people approve. UI copy says "suggestion", "draft" and "approve"; nothing is described as automatic.
- No invented statistics, benchmarks, outcomes or prices. AI output containing a percentage, a guarantee or an autonomy claim is rejected (HTTP 422) and the usage unit is refunded. Time estimates are effort estimates the team can edit.
- Missing data is not zero; measurement actions say so.

## Files

- `lib/platform/coach-types.ts` (client-safe types/enums), `lib/platform/coach.ts` (store, validation, starter rules, prompt/parse, derivation)
- `app/api/platform/coach/route.ts`, `app/api/platform/generate/route.ts` (context)
- `components/platform/GrowthCoach.tsx`, `app/growth-coach.css` (reuses the compass dialog shell and Ryzevo tokens), `components/platform/ProjectOverview.tsx`, `components/platform/ProjectDrafts.tsx` (pre-fill)
- `test/platform-coach.test.cjs` (in `npm run test:platform`)

## Verification (Phase 1)

- `npx tsc --noEmit -p .`, `npm run test:platform`, `npm run test:i18n`.
- Isolated browser QA: `node scripts/preview-design.cjs --dev` (optionally `--coach` to add `coach-editor` and `coach-viewer` members), sign in as `design-fixture` at `http://127.0.0.1:31450/login`. The QA server keeps the AI key empty, so it exercises the starter-template path only; fixture data is disposable and never customer data.

# Phase 2: content plan, SEO for non-experts, weekly review

Phase 2 adds three tools on top of the approved strategy brief. The same rules apply: AI suggests, a person approves, nothing is published or sent automatically. Every AI call reserves one usage unit through `ProjectOperations` and refunds it on failure (`lib/platform/coach-ai.ts`). Each AI tool also has a rule-based starter, so it works when AI isn't configured (the QA fixture runs this way). All tools are for standard projects only, use the same session/organization/project scope and are `private, no-store`. Writes need a same-origin request and a bounded JSON body. Shared route helpers are in `app/api/platform/coach/shared.ts`.

## 1. Monthly content plan (Calendar → Content plan)

- **Generate** for this month or next month. AI or starter suggestions are built from the approved brief (ICP, positioning, channels) and the project goals. Each item has a channel, a theme, a title, a short angle, an optional goal link and a suggested date. The starter rotates four plain themes over the brief channels on the remaining Tuesdays and Thursdays. The item count follows the weekly time from the diagnosis: 4, 8, 12 or 16 items.
- **Review.** Every item is a *suggestion* until someone with `content.write` approves it. Editing an approved item sends it back to *suggestion*. Regenerating replaces only open machine suggestions; approved, dismissed and team-written items are kept. A month holds at most 40 items.
- **Use.** An approved item can (a) open the content studio with a pre-filled brief, channel and name (same `sessionStorage` handoff as Phase 1; nothing is saved until the user saves) and (b) be added to the Calendar as one planned task, due on the suggested date at 09:00 UTC and deduplicated while that task is open.
- AI output is rejected (and refunded) for channels outside the brief, dates outside the month, foreign goals, malformed JSON, or percentage, guarantee or autonomy claims.
- **Data:** schema 32 `platform_coach_content_items` (id, month, channel, theme, title, angle, goal_id, planned_for, state `suggested|approved|dismissed`, source `ai|template|human`, revision, task_id, approved_by/at).
- **API:** `/api/platform/coach/content`: `GET ?month=`; `POST` with `action` `generate|add|update|decide|schedule`. Edits and decisions use `expectedRevision` per item (409 on conflict).

## 2. SEO for non-experts (SEO & Blog → Topics & briefs, and Site audit)

- **Topics.** Topic clusters come from the product profile, the approved brief and, if a Search Console connection exists, the top 50 queries of the last ~4 weeks. These queries are read with the project's stored Google grant (`lib/platform/search-console-queries.ts`); a refreshed token is stored back encrypted. The source is always shown:
  - *Search Console* phrases carry the clicks, impressions and average position exactly as reported. When the AI reuses a query, the server attaches the numbers from the stored rows; numbers never come from the model.
  - *Suggestion · no data* phrases carry no numbers at all.
  - Not connected, no rows, or an unreadable connection is each stated in words. Nothing is shown as zero.
  - AI output that mentions search volume, difficulty, monthly searches or ranking next to a number is rejected (422) and refunded.
  - Intent labels are a word-based heuristic and are labelled *estimated*.
- **Content briefs.** Per topic, an AI or starter brief: target keyword, search intent, title, outline, questions to answer, internal link ideas and notes. Internal links may only point to the project's own origin or describe a page in words. The brief stays a draft until approved (`content.write`). An approved brief opens a pre-filled **blog** draft in the content studio. Regenerating topics keeps topics that already have a brief.
- **Audit re-ranking** (`lib/platform/seo-impact.ts`, client-safe). Findings from the existing public HTML audit are ordered by *likely impact*: a fixed editorial rule per check, combined with the audit's own priority (the higher one wins). The page says this order isn't a traffic, ranking or conversion measurement. Each finding shows "why it matters" and "how to fix" in TR/EN, plus a developer-ready task text (page URL first, problem, evidence, fix, "done when") that can be copied. "Add to work plan" stores that text in the existing Calendar task, keeping the URL as the first note line that the Compass and coach already read.
- **Data:** schema 33 `platform_coach_seo_topics` (cluster, intent, keywords_json, source, brief_json, brief_source, brief_state, revision) and `platform_coach_seo_queries` (one Search Console snapshot per project: connection, status `ready|no_data|unavailable`, period, rows, checked_at).
- **API:** `/api/platform/coach/seo`: `GET`; `POST` with `action` `topics|brief|save|approve|remove`.

## 3. Weekly review (overview, under "This week")

- **Facts** (`lib/platform/coach-review.ts`) are built without AI, only from this project's records for the last 7 days:
  - goal/stage measurements: latest value in the period, the previous value before it, and the source (manual, GA4, Search Console, product events);
  - whether GA4 or Search Console is connected;
  - coach actions done, skipped and open (with the titles of done ones);
  - drafts saved (per channel), campaigns created, social publications accepted by the provider (labelled as not reach or engagement), and content plan items approved;
  - audits with findings, and SEO briefs approved.

  With no records the review says exactly that ("no data is not a zero result"). "What seems to work" lists only measured rises during active weeks and says it is not proof of cause. No estimates, uplift or ROI.
- **Adjustments** are rule-based proposals that each name their fact: add a measurement action (nothing measured in 14 days), connect GA4/Search Console (neither connected), move the longest open action to next week (2+ skips, or no completion after 5+ days), plan one more draft for the channel the team actually drafted for, and a note to renew the plan in week 4+. At most four.
  - **Accepting** edits the approved brief's plan through `GrowthCoach.adjustPlan` with the coach `expectedRevision`, so it feeds next week's actions immediately. It needs `campaign.approve`, the same right as approving the brief.
  - **Rejecting** needs `content.write` and changes nothing.
  - Decisions survive a refresh. Only the current week's review can be decided.
- **Data:** schema 34 `platform_coach_reviews` (one row per project and UTC week: facts_json, adjustments_json, revision).
- **API:** `/api/platform/coach/review`: `GET`; `POST` with `action` `generate|decide`.

## Phase 2 permissions

The permissions follow one rule:

- **Working material** (content ideas, SEO briefs, calendar handoffs) is approved by people who write content.
- **Changes to the approved strategy** (the brief and its plan) need the same approval right as the brief itself.
- **Use of a stored provider grant** stays with people who manage connections.
- Nothing here publishes or sends. Real delivery still goes through the existing campaign review and live gates.

| Action | Permission |
|---|---|
| Read content plan, SEO topics, weekly review | `read` |
| Generate/edit/approve/dismiss content plan items, add to Calendar | `content.write` |
| Suggest SEO topics from the product profile and brief; draft/edit/approve briefs | `content.write` |
| See or use Search Console data (read/refresh queries, see query phrases and numbers, use them in topics and briefs) | `connections.manage` |
| Prepare/refresh the weekly review, reject a proposal | `content.write` |
| Accept a weekly-review proposal (changes the approved plan) | `campaign.approve` |

The Search Console limit is enforced on the server (`CoachSeo.manager()`), not only in the UI. For members without `connections.manage`:

- `GET` returns the state `restricted`, with no period, no count and no query phrase;
- Search Console keywords are removed from stored topics;
- topic generation and AI brief prompts use only the product profile and the brief;
- the refresh action returns 403.

The UI says, in TR and EN, that Search Console data is available only to teammates who manage connections. This is a note, not an error. (User decision, October 19, 2026.)

## Time zone

"This week", "this month", "today" and the 09:00 due time of a Calendar handoff use the **project time zone** (Project settings), not UTC. This covers:

- Phase 1 week keys used for "skip this week" and "handled this week";
- the plan week, counted in local calendar days since approval;
- weekly review weeks, and the review window: today plus the previous six local days, starting at local midnight;
- content plan months, the remaining-weekday dates and due times.

The helpers are `zonedDateKey`, `zonedInstant`, `zonedDayDiff`, `zonedShiftDays` and `coachWeekKey(date, timeZone)` in `coach.ts`. They are Intl-based and compare local dates, so DST days are handled. Stored timestamps stay UTC. Example: Sunday 22:30 UTC is already Monday in Europe/Istanbul. (User decision, October 19, 2026.)

## Phase 2 files and tests

- `lib/platform/coach-ai.ts`, `coach-content.ts`, `coach-seo.ts`, `search-console-queries.ts`, `seo-impact.ts`, `coach-review.ts`; types appended to `coach-types.ts`; `GrowthCoach.approved()` and `adjustPlan()` in `coach.ts`.
- Routes: `app/api/platform/coach/{content,seo,review}/route.ts`.
- UI: `components/platform/CoachContentPlan.tsx` (Calendar view), `CoachSeo.tsx` and `ProjectAudit.tsx` (SEO tab views, re-ranked findings), `CoachWeeklyReview.tsx` (overview), styles in `app/growth-coach.css`.
- Tests: `test/platform-coach-content.test.cjs`, `test/platform-coach-seo.test.cjs`, `test/platform-coach-review.test.cjs` (shared fixture `test/coach-fixture.cjs`), all in `npm run test:platform`. Search Console is exercised with a stub reader and refresh function; no network calls. `MAX_RECOVERY_SCHEMA` is 34.

## Verification (Phase 2)

- `npx tsc --noEmit -p .`, `npm run test:platform`, `npm run test:i18n`.
- Browser QA used the isolated fixture (`node scripts/preview-design.cjs --dev`, AI key empty, so starter paths only).
  - `--coach` adds `coach-editor` and `coach-viewer` members and a disposable Search Console grant with stub rows. These rows are read through a stub reader; no Google call is made while the fixture is built.
  - `--coach-brief` also approves a Turkish starter brief.
  - `.claude/launch.json` → `ryzevo-coach-qa` starts the fixture with both flags.
  - In that fixture, an owner pressing "Refresh data" calls Google with the fake grant and records "unavailable". That is the honest outcome, not a bug.
- Role QA (October 19, 2026):
  - the editor saw the "available only to connection managers" note, with no Search Console phrases or numbers;
  - the editor could reject but not apply a weekly-review proposal;
  - the viewer saw every Phase 2 screen without action buttons. It covered EN/TR, 1440/375 and light/dark for the three screens: content plan → approve → Calendar → pre-filled draft; SEO topics without Search Console → brief → approve → pre-filled blog draft, plus the audit re-ranking on the fixture site; weekly review → accept a move proposal → "This week" updated. A real Search Console property and real Gemini output need customer-owned credentials and a configured AI key. They were not exercised; both are unit-tested with stubs only and remain an operator acceptance step.

# Phase 3: learning loop, one guided start, review email, brand voice and competitors

Same rules as Phases 1 and 2:
- AI suggests, people approve; nothing is published or sent automatically.
- Every AI call has a usage reservation and a rule-based starter.
- Standard projects only; server-side scope and permission checks; TR/EN.

## 3.1 Learning loop (Analytics → "Growth coach: what we learned")

**What is tracked.** Drafts opened from the coach carry a `coachRef`: `plan:<id>` or `setup:<id>` for weekly actions, `content:<itemId>` for content plan items, `seo:<topicId>` for SEO briefs.
- The ref travels in the same-tab pre-fill and is stored on the draft (`HistoryItem.coachRef`).
- It is validated against `COACH_REF` in the content-history whitelist and kept on later edits.
- Drafts made any other way carry none.

**What is shown** (`lib/platform/coach-learning.ts`, read-only):
- coach drafts → their social publications (`source_kind='content'`) → engagement that the provider actually reported (`platform_social_engagement`, state `ready`);
- totals by channel and by theme. Interactions = likes, comments, shares, clicks, bookmarks and quotes added up; impressions and reach are kept apart. Unavailable engagement and rejected publications count as no data.

**Naming a leader.** A channel or theme is named only when at least two groups have observed engagement and the top group has two observed publications. It is shown as an average per observed publication, labelled as an observation, not proof of cause.

**Also on the page:** measurement trend for the last 8 weeks (first → last dated value) and the brief version history.

**Brief versions** (schema 35, `platform_growth_coach_briefs`, append-only):
- Every approval, accepted weekly-review plan change and applied positioning stores the brief it produced (`kind` = `approve|adjust|positioning`).
- The migration backfills already approved briefs.
- The coach dialog shows "changes since the previous version" (`diffBriefs`).
- When a new draft is reviewed, it is compared with the approved brief.

## 3.2 One guided start (Coach + Compass)

**First visit, no brief yet.** The Compass knows the coach state (`coach.hasBrief`, `hasDraft`, `canDiagnose`). On the first visit of a member who can write, it opens the growth diagnosis instead of its own first-run dialog. Closing that start without a diagnosis defers the Compass first run, as closing the Compass does.

**After approval.** The approved brief suggests a Compass path (`lib/platform/coach-compass.ts`):
- Channels: LinkedIn → company page, Instagram, Facebook, X, email; search is left out.
- Priority: search when the first channel is search; social when B2C starts on a social channel; otherwise leads.
- Goal: the goal only if there is exactly one.

On approval, only the approver's own Compass path is seeded, and only if they have none or only an empty deferral. Other members keep their choices; their Compass first run opens pre-filled from the brief, with a note saying so.

## 3.3 Weekly review email (overview → Weekly review → Email digest)

**Subscribing.** Opt-in per member, only with a verified account email (`platform_account_emails`). The subscription stores the language.

**Sending.**
- Only an approver (`campaign.approve`) queues this week's review for current subscribers.
- `UNIQUE(review_id,user_id)` means no one gets the same review twice.
- Before sending, the worker (`deliverNextCoachDigest`, called from `/api/platform/worker`) re-checks active membership, the subscription and the verified email; otherwise the delivery is `skipped`.
- A delivery is marked `submitted` before the provider call and is never retried; it ends `sent` or `uncertain`.

**Transport and safety.**
- The transport is the platform's account-email SES configuration, without click or open tracking.
- It is off unless `PLATFORM_COACH_DIGEST_ENABLED=1` and the account-email configuration is complete. While off, only the preview works.
- The text is built only from the stored review facts and says "no data" plainly.

**Schema 36:** `platform_coach_digest_subscriptions` and `platform_coach_digest_deliveries`.

## 3.4 Brand voice and competitors (Project settings → Brand voice & competitors)

**Brand voice workshop.** Tone adjectives, tone to avoid, form of address, preferred and avoided words, an example sentence → AI or starter brand voice guide → team edits.
- "Apply to the product profile" writes `brandVoice` through `updateProject` and keeps its rule (`connections.manage`).
- From then on, AI content drafts use the new voice.

**Competitors.**
- Up to five competitors, using only what the team writes: name, an optional address, what they say, strengths and weaknesses, plus "what makes you different".
- **The address is a label: it is never visited or crawled.** AI output naming unknown competitors or containing links is rejected.

**Positioning.** The comparison (their claim from your notes vs. your angle) suggests a positioning. Applying it to the approved brief needs `campaign.approve`, uses the coach `expectedRevision` and is stored as a `positioning` brief version.

**Schema 37:** `platform_coach_brand` (one row per project, optimistic `revision`).

## Phase 3 permissions

| Action | Permission |
|---|---|
| Read "what we learned", brand workshop, digest preview | `read` |
| Subscribe / unsubscribe to the review email (own, verified email) | `read` |
| Draft and edit the brand voice; save competitor notes; suggest a comparison | `content.write` |
| Apply the brand voice to the product profile | `connections.manage` |
| Apply the suggested positioning to the brief; queue the review email | `campaign.approve` |

## Phase 3 files and tests

- **Server:** `lib/platform/coach-learning.ts`, `coach-compass.ts`, `coach-digest.ts`, `coach-brand.ts`.
- **Routes:** `app/api/platform/coach/{learning,digest,brand}/route.ts`.
- **UI:** `components/platform/CoachLearning.tsx`, `CoachBrandStudio.tsx`, `coach-changes.ts`.
- **Changed:** `coach.ts` (versions, Compass seeding), `guidance.ts` (coach state and suggestion), `marketing-routes.ts` and `content-history.ts` (`coachRef`), the worker route, ProjectDrafts, ProjectReports, ProjectSettings, GrowthCompass, GrowthCoach and CoachWeeklyReview.
- **Tests (in `test:platform`):** `test/platform-coach-learning.test.cjs`, `platform-coach-compass.test.cjs`, `platform-coach-digest.test.cjs` (stub SES client, no network), `platform-coach-brand.test.cjs` (competitor addresses provably not fetched).
- `MAX_RECOVERY_SCHEMA` is 37.

## Verification (Phase 3, October 19, 2026)

- `npx tsc --noEmit -p .`, `npm run test:platform` and `npm run test:i18n` pass.
- **Browser QA:** isolated fixture (`node scripts/preview-design.cjs --dev --coach`, temporary DB, AI key empty, email digest off), EN/TR, 1440/375, light/dark. Covered:
  - the first visit opens only the diagnosis; approval seeds the Compass path;
  - a draft opened from a weekly action stores its `coachRef` and appears in "what we learned" with the brief versions;
  - brand voice draft → applied to the product profile;
  - competitor notes → comparison → positioning applied and versioned;
  - the review email preview, with sending shown as off.
- **Not verified:** a real SES send (needs operator SES credentials), real provider engagement data and real Gemini output. All three are covered by stub-based tests only.

# Phase 4: outcomes, monthly renewal, email bridge, team assignment

Same rules as Phases 1–3:
- AI suggests, people approve; nothing is published or sent automatically.
- Every AI call has a usage reservation and a rule-based starter.
- Standard projects only; server-side scope and permission checks; TR/EN.

## 4.1 Outcomes next to the work (Analytics → "what we learned" → "Week by week")

**The week is the window.** Weeks start on Monday in the project's time zone.
- The last 8 weeks are shown.
- For each goal stage and each source, the latest reading of the week is shown: a manual record, Google Analytics, Search Console or product events.
- A manual reading belongs to the day it was recorded. An automatic reading belongs to the last day of its measured period; the period is shown next to it.

**Next to each reading: that week's coach work.** This means coach drafts, coach campaigns, accepted publications, email pilot recipients, completed actions and approved plan items, plus how many of them are linked to the selected goal.

**Nothing is credited or counted twice.**
- Each reading and each piece of work falls into exactly one week.
- Manual and automatic records are separate rows and are never added up.
- No outcome is credited to a piece of work, and the page says so.
- "No measurement" is shown as such, never as zero.

**The Phase 3 trend now splits by source.** The "Measurements · last 8 weeks" lines (first → last) are per source.

## 4.2 Monthly renewal (overview → Monthly renewal)

**When it is due.** The 30-day plan is in its last week, or a new month started at least 14 days after approval. It is not due once this month's renewal was approved.

**What the proposal is built from.** The period's own records (`CoachRenewal.facts`):
- the state of each plan action;
- drafts and email campaigns by channel;
- accepted publications;
- email pilot recipients;
- measurements per goal stage and source;
- the "what we learned" leader, if one is named.

**Rule-based proposal** (`coachStarterRefresh`). Every change carries a reason that names its fact:
- **Unfinished actions** move into weeks 1–3. The reason states how many were carried and how many the weekly time limit dropped, counted on the final plan.
- **Completed actions** are removed.
- **The observed leader channel** moves first, with its average and the note that it is not proof of cause.
- **A channel with no work** moves last.
- **Active channels** get one more draft each.
- **Measurement:** a missing measurement comes first; otherwise this month's measurement is in week 4.
- **No duplicates:** the same action (tool + title) never appears twice.

**AI proposal** (`coachRefreshPrompt` / `parseCoachRefresh`). It uses the same rules. Numbers may only be copied from the facts. Reasons are checked against the banned-claims rule; broken or non-compliant output is refunded.

**Approval.**
- An approver (`campaign.approve`) approves with both revisions. Approving replaces the brief, restarts the 30-day plan and stores a `refresh` brief version.
- A proposal goes stale if the brief changed after it was prepared (for example, an accepted weekly-review change). A stale proposal can't be approved.
- Editors can dismiss a proposal or prepare it again. There is one row per month; regenerating rewrites it in place.

**Schema 38:**
- `platform_coach_refreshes` (`UNIQUE(organization, project, month)`);
- `platform_growth_coach_briefs` rebuilt with the `refresh` kind, keeping every existing row and its id.

## 4.3 Email bridge

- **Content plan:** an email item's "Create a campaign draft" opens the campaign draft editor (Campaigns → Drafts) pre-filled from the item.
- **Coach actions:** with the campaigns tool, these already opened it.
- **What is stored:** the campaign draft keeps the `coachRef` (validated against `COACH_REF`, set on creation, kept on edits) and the goal.
- **Sending is unchanged:** it still goes through segment, consent, suppression, preflight, review and pilot limits.
- **What "what we learned" shows:**
  - coach campaigns as `email` rows;
  - rehearsals and pilot sends;
  - recipient states from the existing SES flow: accepted, delivered, bounced, complaint, rejected, uncertain.
- "Accepted by the provider" is not delivery. Opens and clicks are not tracked. Email never feeds the engagement leader.

## 4.4 Team assignment

**What can be assigned.** Weekly actions (setup and plan) and content plan items get an owner and an optional due date.
- **Owner:** an active teammate with content rights.
- **Due date:** from one month before to one year after today, in the project's time zone.
- **Concurrency:** optimistic `revision`.

**Where it shows.**
- On the action card and the content plan item.
- In "Assigned to me" on the overview: my open items, overdue first, plus the team's open count.
- **Overdue:** only for open work.

**What counts as done.** For an action: marked done, or its linked Calendar task completed. For a content item: a draft or campaign opened from it.

**Nothing is sent.** The only email mention is a personal "Open work assigned to you" section in the weekly-review email the member already subscribed to. It lists only the recipient's own items, read again at send time.

**Schema 39:** `platform_coach_assignments` (`PK(organization, project, item_kind, item_id)`).

## Phase 4 permissions

| Action | Permission |
|---|---|
| Read outcomes, email results, renewal, assignments | `read` |
| Prepare or dismiss a renewal; assign or unassign an owner | `content.write` |
| Approve a renewal | `campaign.approve` |

## Phase 4 files and tests

- **Server:** `lib/platform/coach-refresh.ts`, `coach-assignments.ts`, `coach-assignment-rows.ts`; `coach-learning.ts` (outcomes, email, trend per source).
- **Routes:** `app/api/platform/coach/{refresh,assignments}/route.ts`.
- **UI:** `components/platform/CoachRefresh.tsx`, `CoachAssign.tsx`, `CoachMyWork.tsx`.
- **Changed:** CoachLearning, GrowthCoach, CoachContentPlan, ProjectDrafts (campaign `coachRef`), ProjectOverview.
- **Server changes:** `coach.ts` (`renew`, `actions`, assignments on actions), `coach-content.ts` (assignments on items), `coach-digest.ts` (personal section), `marketing-routes.ts` and `campaigns.ts` (`coachRef` on campaigns), `coach-review.ts` (renew note).
- **Tests (in `test:platform`):**
  - `test/platform-coach-refresh.test.cjs` and `platform-coach-assignments.test.cjs`;
  - new cases in `platform-coach-learning.test.cjs`.
- **Recovery:** `MAX_RECOVERY_SCHEMA` is 39. The schema assertions and the recovery "future schema" fixtures moved to 39 and 40.
- **QA flag:** `node scripts/preview-design.cjs --dev --coach --coach-brief --coach-renewal` moves the fixture approval back 23 days. It adds disposable manual readings and a stub automatic reading.

## Verification (Phase 4, October 19, 2026)

- `npx tsc --noEmit -p .`, `npm run test:platform` and `npm run test:i18n` pass.
- **Dry run:** migrations 38–39 were run on a copy of the real database (schema 37 → 39, integrity ok, 0 FK problems, rows kept); the copy was deleted.
- **Browser QA** on the isolated fixture (owner, editor, viewer), TR/EN, 1440/375, light/dark:
  - the renewal is proposed with accurate reasons, approved, and the plan restarts at week 1;
  - assignment with an overdue date appears in "Assigned to me";
  - an email plan item → campaign draft with `coachRef` and goal → counted in "what we learned";
  - week-by-week outcomes keep manual and automatic rows apart.
- **Real Gemini (`gemini-2.5-flash`, fixture data only):** every coach AI path was run against the real model (diagnosis, content plan, SEO topics and brief, brand voice, competitor analysis, renewal). This found two problems, both fixed:
  - Thinking tokens used up the output budget and cut JSON answers off. `coachGemini` now caps thinking at 1024 tokens and adds that on top of the answer budget.
  - Slightly long AI text failed the whole answer. AI text is now shortened to the field limits (`fitCoachBriefText`, `fitSeoBriefText` and clipping in content ideas, brand analysis and renewal reasons). Structure, the banned-claims rule and the own-site link rule still reject, and team edits keep the strict limits.
  - Repeated runs then passed.
- **Real GA4 and Search Console:** read-only, one-off, through `ProjectMeasurements.process` and the real `readGoogleMeasurement`, with a service-account token.
  - It found that GA4 answers an event filter with no match as 200 with no rows and no `metricHeaders`. This is now no data instead of a failure, with a test.
  - Afterwards 12 of 12 readings were correct, landed in the right week and kept their source rows apart. A real 0 stays distinct from no data.
  - The coach SEO query snapshot also read real Search Console queries.
- **Not verified:** a real SES pilot send with delivery feedback, the per-project Google OAuth flow and real social engagement data.
