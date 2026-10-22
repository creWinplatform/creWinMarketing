# PayTR sandbox integration

> 22 October 2026: live prepaid plans were added later (schema 54) behind their own
> switch. See "Live prepaid plans (schema 54)" below; the sandbox boundary that
> follows is unchanged.

## Delivered boundary

This is a TEST-ONLY payment preparation and notification layer in the existing
Ryzevo monolith. It is not live billing or recurring subscriptions. There is no
live-mode switch, saved card API, renewal worker, invoice generation, refund
operation, paid plan activation or quota upgrade. No provider request was made
with real merchant credentials during development.

Existing project identity, RBAC, verified account email, AES-GCM credential
envelope, audit trail and private request helpers are reused. Migration 24 adds
only project-bound `platform_billing_orders`; prior usage/membership data remains.
Ryzevo merchant secrets are server environment configuration, NOT a customer's
marketing connection and never inherited from legacy Crewin payment settings.

## Interface and authority

- `GET /api/platform/billing`: session-selected project readiness, configured TEST
  prices and latest 20 orders. No secret, contact/address, other project invoice
  data or client-controlled scope. Private/no-store and no-referrer.
- `POST /api/platform/billing`: action `start`, operator-configured `planId`,
  `idempotencyKey`, `language`, contact `{name,phone,address}`. Requires same-origin
  browser request, verified account email, all configuration gates and a trusted
  single client IP. Price/currency/paid/tenant fields are rejected.
- New `billing.manage` permission is granted only to project owners. It does NOT
  imply organization-wide invoice authority. Admin/editor/analyst/viewer, legacy
  accounts and Crewin-pack projects are denied. Owners can delegate ownership
  only through the existing ownership controls.
- Project settings > Plan & usage includes a PayTR test section for owners only.
  Aggregate quota data remains available to ordinary project readers.
- `POST /api/platform/billing/paytr/notify` is the ONLY cookie-free payment path.
  Body is bounded URL-encoded form data. Responses are plain `OK` only after
  validation and durable handling. Other methods/suffix paths are not public.

## Safe provider contract

- Checkout is fixed to `https://www.paytr.com/odeme/api/get-token`, USD,
  `test_mode=1`, no installments, a ten-minute checkout and fixed HTTPS return
  origin. Redirect following and automatic retries are disabled. Timeout is 8s;
  provider response is bounded to 16 KiB. Private error text is never returned.
- Notification HMAC is SHA-256 over the documented concatenation
  `merchant_oid + merchant_salt + status + total_amount`, using merchant_key,
  compared in constant time. Do not invent a signed timestamp or event-ID field.
- Scope comes from a pre-existing unpredictable `RZTEST...` order ID. The frozen
  amount and merchant-key revision must match. Callback-only unsigned currency,
  test_mode, payment_amount and payment_type can flag review; they cannot grant
  live status or entitlements. Missing/mismatched metadata is not assumed valid.
- Price catalog edits do not invalidate notifications for earlier frozen orders.
  Rotating merchant secrets while tests are pending requires operator handling;
  no unknown historical secret is guessed or reused.
- Exact signed notifications are idempotent. Conflicting outcomes/amounts require
  review, never another entitlement. Old conflicting results are retained even
  while a newer test is pending. Only sandbox result states are recorded.
- One unresolved test per project and 20 attempts per rolling day. Uncertain
  provider responses and crashes are not silently retried. Expiration hides the
  bearer link but is NOT proof of failure/refund. Explicit sandbox status inquiry
  is now available as described below. Contradictory/refund histories still need
  operator review; no manual paid activation or automatic conflict dismissal exists.
- Checkout tokens are scoped AES-GCM encrypted at rest. Contact details/IP and
  raw provider notifications are not persisted. A hash binds request content.
  Successful/failed return-page navigation cannot change order state.

## Operator setup still required

All example flags default OFF, catalog empty. Actual `.env.local` was not changed.

1. Separate Ryzevo merchant account, PayTR approval for USD and foreign cards,
   current written rate/settlement quote and Akbank USD account conditions.
   USD recurring-payment capability must be confirmed separately.
2. Dedicated `PLATFORM_PAYTR_MERCHANT_ID`, `_MERCHANT_KEY`, `_MERCHANT_SALT`,
   `PLATFORM_PAYTR_ORIGIN` and an explicitly approved `_TEST_CATALOG`.
   Catalog amounts are integer USD cents, not proposed marketing prices.
