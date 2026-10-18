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
| Apple | Public iTunes lookup by explicit App Store ID/country, bundle match, listing metadata snapshot | Confirm real published app and country. No App Store Connect editing or publishing. Lookup does not provide all ASO fields. |
| Google Play | Authenticated Publisher listing read using an existing edit ID, package and locale | Customer-owned service account, access and existing edit. Ryzevo never inserts, commits or deletes Publisher edits. Screenshot count is unknown in this adapter. |
| AppsFlyer | Authorized JSON install/session/attribution ingestion with external app identity | Configure Push API authorization and matching fields/timezone. Stable customer_user_id must match the bridge identity. |
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
