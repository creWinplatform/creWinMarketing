# Mobile growth - implementation and acceptance

18 October 2026. Standard Ryzevo projects have a shared **Mobile Growth** tool.
The Crewin legacy pack and its external API contracts are unchanged. This is a
server-side integration, not a native iOS/Android application or an SDK installer.
No customer provider account was accessed and no real notification was sent.

## Existing modules reused

- Existing organization/project RBAC and trial/pilot entitlements.
- Existing AES-GCM connection vault, not a second plaintext key registry.
- Existing ProductWebhooks canonical events, source versions and ingestion quotas.
- Existing campaign drafts, work-calendar tasks and durable platform worker jobs.
- Existing backup verification, lease handling and operational monitoring.

Schema 29 adds scoped app/configuration/sidecar tables. The exact stock standard
module list is upgraded to include mobile; customized module selections and the
Crewin catalog are not silently overwritten. The module can be enabled in a
standard project's settings. Maximum three apps per project, within the existing
shared source quota. Back up the database and encryption key before deploying.

## Provider matrix

| Provider | Implemented | Separate acceptance required |
| --- | --- | --- |
| Apple | Public iTunes lookup by explicit App Store ID/country, bundle match, listing metadata snapshot; keyword positions from the public iTunes Search API; App Store Connect API listing read and approved writes (see ASO below) | Confirm real published app and country. Search positions approximate the App Store app (no personalisation, no ads). Nothing is submitted for review. |
| Google Play | Authenticated Publisher listing read (a saved edit ID, or a throwaway edit that is deleted) and approved listing writes in a committed edit | Customer-owned service account with listing access. A commit can go through Google's review. Screenshot count is unknown in the listing read. No public search API, so no keyword positions. |
| AppsFlyer | Authorized JSON install/session/attribution ingestion with external app identity | Configure Push API authorization and matching fields/timezone. Stable customer_user_id must match the bridge identity. |
| AppsFlyer SKAN | SKAN aggregated performance report (SKAN 4, `/api/skadnetworks/v3`), read on demand as CSV with columns matched by name | API V2 token (tokens made before 10 March 2026 were revoked by AppsFlyer), iOS app id (`id…`), report currency. Check the column names against a real export. |
| Adjust | Authorized normalized JSON install/session/attribution ingestion | A customer server relay must convert native GET/query/form callbacks and timestamps; direct raw callbacks are NOT supported. |
| Firebase | FCM HTTP v1 single-device push adapter, scoped service-account authentication | Install client SDK, OS permission, refresh/revoke token registration, Firebase project/API grants and controlled physical-device test. Credential verification alone is not delivery verification. |
| OneSignal | Scoped app-access probe and explicit external-ID push targeting | Install SDK, establish external ID, consent, app REST key and controlled device test. No broad segment targeting. |
| Branch | Explicit campaign-bound short-link creation with safe fallback URLs; association JSON preparation | Separate gate, app/link-domain configuration, publish association files, install Branch SDK and test installed/deferred flows on devices. No automatic retries for uncertain creation. |
| RevenueCat | Authorized production webhook ingestion for observed purchases, refunds and subscription events | Customer-owned project/app ID, configured authorization header and stable app_user_id. Client SDK/paywall, StoreKit/Play Billing and entitlement enforcement remain in the customer's app/backend. |

Ryzevo does NOT initiate store purchases, validate native receipts independently,
grant application entitlements or change a project's Ryzevo paid plan from a
RevenueCat event. Ordinary cancellation is not a refund. Missing prices remain
unknown; unsupported refund reversals suppress net/ROAS rather than fabricate a
reconciled balance. Subscription badges show last observed events, not verified
current access. Sandbox/TEST events do not become production financial metrics.

## Setup order

1. Register the app, website, country/locale, store/bundle/package identities.
2. Choose ONE primary install source (bridge, AppsFlyer or Adjust) and ONE primary
   revenue source (bridge or RevenueCat). Other connected providers are not summed.
3. Configure project-owned provider credentials in Mobile Growth > Integrations.
   Saved secret values are never returned to the browser. Service-account JSON
   and webhook Bearer secrets belong on servers, never in a mobile app package.
4. Activate the bound source. Activation checks the schema only; it does not prove
   real app events. Configure the trusted app backend relay and test real events.
5. Use the same opaque non-email customer ID for attribution, sessions, purchases
   and device registration. Confirm this mapping in app settings only after testing.
