# Guided start on the overview (28 October 2026)

## Problem

A new member used to see six starting points on the overview at once:

- a "Continue" bar that led to project settings;
- the growth coach card;
- the diagnosis opening on its own;
- the Compass card asking for a goal again;
- an empty goals card;
- a quick-start list and a "New campaign" button.

The Compass setup dialog could also open while a strategy draft was waiting, asking for the goal a second time.

## What changed

- **One next-step card** (`components/platform/GuidedStart.tsx`, `NextStepCard`) at the top of the overview of standard projects. It shows one stage at a time:
  1. diagnosis (about 5 minutes);
  2. approving the strategy draft;
  3. building the path (when the strategy is approved but no path exists);
  4. then the Compass path's next verified step, with its account/access guide;
  5. when every step is verified, it says so and the daily items come first.
- **Progress** counts the diagnosis, the approval and the Compass steps (for example 2 / 11). It comes from project records only, never from a click on the card.
- **Setup mode:** until the strategy is approved, the overview shows only the card, alerts, decisions waiting and "What would you like to do?". The counters, task lists, activity, goals and duplicate shortcuts stay hidden.
- **"What would you like to do?" — the job guide** (`components/platform/JobGuide.tsx`, `lib/platform/job-guide.ts`, `GET /api/platform/job-guide`):
  - **Jobs are outcomes.** There are nine:
    - publish on social media;
    - answer messages and comments;
    - be found on Google;
    - appear in AI assistants;
    - send an email campaign;
    - run an ad;
    - measure results;
    - add your team;
    - adapt a post for other channels.
  - **Each job lists the steps to its outcome.** For example, social media: connect the account (or, if connected, test publishing access) → write the post → no-send rehearsal → publish.
  - **Steps come from the project's records only.** Clicking never completes a step. The first unfinished step is the next one, with one "Do this step" button that opens the exact screen.
  - **Screen names match the UI.** Every instruction uses the real tab and button names (for example Calendar → Social publications → "Check publishing access").
  - **Blocked steps say who can do them:**
    - a teammate with a named right, such as "the project owner or an admin";
    - or the Ryzevo operator, when a server switch is off (live publishing, starting ads, the search-grounded AI model).

    Earlier steps stay doable.
  - **Jobs are filtered per member.** A job is shown only if this member can move it forward, or when it is already done.
  - **Order per member:**
    - the member's own Compass goal comes first;
    - then waiting work (new messages, open SEO findings, reports awaiting approval) with a count;
    - then jobs already under way;
    - finished jobs go last.
  - **Search** folds case and Turkish letters and understands synonyms: "chatgpt" → AI assistants, "rapor" → results, "bulten" → email, "davet" → team. A single match opens its steps.
  - **Where it opens:**
    - on the overview rail (top five, then "All jobs");
    - from every screen with Ctrl/⌘+K or the header button "What would you like to do?". It does not open over another dialog.
  - **Refresh:** the snapshot is read again when the tab regains focus, so a step finished elsewhere is ticked on return.
- **Growth coach** (`guided` prop): before a brief is approved the coach card shows only its dialog. The next-step card opens it through the `ryzevo:coach-open` event. The Compass is refreshed after the diagnosis, so the card moves to step 2 straight away.
- **No dialog opens on its own on first visit.** The diagnosis is the next-step card's first button; the member can choose another job first. The Compass setup dialog does not open before a strategy is approved; the approved brief pre-fills the path.
- **No flash on load:** until the Compass answers, only the next-step card's loading state is shown, not the full overview.
- **Wording:**
  - login says "Email or username";
  - the Turkish menu says "Genel bakış" instead of "Dashboard";
  - the Compass steps that confused people were rewritten in plain language: brand voice and goal, site scan, rehearsal, first live post.

## Files and tests

