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
