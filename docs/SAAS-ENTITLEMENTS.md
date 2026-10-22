# Ryzevo catalog, preference and trial

18 October 2026. Implemented in the existing modular monolith, schema 25.

> 22 October 2026 (schema 54): a live prepaid Launch or Growth period can now replace
> trial rights. This applies while the period or its 7-day grace runs, and only for
> self-service standard projects; pilot projects keep pilot rights. Paid limits
> come from this catalog: AI drafts, audits, seats and social accounts.
>
> While live payment is enabled, the plan screen replaces the preference cards with
> a pointer to "Plan and payment". Annual payment is available there (10× the
> monthly price). See `SAAS-PAYTR.md`, "Live prepaid plans".

## Approved commercial direction, not live sales

Catalog `2026-10-v1`: Launch USD 29/month (2 seats, 3 social accounts, 50 AI text
drafts, 10 single-URL HTML audits); Growth USD 79/month (5, 5, 200, 25); Team USD
149/month (10, 10, 500, 50), deferred. One project/brand per package. Provider,
advertising, email and external API charges are separate. Annual payment is not
enabled. These offerings do not grant active paid rights yet.

`GET /api/platform/plan` reuses the existing usage response and adds the public
catalog, current baseline, trial bounds, active-seat/social counts and preference.
`POST` accepts ONLY `{planId: "launch"|"growth", catalogVersion: "2026-10-v1"}`.
It requires current project owner authority, same origin, bounded JSON and the
session's exact scope. Repeats are idempotent; stale catalogs and client price,
paid, tenant, cadence or quota flags are rejected. No checkout, money, card data,
subscription or entitlement change is triggered. Team preference is not open.

The existing PayTR sandbox still needs explicit private configuration and
merchant acceptance. Its test catalog is intentionally separate from sale-ready
claims. Signed sandbox callbacks cannot activate packages or extend a trial.

## Existing accounts and new enrollment

- Additive migration backfills existing standard projects as `pilot`. Their
  existing quotas/counters, content and memberships are preserved. Crewin's pack
  stays on its existing adapters and is not exposed to this plan API.
- Administrator/invitation provisioning retains pilot baseline. A verified
  self-service signup alone atomically creates a `trial`, owner, project and
  verified mailbox. Client plan flags cannot choose the baseline. Public signup
  and account email gates remain OFF until operator acceptance.
- Trial lasts exactly 14 UTC days, no card: 10 AI operations, 3 public single-URL
  HTML audits TOTAL; 10 campaign, 25 content, 25 work-item records; 2 active seats
  and 1 active social account. The independent safety cap of 10 membership records
  still counts inactive records. All security/consent protections remain.
- Trial usage reuses the exact existing counter and reservation ledger with
  period `trial-v1`, not a UTC calendar month. Month rollover does not renew it.
- Expiry blocks new AI/audit reservations, content/campaign/work saves, member
  additions/reactivation, connection saves and new rehearsal/publishing jobs.
  Existing reads, exports, deletions, cancellation, membership deactivation,
  suppression/consent withdrawal and connection revocation are preserved. This
  is NOT a blanket read-only lock on all configuration or measurement workflows.
- Worker checks fence actual email/social delivery both before enqueue and before
  submission. A global publishing switch or valid provider grant cannot override
  trial delivery policy. Rehearsals remain possible during an active trial.
- Existing reservation compensation remains exact/single-use after expiry;
  already started work may record its actual result. Reads never delete data,
  restart/extend the trial or infer payments. No public reset/extension endpoint.

Baseline table `platform_project_entitlements` has only pilot/trial states and a
unique trial owner; it is not an owner-writable subscription table. Preference
table `platform_plan_preferences` is separate. Missing/corrupt scoped rights fail
closed, never silently fall back to pilot. Multi-mailbox signup abuse is bounded
by the existing global/mailbox throttles; identity/website uniqueness is not
claimed as proof of one human or company.

## Acceptance and remaining work

Tests cover scoped owner preferences, stale/injected flags, fixed lifetime
quotas, month boundary, expiry, seat/social limits, verified enrollment, worker
fences and repeatable migration. Disposable Chrome fixtures do not send or bill.

Still required before sales: live PayTR USD/recurring merchant acceptance,
verified live subscription lifecycle/reconciliation, renewals/failed payments,
cancellation/refund/chargeback handling and accounting/invoicing review. Paid
activation must be a separate server-verified transition, never a browser claim,
preference save, success URL or test payment. Team and annual sales stay closed.