6. Register device/in-app contacts with explicit consent evidence. Mark only
   approved test contacts in the operator pilot allowlist. Preview an existing
   campaign draft, run rehearsal, then conduct a separately authorized live test.

## API contracts

Panel API: authenticated `GET/POST /api/platform/mobile`. Identity and scope come
from the session, never the client-supplied organization/project. Mutations require
same-origin plus action-specific existing RBAC. GET exposes safe configuration,
last-observed status, masked contact references, report data and gate state.

Provider API: **POST** `/api/platform/mobile-hooks/{connectionId}` with
`Content-Type: application/json` and the configured `Authorization: Bearer ...`.
The exact 32-hex path is cookie-free, not authentication-free. Origin headers are
rejected. Maximum 64 KiB, five-second input deadline and 120 requests/minute per
connection. Revocation, credential rotation and manager permission are rechecked
after reading the body. Responses do not echo provider credentials/raw payloads.

Bridge examples (send from a trusted authenticated customer backend):

```json
{
  "appId": "APP_ID",
  "events": [{
    "id": "stable-unique-event-id",
    "entityId": "opaque-user-42",
    "kind": "install",
    "occurredAt": "2026-10-18T09:00:00Z",
    "campaignId": "provider-campaign-name",
    "channel": "paid-social"
  }]
}
```

Supported bridge kinds: install, session, activation, attribution, purchase,
refund, subscription. Purchase/refund also require amount (non-negative number),
currency (three uppercase letters) and transactionId. Subscription accepts status
and productId. `environment: "sandbox"` excludes data from production reporting.
Events use stable IDs, max 20 per request, strict ISO timezone or numeric epoch in
provider adapters. No IP, advertising ID, email or raw provider payload is retained.
Entity IDs are app-specific keyed hashes in canonical events.

```json
{
  "action": "register", "appId": "APP_ID", "entityId": "opaque-user-42",
  "provider": "onesignal", "destination": "customer-external-id",
  "recordedAt": "2026-10-18T09:00:00Z", "evidenceRef": "consent-record-42",
  "consent": { "push": true, "inApp": false }
}
```

Provider may be onesignal, firebase (destination = FCM device token), or bridge
(no push destination; push consent must be false). Maximum 1,000 contacts/project;
panel shows the latest 100. Tokens, identifiers and evidence are encrypted. Old
consent does not override newer consent. Changed destination/consent clears pilot
approval. Revocation is checked before each dispatch. Your authenticated backend
must authorize which user it registers; never expose this server Bearer to clients.

After the trusted backend has durably ingested a continuous interval it may send
`{ "action":"coverage", "appId":"APP_ID", "through":"ISO_TIMESTAMP" }`.
Do not claim complete intervals for unverified/missing callbacks. The start bound
is the source's activation time; pausing/configuring the source resets coverage.

In-app delivery uses the same bridge server endpoint:

- `{ "action":"feed", "appId":"...", "entityId":"..." }` returns at most five
  scheduled, active, unexpired approved messages for that specific pilot identity.
- `{ "action":"feedback", "appId":"...", "entityId":"...", "messageId":"...",
  "event":"impression" }`; event may be impression, clicked or dismissed.
- The native client must render the feed, handle navigation and send feedback via
  its authenticated app backend. Reading the feed is NOT an impression. No hosted
  native UI or background mobile SDK is claimed.

## Reporting semantics

Closed UTC days; maximum 31-day report range in the last 90 days. Mobile canonical
events have a 90-day retention exception; generic web sources retain their
existing 30 days. Shared project quota remains 1,000 events/day and 10,000 retained
events, not a promise of unlimited 90-day storage. A source can fill the quota
before 90 days. The existing projection is not a full mobile raw-data warehouse.

Installs are first **observed** per identity in the retained window, from the
selected primary source, not independently verified unique physical devices.
Unknown complete intervals remain null, not synthetic zero. D1/D7/D30 are exact
UTC-day session return rates, not rolling retention. Rates require matured cohorts,
continuous source coverage, identity confirmation and no truncation. Session return
evidence comes from the bridge. Old installs beyond retention cannot be reconstructed.

Spend entries are explicitly manual, dated, currency-specific and linked to the
existing campaign plus the provider campaign name. CPI matches exact acquisition
day/campaign. ROAS additionally matches purchaser identity and currency, deduplicates
transaction IDs and subtracts observed refunds. No currency conversion, tax/fee
calculation or claimed causal lift. Partial/missing/conflicting revenue data suppress
net/ROAS. Manual spend is not an ads API synchronization or audited accounting.