- `components/platform/GuidedStart.tsx`, `components/platform/JobGuide.tsx`, `lib/platform/job-guide.ts`, `app/api/platform/job-guide/route.ts`, `app/page.tsx`
- Tests: `test/platform-job-guide.test.cjs` covers:
  - all nine jobs present, with no job dropped by a failing query;
  - steps ticked from records;
  - rights and named owners;
  - Ryzevo-only switches;
  - per-member order.
- `ProjectOverview.tsx`, `GrowthCoach.tsx`, `GrowthCompass.tsx`
- `lib/platform/guidance.ts`
- `app/login/page.tsx`, `lib/platform/catalog.ts`
- `app/growth-compass.css`

Checked in the browser on the isolated QA server with a new sign-up:

- each stage, from diagnosis through approval to the path;
- no extra dialog;
- phone width without horizontal scrolling.

Compass tests pass.

## Crewin workspace (28 October 2026)

The Crewin workspace (the single legacy account) now has its own "What would you like to do?" guide: on the overview under the heading, from the header button, and with Ctrl/⌘+K. The same endpoint (`GET /api/platform/job-guide`) answers a legacy session from `lib/platform/crewin-job-guide.ts`.

- **Eight Crewin jobs:**
  - approve pending bank-transfer orders;
  - find company leads and prepare them for a campaign;
  - get empty profiles completed;
  - post jobs and announce them on Telegram;
  - post on social media to bring sign-ups;
  - review this week's results;
  - rank higher on Google;
  - send a campaign.
- **Records read:**
  - web `data/` JSON files: content and post history, activity log, scheduled posts, SEO work items;
  - agent files: review queue, posted jobs, job queue;
  - the Crewin backend: stats, leads, pending orders, campaigns, post history.
  - Nothing is written, and a click never completes a step.
- **Weekly work counts from the last 7 days:** posting, the KPI report, job ads and Telegram announcements. A job done last month comes back as the next step. Monthly work counts from the last 30 days: reminders and blog posts.
- **Evidence on each step:** what the records show, for example "Last ad: 32 days ago", "10 approved, 15 in review" or "6,416 empty profiles".
- **Missing server settings are named** (TG_SESSION, SMTP or WhatsApp, GA4). Earlier steps stay doable.
- **Backend failures:** a service that does not answer hides only its own job, and the guide says so. Answers are reused for 60 s, and a failure is retried after 15 s.
- **Speed:** large files (content history about 22 MB, review queue about 6 MB) are parsed again only when they change. A warm request took 86–600 ms on the real data.
- **New records:** a published job ad (Job bot "Publish now" / "Approve & publish") and a published blog post are now recorded in the activity log (`job_posted`, `blog_published`). Without these, those steps could not be ticked from a record.
- **Sub-tab links:** each step opens the exact sub-tab, and its text still names the button. Seven legacy tabs read the sub-view from the address; an unknown value falls back to the tab's default. Switching tabs from the menu drops the sub-view from the address.

  | Tab | Address parameter | Values |
  | --- | --- | --- |
  | Campaigns | `view` | `flows`, `paid`, `lifecycle`, `prospects` |
  | AI Prospect Finder | `section` | `research`, `add`, `pool` |
  | Automation | `view` | `review`, `groups`, `stats`, `jobs` |
  | Job bot | `view` | `create`, `queue`, `history` |
  | WA & Telegram | `view` | `notify_email` and the other sub-tabs |
  | SEO & Blog | `view` | `blog`, `site_audit` and the other sub-tabs |
  | Seafarer growth | `view` | `registration`, `tiktok` |
  | Credits & payments | `view` | `bekleyen`, `firma`, `odemeler` |

  In AI Prospect Finder, a `section` in the link wins over the section remembered in the browser. The parameters are read by `lib/url-view.ts`.
- **Tests:** `test/platform-crewin-job-guide.test.cjs` covers:
  - all jobs;
  - 7-day windows;
  - ticking from files;
  - server settings;
  - backend failure and caching;
  - order.
