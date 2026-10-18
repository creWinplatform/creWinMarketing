# Ryzevo plan and usage foundation

Update 18 October 2026: schema 25 adds the approved package catalog, owner-only
non-financial preference and a fixed 14-day trial for new verified self-service
signups. Existing accounts retain the pilot described below. See
SAAS-ENTITLEMENTS.md for the current policy and POST contract. Paid activation is
still not enabled; the historical pilot foundation notes below are retained.

## Implemented boundary

This is the provider-independent foundation of roadmap phase 5, NOT a completed
paid subscription system. A separate test-only PayTR checkout/notification layer
is now implemented (see SAAS-PAYTR.md), but no live payment, invoice, subscription
or paid entitlement exists. No provider account was opened or enabled.

The existing `PILOT_LIMITS` is still the single source for all six project limits:
AI drafts 50/month, public HTML audits 25/month, campaigns 500, content 1,000,
work items 500 and team records 10. These are NOT proposed paid-plan allowances.
They are still per-project, not organization-wide, and member records include
inactive memberships as before. Operational/safety limits for social, email,
sources, events and worker jobs are independent and unchanged.

Project settings > Plan & usage shows monthly quota (UTC month boundaries), next
period, current stored-record counts, remaining capacity, overage states and the
latest ten operation records for the selected project. Analytics links to the
same view; no second plan/counter store was added. Legacy Crewin adapters are not
exposed to this new settings section/API.

`GET /api/platform/plan` uses the session project, never a submitted organization
or project ID. All active project readers can view aggregate counters; personal
details, actor IDs, credentials and cross-project billing information are absent.
The route is private/no-store, GET-only and cannot accept client paid/limit flags.
No sales currency is assigned to the unpriced pilot plan.

## Exact operation accounting

Migration 23 adds only `platform_usage_reservations`; existing users, identity
proofs, content, memberships and `platform_usage` counters are preserved.

- AI and audit routes reserve quota atomically before calling the provider/auditor.
- A reservation is bound to actor, organization, project, resource and UTC month.
- Successful route work commits that exact reservation; failure releases it once.
- A duplicate release cannot refund some other request. Committed work cannot be
  refunded by a later error path, and released work cannot later be committed.
- Compensation after membership revocation is allowed only for the same actor's
  exact previously authorized reservation. New work/completion recheck permission.
- A crash leaves a reserved operation counted. After ten minutes it is shown as
  unconfirmed; a page read does not guess success or automatically restore quota.
- Historical counters without new ledger entries remain counted but are NOT
  described as successful provider calls. A negative difference is flagged as an
  inconsistency, not silently repaired with invented history.
- Hard limit: 1,000 reservation attempts/project/UTC month, even if every attempt
  fails and releases quota. This is a safety ceiling, not a billable allowance.
- Old operation rows are pruned after six calendar months when new work reserves
  quota; historical usage counters are never reset by retention. Only the current
  month is exposed by this first view. No monetary metering/credit balance exists.

Internal `ProjectOperations.reserveAi` now returns a typed reservation handle;
`completeAi`/`refundAi` consume it. This does not change public API response DTOs.

## Confirmed commercial direction (18 October 2026)

- Seller: a company in Turkey.
- Desired sales currency: USD.
- Preferred candidate: PayTR, as requested by the user subject to USD support.
  Public provider documentation confirms USD payment support; merchant approval,
  account-specific USD recurring-payment access and pricing remain unverified.
- Paddle and Lemon Squeezy remain alternatives, not selected providers. No
  merchant account, payment configuration or live collection has been enabled.

PayTR references verified on 18 October 2026:

- [Products and features](https://www.paytr.com/destek-merkezi/urunler-ve-ozellikler)
  documents USD collection and same-currency bank payouts without TRY conversion.
  It currently specifies an Akbank foreign-currency account; confirm this
  requirement for the intended merchant before onboarding. Subscription/recurring
  payments are documented separately and require merchant access. Their combined
  USD recurring-payment behavior still needs account-specific confirmation and testing.
- [Direct API](https://dev.paytr.com/direkt-api/direkt-api-1-adim) documents
  `currency=USD` and instructs merchants to contact `kurumsal@paytr.com` for USD/EUR
  use. Do not infer foreign-currency enablement from a default TRY merchant account.
- [Sanal POS pricing](https://www.paytr.com/paytr-sanal-pos) advertises rates
  starting at 2.19% with seven-day settlement. This is NOT a confirmed USD,
  foreign-card or recurring-payment rate for Ryzevo. Obtain a written quote for
  those exact flows, payout costs and all additional fees.

Before implementing the adapter, confirm the PayTR checkout, tokenized recurring
payment and notification contracts. Do not assume Merchant-of-Record subscription,
customer portal, invoice, webhook timestamp or event-ID features from other
providers. PayTR selection is not approval to collect card data in Ryzevo, accept
commercial terms or perform financial transactions. Accounting and international
sales-tax responsibilities need separate review.

Previously evaluated alternatives:

- [Paddle seller countries](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)
- [Paddle pricing](https://www.paddle.com/pricing): published standard checkout
  price is 5% + $0.50; contract, low-ticket/invoicing exceptions and payout costs
  must be confirmed before treating this as the final effective cost.
- [Paddle payout fees](https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts):
  international wire/FX/intermediary-bank costs can differ from checkout pricing.
- [Lemon Squeezy countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)
  lists Turkey for bank payouts; [fees](https://docs.lemonsqueezy.com/help/getting-started/fees)
  include possible subscription/international/payout extras.
- [iyzico subscription plans](https://docs.iyzico.com/urunler/abonelik/abonelik-entegrasyonu/odeme-plani)
  documents USD/EUR and restricts foreign-currency subscription payments to foreign cards.
- [Stripe country list](https://stripe.com/global) does not list Turkey for direct
  payment-account availability. Do not assume a Turkish company can directly open
  a Stripe Payments account or recommend changing jurisdiction just to bypass it.

Provider eligibility/KYC, product approval, USD settlement to the intended Turkish
bank account and actual contract must be verified by the operator. The Turkish
company's accounting/invoicing/tax arrangement needs its accountant's review.
This document is a product/engineering decision note, not legal/tax advice.

## Still required for paid subscriptions

PayTR test-only preparation and signed notifications are implemented in migration
24. This does not complete the live items below. Proposed prices are recorded
in SAAS-PRICING-PROPOSAL.md and are NOT in a checkout catalog or active quotas.

1. Confirm provider, monthly/yearly prices, quota catalog, account/project billing
   unit, cancellation/refund policy and billing-manager authority. Project-level
   ownership must not silently grant organization-wide invoice access.
2. Use a separate Ryzevo sandbox merchant account. Keep keys private/server-side.
   No customer or legacy Crewin payment/identity credentials may be reused.

3. Complete live provider acceptance, scoped customer/subscription mapping and
   recurring mandate/cancellation management. Server chooses price/currency;
   browser claims and success URLs cannot activate paid entitlements. Do not
   assume PayTR provides a Merchant-of-Record customer portal or invoice service.
4. Follow the actual provider notification signature and replay contract. PayTR
   uses authenticated form fields, not an invented signed raw JSON timestamp or
   event ID. Reconcile current provider state before applying live entitlements.
   Test renewals, failed-payment recovery, grace,
   cancellation, refunds and chargebacks. Do not charge overages from these pilot
   operation records.
5. Version entitlement changes and preserve existing projects/grandfathering;
   upgrades never bypass role, consent, sender proof or real-publishing gates.
6. Real activation, commercial terms and financial transactions require the user's
   explicit approval. Complete live provider acceptance before claiming billing
   is ready for customers.

## Verification

`npm run test:platform:usage` uses in-memory/temporary SQLite and no network/provider
payments. It covers replay, compensation, cross-actor/project access, old counters,
month boundaries, drift, bounded attempts, overages and additive/repeatable migration.
The HTTP suite checks private/read-only/session scope and audit-failure compensation.
`scripts/preview-design.cjs --usage` seeds an explicitly disposable usage fixture on
127.0.0.2, with all real publishing/email/account-registration gates disabled.