## Additions (4 November 2026)
- **Audiences:** `preview` and `enqueue` take `audience`:
  - `pilot` (the default): the 1–5 allowlisted contacts, unchanged;
  - `all`: every contact with consent for the channel;
  - `segment`: `segmentId` + `segmentVersion`; members are matched through `mobileEntity(key, appId, memberId)`;
  - `entities`: an explicit id list, used by automations.
- **Limits for broad audiences:**
  - One device per person, at most 1,000 recipients (`MOBILE_AUDIENCE_MAX`).
  - The allowlist flag is not part of the frozen target revision. Consent and destination still are.
  - A live send to a non-pilot audience also needs `PLATFORM_MOBILE_BROADCAST_ENABLED=1`.
  - Pushes per project per day: `PLATFORM_MOBILE_PUSH_PER_DAY` (default 5).
- **Push automations:**
  - An automation can use `channel: push | in_app` with `mobile: {appId, connectionId}`.
  - **Message content:** the title and text come from a campaign draft.
  - **Recipients:** approving enqueues one mobile job for the ready people whose app id equals the trigger source's id and who have consent for the channel.
  - **Unreachable people:** the others leave on a send (`not_sendable`).
  - **Gates:** a send still needs the live and broadcast switches.
- **Ad spend sync:** `syncAdSpend` pulls the daily spend of an ad-manager plan from Meta, Google Ads, LinkedIn, TikTok or Apple Search Ads.
  - **Period:** the last 30 closed days within the plan's dates.
  - **Storage:** rows go into `platform_mobile_costs` as `ad:<provider>:<plan>`, matched to installs by the provider campaign name (the plan name unless one is given).
  - **Warnings:** the report shows `spend_synced`, and `spend_manual` only when manual rows exist.
- **Limits:**
  - Event quotas follow the plan (`projectEventLimits`): 1,000/day and 10,000 stored for trial, pilot and Launch; 5,000/50,000 for Growth; 20,000/200,000 for Team and the Crewin workspace.
  - Receipts are kept for ten times the stored limit.
  - The mobile report reads up to 90 closed days, bounded by the stored limit.
- **Profile links:** Instagram and TikTok profile links with fixed tags are listed under Product data → Signed webhook → Source tag.
- **Tests:** `test/platform-mobile-attribution.test.cjs`, `test/platform-mobile-audience.test.cjs`.

## ASO (schema 70, 4 November 2026)

The ASO tab adds three things next to the store audit.

**Keyword positions (App Store only).**

- **What is tracked:** up to 30 terms per app, each with its own country.
- **Where the position comes from:** Apple's public iTunes Search API (`/search`, `entity=software`, `limit=200`). The position is the app's place among those 200 results; "not in top 200" means the app is not among them.
- **How often:**
  - The worker checks five terms per tick, once a day each.
  - "Check now" checks up to ten terms that were not checked today.
  - A failed read is not retried the same day.
- **What is kept:** 400 days of history. The table shows the change against the previous check, the last 7 positions and the top three apps.
- **Limits of the number:**
  - It is close to the App Store app's own order but not the same: there is no personalisation and no ads.
  - It is never presented as a ranking promise.
  - Google Play has no public search API, so it has no positions.

**SKAN from AppsFlyer.**

- **Connection:** the `appsflyer_skan` integration needs the iOS app id (`id…`), the report currency and an AppsFlyer API V2 token. This is separate from the AppsFlyer webhook integration.
- **What a pull reads:** the SKAN aggregated performance report for an install-date range:
  - at most 90 days;
  - ending before yesterday;
  - by default, the last 30 days up to three days ago.
- **How the CSV is read:**
  - Columns are matched by name: Date, Media Source, Campaign, Country, Installs, Clicks, Total Revenue, Total Cost, Converted Users.
  - Rows with the same day, source, campaign and country are summed.
  - `N/A` stays unknown.
- **Storage:** a second pull replaces the whole range, so nothing is counted twice.
- **What the analytics tab shows:** totals and a per-source and per-campaign table with eCPI.
- **Data caveats:** SKAN numbers are aggregated by Apple, delayed and thresholded for privacy. They are never added to the bridge install counts.

**Listing drafts.**

- **Fields:**

  | Store | Fields (character limit) |
  |---|---|
  | App Store | name and subtitle (30 each), keywords (100), promotional text (170), description and what's new (4000 each) |
  | Google Play | title (30), short description (80), full description (4000) |

