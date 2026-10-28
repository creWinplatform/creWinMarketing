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
