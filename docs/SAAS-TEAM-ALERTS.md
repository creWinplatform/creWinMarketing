# Team alerts: "Needs attention" (schema 58, 27 October 2026)

The overview shows the records that need the team before a deadline passes. Each row links to the screen where the work is done.

Members can also opt in to an email. Nothing is ever sent to customers.

## What is shown

The alerts are computed live from existing records. Each kind appears only to members with the right that acting on it needs.

| Alert | When | Who sees it | Severity |
| --- | --- | --- | --- |
| Reply window closing | A message (not a comment) is still new and its 24-hour reply window closes within 6 hours. A reply that is only a draft or was rejected still counts; one that is sending or sent does not. | Members with the inbox "source reading" duty (owners hold it) | Urgent |
| Publication failed | A live post was rejected, stopped or has an unknown outcome in the last 7 days. Rehearsals are not included. | `campaign.dispatch` | Urgent if any outcome is unknown, otherwise warning |
| Connection expiring | An active social account grant ended or ends within 7 days. | `connections.manage` | Urgent if ended, otherwise warning |
| Plan and payment | The paid period ends within 7 days or is in its grace period, with no later period paid; or the trial ends within 3 days. | `billing.manage` (owner) | Urgent in grace, otherwise warning |
| Ad error | An ad plan has a provider error in the last 7 days. | `connections.manage` and `campaign.approve` | Warning |

Viewers and analysts see no alerts. When nothing is open and email is off, the card is hidden.

## Email (opt-in)

- `PLATFORM_ALERT_EMAIL_ENABLED=1` turns email on, together with the account-email SES settings (`PLATFORM_AUTH_*`). It is off by default.
- A member with a verified account email opts in from the card. Opting in marks everything already open as seen, so the first email is about something new.
- The worker looks at one subscriber per tick; each subscriber is looked at again after at least 10 minutes.
- An email is sent only when an open record has not been mailed to that member before, and at most once every 3 hours and 6 times a day.
- It is recorded as `submitted` before the SES call and never retried. A failed call is `uncertain`, and the records it covered are not mailed again.
- Before each email, the worker re-checks:
  - that the person is still an active member;
  - that the project is a standard project;
  - that the account email is still verified;
  - the person's rights.
- The email contains counts, deadlines in the project's time zone and links only. It contains no message text, contact, account name or plan name.
- Notices of records that are no longer open are forgotten after 30 days.

## Storage

- `platform_alert_subscriptions`: member, project, language and when the member was last looked at.
- `platform_alert_notices`: the record keys already mailed to that member.
- `platform_alert_deliveries`: one row per email (submitted, sent or uncertain) with its item count.

## Files and tests

- Server: `lib/platform/team-alerts.ts` and `team-alerts-types.ts`.
- Route: `app/api/platform/alerts/route.ts`.
- UI: `components/platform/TeamAlerts.tsx` on the overview.
- Worker: `deliverNextAlertEmail`.
- Tests: `test/platform-team-alerts.test.cjs`.
- QA: `scripts/preview-design.cjs --dev --inbox --alerts`. It shows a closing reply window, a rejected live post and a grant ending tomorrow; email stays off and nothing is sent.