- **Writing a draft:**
  - Only the filled fields are written.
  - Keywords are cleaned: spaces around commas and repeated words are removed.
  - "Load the store text" fills the form from App Store Connect or Google Play and saves nothing.
- **Checks shown on a draft:**
  - keywords that repeat words already in the name or subtitle;
  - unused keyword space;
  - a short name;
  - a short Play description;
  - a short description that only repeats the title.
- **Approval:**
  - Editors write drafts; `campaign.approve` approves the exact text (a digest).
  - Any edit clears the approval.
- **Writing to the store** needs all of the following:
  - `connections.manage`;
  - `PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED=1` (off by default);
  - an explicit acknowledgement;
  - an unchanged approval.
  - The draft is claimed first, so a second click cannot write twice.
- **App Store Connect:**
  - **Key:** a team API key (issuer id, key id, `.p8` EC key) signs a 20-minute ES256 token per run. The key is stored only in the encrypted connection.
  - **Where the fields go:**
    - name and subtitle go to the editable app info localization;
    - the other fields go to the editable version localization (states such as `PREPARE_FOR_SUBMISSION` or rejected);
    - promotional text alone can also go to the live version.
  - **Locale:** a missing locale is never created.
  - **Review:** nothing is submitted for review; the team submits the version in App Store Connect.
- **Google Play:**
  - A new edit is created, the listing for the locale is patched and the edit is committed.
  - If the patch fails, the edit is deleted and nothing is committed.
  - A commit can go through Google's review.
- **History:** written drafts stay as history and cannot be edited.

**Files:**

- Code: `lib/platform/mobile-aso.ts`, `mobile-aso-providers.ts`, `mobile-http.ts`, `components/platform/MobileAso.tsx`.
- Migration 70 adds `platform_mobile_keywords`, `platform_mobile_keyword_ranks`, `platform_mobile_skan` and `platform_mobile_listing_drafts`.
- **Tests:** `test/platform-mobile-aso.test.cjs`, with fake Apple, App Store Connect, Google Play and AppsFlyer responses and a throwaway EC key; no network.

## Store reviews, competitors, AI listing proposals and the monthly report (schemas 71–72, 4 November 2026)

**Store reviews (Reviews tab).**

- **Reading:**
  - App Store Connect: the latest 200 reviews with their published responses.
  - Google Play: reviews written or changed in the last week, which is the API's own window.
  - The worker reads each connected store once a day, as the person who set up the connection, one store per tick. "Get reviews" reads now.
  - Up to 1000 reviews per app are kept for 400 days.
- **What is shown:**
  - per store: the average, the 1–5 distribution, the last 30 days and the unanswered count;
  - the latest reviews, with an all, unanswered or 1–3 star filter.
- **Replies:**
  - Editors write a draft. "Draft with AI" fills the form only. Its rules: no invented facts, promises, links or contact details, and no personal details from the review.
  - An approver accepts the exact text; any edit clears the approval.
  - Limits: 5970 characters on the App Store, 350 on Google Play.
- **Sending a reply** needs all of the following:
  - `connections.manage`;
  - `PLATFORM_MOBILE_REVIEW_REPLY_ENABLED=1` (off by default);
  - an explicit acknowledgement;
  - an unchanged approval.
  - The reply is claimed before the call, so it is sent once.
  - App Store: `POST /v1/customerReviewResponses` (a new response replaces the old one). Google Play: `reviews/{id}:reply`.
  - A failed reply stays as a draft to edit and approve again.

**Competitor apps (ASO tab).**

- Up to five App Store apps per app, added from the apps ranking above in the tracked searches or by App Store ID. An ID is looked up once.
- Their positions are taken from the same search results when the app's own terms are checked, so no extra request is made.
- They are stored as `competitors_json` with each day's check.

**AI listing proposals.** "Suggest with AI" in the listing draft form proposes the store fields from:

- the current text;
- the tracked terms and positions;
- the names of the apps above, for context only.

The proposal is checked before it reaches the form:

- it is clipped to the store limits;
- keywords that repeat words already in the name or subtitle are dropped;
- a proposal with a link, a promise, personal details or a competitor's name is refused;
- it fills the form only and is saved and approved like any draft.

**Monthly report.** A "Mobile app" section per app carries:

- installs from the app's own events (kept 90 days);
- campaign spend and CPI;
- SKAN totals;
- store ratings and replies sent this month;
- App Store positions at the first and last check of the month.

