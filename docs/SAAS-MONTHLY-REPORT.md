# Monthly results report (schema 59, 27 October 2026)

Analytics → "Monthly results report" assembles one calendar month, in the project's time zone, from the project's own records. A person with approval rights reviews it and approves exactly what is on screen. Only an approved report is shared, through a read-only link that expires and can be turned off.

## What is in it

- **Posts:** accepted live posts of the month, per channel, and the top 10, each with:
  - its public provider link;
  - provider-reported interactions (likes, comments, shares, clicks, bookmarks, quotes; impressions are not counted);
  - GA4 sessions and key events that arrived through its tagged link, in GA4's stored period (see `SAAS-MEASUREMENTS.md`).

  A post without a reading shows "—", never zero.
- **Comments and messages:** counts only — received, comments, messages, answered, messages answered within 24 hours, open, dismissed. No text, author or recipient.
- **Email:** pilot sends of the month, with the accepted, delivered, bounced and complained recipients. Acceptance is not delivery; opens and clicks are not tracked.
- **Ads:** plans that ran into the month, with the provider-reported spend, impressions and clicks for the whole plan up to the last reading (labelled as such).
- **Goal measurements:** the first and last reading of each goal stage and source in the month.
- **Work done:** drafts, coach actions done, content plan items approved and tasks completed.
- **Optional team note:** up to 1,200 characters.

The footer states the honesty rules: figures are not proof of cause, no estimates or ROI, and no personal data.

## Lifecycle and permissions

- Any member can preview. `content.write` edits the note of a draft.
- `campaign.approve` approves, shares, turns off links and withdraws an approval.
- **Approval** is possible only for a completed month and needs an explicit acknowledgement.
  - The live figures must still hash to the digest the approver saw (409 otherwise).
  - The snapshot and note are frozen; later records never change an approved report.
- **Withdrawing** an approval returns the report to draft and turns off every link at once. Re-approving never revives an old link, because a link is bound to the report revision.
- **Links** last 7, 30 or 90 days, with at most 5 active links per report.
  - The token (32 random bytes) is shown once and only its SHA-256 hash is stored.
  - Links are listed only to approvers, with their views and last view.

## The shared page

`/report#token=…` is public and `noindex`, with `no-referrer`.

- The token sits in the URL fragment, which the browser never sends to the server.
- The page posts it to `/api/report`. That endpoint needs the same origin, is rate-limited per token and globally, and sends no cookies.
- Unknown, expired, turned-off, withdrawn and non-standard-project links all get the same 404.
- The page offers "Print / PDF" (print stylesheet). The report is in the language it was approved in.

## Storage

- `platform_monthly_reports`: one row per project and month, holding the draft note, or the approved snapshot with its digest, approver and time, and a revision.
- `platform_report_shares`: token hash, report revision, expiry, revocation and view count.

## Files and tests

- Server: `lib/platform/monthly-report.ts` and `monthly-report-types.ts`.
- Routes: `app/api/platform/monthly-report/route.ts` and `app/api/report/route.ts`.
- Page: `app/report/page.tsx`.
- UI: `MonthlyReportPanel.tsx`, `MonthlyReportDocument.tsx` and `SharedReportPage.tsx`.
- Middleware: the exact `/report` and `/api/report` paths.
- Tests:
  - `test/platform-monthly-report.test.cjs`;
  - HTTP checks in `test/platform-http.test.cjs` — the anonymous page, the uniform 404, Origin required, and the internal API at 401.
- QA: `scripts/preview-design.cjs --dev --link-tracking --monthly-report`. It moves the fixture posts into last month and adds inbox records and readings.
