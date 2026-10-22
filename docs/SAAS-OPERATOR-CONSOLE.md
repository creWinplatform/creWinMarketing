# Operator console and ready first week (22 October 2026)

## Operator console (Project settings → Operations)

Only the deployment administrator sees this tab: the team running Ryzevo, signed in with `ADMIN_USERNAME`.
- The API is `/api/platform/operator`. It requires `members.manage` and the `legacy-admin` subject.
- Customer sessions get 403, and the tab is hidden for them.

### Go-live readiness

Each item shows whether a server setting is present (ready, attention, missing or off). The setting's value is never returned.
- **Groups:** core and security, email, social, messaging, ads, AI, billing.
- **Encryption key:** the "connection encryption key" item warns when the key lives only in `data/platform-credentials.key`. If that file is lost, every customer connection becomes unreadable. Back it up and set `PLATFORM_ENCRYPTION_KEY`.
- **AI check:** "Check" asks Gemini for the model's description. The key goes in the `x-goog-api-key` header, and no content is generated.
- **Customer connections:** active connections per provider in standard projects. Next to each count is how many passed a publish check in the last 7 days.
- **Webhook addresses:** the addresses to give the providers.

### Customer setup funnel

Standard projects opened in the last 30, 90 or 365 days go through these steps:
1. account created;
2. diagnosis started;
3. strategy approved;
4. path chosen;
5. first channel connected;
6. first rehearsal;
7. first live send.

For each step the console shows:
- **Reached:** the number of projects that reached the step.
- **Stalled:** projects that reached the step but not the next one, and are older than 3 days.

It also shows active trials, ended trials and pilots.

The funnel shows counts only. It contains no names, addresses or customer identifiers.

## Ready first week

When the brief is approved:
- This month's rule-based content plan is prepared, but only if the month is still empty.
- Up to three early plan items get starter drafts in the content library.
  - The drafts are spread over different topics and channels.
  - Email items are skipped.

Each starter draft:
- **Is a frame, not finished copy:**
  - the first line is a `{{… — write your own example here}}` prompt;
  - then come the approved positioning and the website;
  - the plan item's instruction goes into the draft's brief field.
- **Cannot be published untouched:** publishing refuses any text that still contains `{{…}}`.
- **Carries a marker:** it has `starter: true` until the team saves it from the editor. The editor rebuilds items from known fields only, so saving drops the marker.
- **Is not counted early:** the Compass "first content" step and the coach's learning view ignore it until it is saved.
- **Never blocks the approval:** if the content limit is reached or the trial has ended, the approval stands and no draft is forced.

The coach notice says how many starters are ready and links to the library. The library labels them "Starter draft · read and edit".

## Tests

- `test/platform-operator.test.cjs`
- `test/platform-coach-first-week.test.cjs`