It holds counts only, never review text, authors or replies.

**Files:**

- Code: `lib/platform/mobile-reviews.ts`, `mobile-month.ts`, `mobile-aso.ts` (competitors and `suggestListing`), `components/platform/MobileReviews.tsx`.
- **Tests:** `test/platform-mobile-reviews.test.cjs`, `test/platform-mobile-aso.test.cjs`.

## Delivery and operations

`PLATFORM_MOBILE_SEND_ENABLED=0` and `PLATFORM_MOBILE_LINKS_ENABLED=0` by default.
These gates are independent of SES/social and do not copy Crewin credentials.
Live delivery also requires project entitlement, existing campaign approval/dispatch
permissions, a current preview digest and explicit acknowledgement. At most five
pilot contacts per job and five push submission attempts/project/day. This is a
controlled pilot workflow, not unrestricted production broadcasting.

Messages reuse existing platform jobs, worker leases, approval snapshots and work
calendar. Editing app/campaign/connection, removing approval authority, consent or
pilot selection invalidates frozen sends. Process-crash after submission becomes
uncertain, never an automatic resend. Accepted provider IDs are not delivered/opened
receipts. Cancellation stops future sends; it does not retract accepted messages.
In-app active jobs may remain visible until expiry; feedback/cancellation is scoped.

Store metadata audits are bounded presence/length checks, not invented keyword
volume/rank/competitor analysis. ASO tasks deduplicate into the existing calendar;
they do not publish store content. Universal/App Links JSON requires native and
domain deployment by the app team. The platform never publishes association files
on customer domains or signs customer app builds.

## Acceptance checklist

- Isolated automated tests: scope, credentials, event identity/replay, primary
  source, timestamp, coverage/maturity, currencies, dedup/refund, consent, pilot,
  rehearsal, uncertain sends, cancel, in-app feedback and migration/recovery.
- Production build and real HTTP boundary test; desktop/tablet/mobile Chrome QA.
- Pending external acceptance: real provider grants, correct callback mappings,
  native SDK/consent integration and actual device receipts/deferred links. No
  fixture counter, local credential probe or simulated response closes that work.

## Primary references

- [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
- [OneSignal create message](https://documentation.onesignal.com/reference/create-message)
- [AppsFlyer Push API](https://support.appsflyer.com/hc/en-us/articles/207034356-Push-API-streaming-raw-data)
- [Adjust callback structure](https://help.adjust.com/en/article/callback-structure-partner)
- [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks)
- [RevenueCat event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
- [Branch deep links](https://help.branch.io/apidocs/deep-linking)
- [Google Play listing read](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/get)
- [Android association files](https://developer.android.com/training/app-links/configure-assetlinks)
- [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [App Store metadata limits](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
- [Google Play listing limits](https://support.google.com/googleplay/android-developer/answer/9859152)

## Local verification record

- `npx tsc --noEmit`: passed.
- Production `npm run build` using isolated `.next-monolith-platform`: passed,
  28 static pages, including the authenticated mobile API and provider hook route.
- Full platform regression: **446 passed, zero failed/skipped**; 28 mobile tests.
- Production HTTP acceptance: passed, including mobile tenant isolation, CSRF,
  exact public-hook authorization, credential redaction and bridge registration.
- Chrome: desktop, 768px tablet, 390px and 320px. Document width stayed within the
  viewport; 600px tables scroll inside their own 339px mobile regions. Refresh
  icon corrected and measured at 18px inside a 44px button.
- Actual browser operations in the disposable fixture: ASO task creation, manual
  ASO snapshot, existing campaign preview/approval -> rehearsal, and existing
  calendar linkage of both the ASO task and completed rehearsal. TR/EN checked.
- No external provider or device call occurred in these fixtures. Explicit sample
  app/project labels distinguish QA counters from actual customer results.
- QA server stopped. Main development server restarted on **3033** after an
  existing-tool sealed local backup; health returned 200. Mobile send, Branch
  create, email/social publication and other production gates remain OFF.
- No EC2 deployment, native SDK installation, customer grant or real store
  purchase/device delivery acceptance was performed.

Screenshots: [desktop](screenshots/mobile-overview-desktop.jpg),
[390px](screenshots/mobile-overview-390.jpg),
[rehearsal](screenshots/mobile-rehearsal-desktop.jpg),
[shared calendar](screenshots/mobile-calendar-linkage.jpg).