3. After account confirmation, `_USD_ENABLED=1` is only an operator
   acknowledgement, NOT an API-verifiable proof. `_SANDBOX_ENABLED=1` enables
   tests only. No live-mode flag exists.
4. Register exact public HTTPS notification URL in the merchant panel. Deploy
   behind a trusted proxy that overwrites X-Forwarded-For and strips incoming
   spoofed values; append-only/multi-value chains are rejected. Use a dedicated
   test mailbox/identity and consent to share contact details with PayTR.
5. Perform an operator-authorized provider sandbox acceptance and inspect its
   callback, duplicates and failure outcomes. Unit fixtures are not this proof.
6. Decide paid pricing/entitlements, ownership, terms, tax/accounting, recurring
   tokenization/explicit mandate and cancellation before implementing live mode.
   Never store PAN/CVV in Ryzevo. Reuse existing worker only when a properly
   authorized recurring-payment contract has been designed.

## Explicit sandbox status inquiry (schema 26)

`POST /api/platform/billing` also accepts exactly
`{action:"check",orderId:"RZTEST...",idempotencyKey:"unique-key-at-least-16-chars"}`.
It requires current project owner authority, same origin, bounded JSON, configured
merchant credentials, USD acknowledgement and explicit sandbox gate. Client
tenant, amount, paid or test-mode claims are rejected. Only an existing scoped
test order for the same merchant-key revision can be queried. No charge, refund,
recurring-payment mandate or live entitlement request is made by this operation.

