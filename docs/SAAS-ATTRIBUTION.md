# Which work brought customers: first-touch attribution (30 October 2026)

## What it answers
For each tagged post or email: how many people who first arrived through it went on to reach each goal stage (for example signup, then payment), and optionally the amount they paid.
- The figures come from the team's own product events (signed webhook), not from GA4 conversions.
- They are observations of people who carried the tag, never credited causes. The panel and the monthly report say so.

## How a person is followed
1. **Tagging (existing, extended):**
   - Links to the project's own site already carry `utm_campaign=rz_<10 hex>` in social posts (`linkTag`, `tagOwnLinks` in `lib/platform/link-tracking.ts`).
   - Email campaigns now carry it too, with `utm_source=email&utm_medium=email`.
   - The tag is applied in `CampaignReviews.campaign()` (`lib/platform/campaign-review.ts`). The review, its digest, the preview and the pilot snapshot all carry the tagged text.
   - A campaign without own-site links keeps its old digest. Turning tagging off changes the digest, so the campaign needs approval again.
2. **The snippet** (`ATTRIBUTION_SNIPPET` in `lib/platform/attribution-types.ts`, shown in Project settings → Product data):
   - It keeps the first clean `utm_campaign` / `utm_source` / `utm_medium` in a first-party cookie `ryz_touch` for 90 days.
   - It writes nothing until the site calls `ryzevoTouch.allow()` from its consent banner, or the tag says `data-consent="granted"`. `data-domain` covers subdomains.
   - It never sends anything anywhere.
3. **The event:** the team's server reads the cookie at signup and adds it to the webhook event as an optional `attribution` object.
   - Fields: `campaign` (1–100 `[A-Za-z0-9._:-]`), `source` and `medium` (≤64 characters), `touchedAt` (ISO).
   - A malformed object is dropped, never the event. The response and the preview count it (`attribution.ignored`).
   - Events without the field keep the digest they always had.
4. **Matching:**
   - The person is an HMAC of entity type and id within the project (`attributionEntity`). The same person in another source matches; for example, a payment from the billing source matches a signup from the app source.
   - The earliest touch wins. A later delivery replaces the stored touch only when it happened earlier.
   - A touch is never later than the event that reported it.
   - An event counts for the touch when it happened after the touch and within 90 days of it.

## Storage (schema 65)
| Table | What it holds |
|---|---|
| `platform_attribution_touches` | One first touch per person: the tag, source and medium. |
| `platform_attribution_events` | A pseudonymous trail (entity key, event name, time, optional amount). It outlives the 30-day raw events: 400 days, and at most 200,000 rows per project (oldest first). |
| `platform_attribution_settings` | Which numeric attribute of which event is the amount, and its currency. |

- No entity id or attribute value is stored in these tables.
- The worker prunes them next to `pruneProductEvents`.

## Report (`lib/platform/attribution.ts`, `GET /api/platform/attribution?days=30|90`)
- **Stages:** goal stages mapped to product events in Analytics → Automatic measurements, in goal and stage order. Without a mapping, the most frequent event names stand in.
- **Per post or email:**
  - people per stage;
  - channels (utm_source);
  - the amount;
  - GA4 sessions, in GA4's own 90-day period.
  - The tag is matched to the project's content items and campaigns by recomputing `linkTag`.
- **Other rows:**
  - totals per channel;
  - "Campaigns outside Ryzevo": clean campaigns without an `rz_` tag;
  - Ryzevo tags that are deleted or not in this project.
- **Coverage:** of the people who reached the first stage, how many had any known first touch and how many a Ryzevo tag.
- **Who can see what:**
  - Reading needs `read` in a standard project. Crewin has no product events and gets 403.
  - The amount setting needs `connections.manage` and applies to events received after it is saved.

## Where it shows
- **Analytics:** "Which work brought customers" (`AttributionResults.tsx`), with a 30/90-day period. Until the first tagged event arrives, the panel shows three setup steps: source, snippet, stage mapping.
- **Publication card** (`PublicationSite.tsx`): people per stage who first came through that post on that channel in the last 90 days.
- **Monthly report:** `facts.results` gives people per stage for the month's items and channels, with a coverage line. Only counts are kept. Reports approved earlier have no such section.
- **Product data → Signed webhook:** snippet, server example, the field, and the amount setting (`AttributionSetup.tsx`). The schema preview says how many sample events carry a tag.
- **Job guide:** the results job has "See which work brought your signups". It is done once a tagged event has arrived.

## Limits
- Instagram captions and WhatsApp button links are not tagged.
- Mobile events do not feed touches yet.
- First touch only; there is no multi-touch model.
- Without consent the snippet keeps the touch only in memory for that page view. If the banner is accepted on a later page, the touch from the landing page is lost.

## Tests
`test/platform-attribution.test.cjs` covers:
- field validation;
- the stored trail with no ids, retries and digests;
- first touch and out-of-order deliveries;
- the clamp to the event time, cross-source matching and the 90-day window;
- per-stage counts, channels, other campaigns, unmatched tags, coverage and amount;
- `forTag` and the monthly report;
- gates (viewer, other project, Crewin);
- pruning;
- email link tagging and the digest;
- the snippet (no cookie before consent, first touch kept, unclean values refused).
