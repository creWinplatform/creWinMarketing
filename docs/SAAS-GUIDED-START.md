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
- **"What would you like to do?"** (`TaskLauncher`) lists common jobs:
  - prepare a post;
  - schedule and publish;
  - answer messages;
  - be found on Google and in AI answers;
  - email campaign;
  - plan an ad;
  - see results;
  - invite a teammate.

  Each job links to the screen that does it. When an account is missing, the job names the prerequisite first and links to its setup. Jobs are shown only to members whose role can do them. On phones the list sits right under the card during setup, and in daily mode the card links to it ("I want to do something else").
- **Growth coach** (`guided` prop): before a brief is approved the coach card shows only its dialog. The next-step card opens it through the `ryzevo:coach-open` event. The Compass is refreshed after the diagnosis, so the card moves to step 2 straight away.
- **Compass first run:** the setup dialog no longer opens before a strategy is approved. The approved brief pre-fills the path, as before.
- **Wording:**
  - login says "Email or username";
  - the Turkish menu says "Genel bakış" instead of "Dashboard";
  - the Compass steps that confused people were rewritten in plain language: brand voice and goal, site scan, rehearsal, first live post.

## Files and tests

- `components/platform/GuidedStart.tsx`
- `ProjectOverview.tsx`, `GrowthCoach.tsx`, `GrowthCompass.tsx`
- `lib/platform/guidance.ts`
- `app/login/page.tsx`, `lib/platform/catalog.ts`
- `app/growth-compass.css`

Checked in the browser on the isolated QA server with a new sign-up:

- each stage, from diagnosis through approval to the path;
- no extra dialog;
- phone width without horizontal scrolling.

Compass tests pass.