The official [status inquiry contract](https://dev.paytr.com/durum-sorgu) is
implemented as one fixed HTTPS request to `/odeme/durum-sorgu`, HMAC SHA-256 over
`merchant_id + merchant_oid + merchant_salt`. There are no redirects or retries;
8-second network timeout, 16-KiB response limit and bounded body-read deadline.
Inquiry amounts are decimal MAJOR currency units, unlike notification cents.
Dot/comma decimal strings are converted exactly without floating-point rounding;
ambiguous, oversized or missing data cannot confirm a payment. Masked card data,
authorization codes, customer information and raw provider errors are discarded.

- A positive result requires exact original amount AND total, USD, test mode 1,
  card payment, no installments and no refunds. It can change only a pending,
  preparing or uncertain TEST order to `test_paid`. The frozen order and existing
  pilot/trial quotas, expiry, preferences and subscription state remain unchanged.
- Provider `error/004` means no successful payment was confirmed, NOT a definitive
  failed payment. Network failures, malformed data and timeout do not close the
  order, release its payment lock or repeat checkout preparation.
- Mismatched details, refunds or conflict with signed failure flag `review`.
  A prior review history cannot be cleared automatically even by a later positive
  inquiry. Only aggregate reason labels are returned, never refund/card details.
- Exact idempotency keys reuse their recorded inquiry, bound to actor/order/merchant.
  One active check/order, at least 60 seconds between new checks and at most 40
  checks/project/rolling day. Reads/refresh never contact PayTR or guess success.
- A 15-second inquiry lease and order revision fence prevent a late query from
  overwriting a callback, changed configuration or revoked owner. Interrupted
  queries remain unconfirmed; explicit recovery cannot apply the old response.
- A matching late callback may strengthen an inquiry settlement; a contradictory
  callback flags review. Neither path can activate paid access. Callback replay
  protections and historical merchant matching remain in effect.

`GET` adds `statusCheckEnabled`; each order adds `settlementSource`, `latestCheck`
and `canCheck`. The panel shows the last checked time, safe reason, source of
confirmation and an explicit Check with PayTR command. This button stays disabled
while merchant setup is unavailable; the agent does not configure fake live keys.

Migration 26 adds a scoped inquiry ledger and order revision/source, preserving
schema 25 baseline rights and existing orders. No card or raw provider response is
persisted. An additive FK binds every inquiry to its original project order.

The merchant is NOT ready yet, as confirmed by the user on 18 October 2026.
No real provider status request, payment or financial account change was performed.

## Live prepaid plans (schema 54)

Live payment buys one prepaid period of a Launch or Growth plan for one
self-service (trial or paid) standard project. Decisions recorded 22 October 2026:
USD only, monthly or yearly periods, and a 7-day grace after a period ends.

| Plan | Monthly | Yearly (2 months free) | Seats | Social | AI / month | Audits / month |
| --- | --- | --- | --- | --- | --- | --- |
| Launch | $29 | $290 | 2 | 3 | 50 | 10 |
| Growth | $79 | $790 | 5 | 5 | 200 | 25 |

Boundary:

- No stored card, no automatic renewal, no recurring charge. Renewal is a new
  prepaid purchase that opens 14 days before the latest period ends (or during
  grace). A renewed period starts at the latest end, so periods are contiguous.
- Periods are calendar based in UTC (31 January + 1 month = end of February).
  Rights hold until `grace_ends_at`; the plan screen and the workspace show the
  grace notice. After grace the project falls back to its base row (an expired
  trial), new work stops and records are kept.
- Operator-provisioned pilot projects cannot buy a period: a paid period never
  replaces pilot rights, so the purchase form is hidden and the API refuses.
- Rights are created only from PayTR's signed notification for an `RZLIVE` order
  whose amount, currency (USD), `test_mode=0` and payment type match the frozen
  order. A second differing notice, a notice for a settled order or any metadata
  mismatch sends the order to `review` and opens nothing. A repeated identical
  notice is ignored. Returning browsers never change state.
- The live form needs a verified account email, the project owner
  (`billing.manage`), contact details sent only to PayTR, and an explicit tick for
  the terms at `PLATFORM_BILLING_TERMS_URL`. One open order at a time, 10
  attempts a day, idempotent by request key. Tokens are AES-GCM encrypted with
  the order id as additional data.
- Sandbox (`RZTEST`) and live (`RZLIVE`) orders live in separate tables and are
  routed separately by the shared notification URL; neither can settle the other.
- Invoices, refunds and tax documents remain manual (accounting). The page says so.

Switches (all off by default in `.env.local.example`):

1. `PLATFORM_PAYTR_LIVE_ENABLED=1` only after the PayTR merchant contract, USD
   approval and a live acceptance plan are confirmed.
2. The shared merchant values (`_MERCHANT_ID`, `_KEY`, `_SALT`), `_USD_ENABLED=1`
   and an HTTPS `PLATFORM_PAYTR_ORIGIN`.
3. `PLATFORM_BILLING_TERMS_URL`: an HTTPS page with the distance sales contract
   and pre-contract information. Without it live stays closed.

The operator console's PayTR item lists exactly which of these checks is missing
without printing any value. Before the first real customer, the operator makes one
small real purchase on a dedicated project, confirms the period, then handles the
refund manually. Development made no live PayTR request.

Verification: `test/platform-billing-live.test.cjs` (default off, gates, prices,
terms/email/owner, `test_mode=0`, idempotency, paid limits, review cases, no
sandbox/live mixing, renewal window, grace and fallback, calendar periods, pilot
refusal, operator item, repeatable migration). `scripts/preview-design.cjs --dev
--live-billing` shows the screen with disposable merchant values (add
`--live-billing-pilot` for the pilot view); never press Pay there.

## Primary references (18 October 2026)

- [PayTR iFrame request](https://dev.paytr.com/iframe-api/iframe-api-1-adim)
- [PayTR notification](https://dev.paytr.com/iframe-api/iframe-api-2-adim)
- [PayTR status inquiry](https://dev.paytr.com/durum-sorgu)
- [Direct API USD enablement](https://dev.paytr.com/direkt-api/direkt-api-1-adim)
- [USD settlement and subscriptions](https://www.paytr.com/destek-merkezi/urunler-ve-ozellikler)
- [Published starting rate, not a Ryzevo USD quote](https://www.paytr.com/paytr-sanal-pos)

## Verification

`npm run test:platform:billing` uses disposable SQLite and stubbed provider
responses only. Covers signatures, replay/conflicts, tenant and role isolation,
frozen amounts, token encryption/expiry, uncertain responses, callback races,
catalog/config changes, strict gates, bounded requests and additive migration.
The HTTP suite checks the private/read-only boundary and exact anonymous callback
path. `scripts/preview-design.cjs --billing` uses separate loopback test data with
PayTR and all actual publishing disabled.

`npm run test:platform:billing-checks` covers inquiry amounts/HMAC, strict gates,
scope/roles, exact replay, race/lease protection, refunds/conflicts, provider body
limits, redaction and additive migration without network. HTTP tests also cover
anonymous/foreign/viewer denial and default-off status checks. The isolated visual
fixture `scripts/preview-design.cjs --billing-checks` seeds stubbed QA-only results;
its HTTP server keeps provider gates OFF. Those examples are NOT live acceptance.
