# Phase 3A - email preview, content approval and readiness

Phase 3B follow-up: [Recipient safety](SAAS-EMAIL-RECIPIENTS.md) adds explicit
mapping, reviewed consent, suppression and project-bound unsubscribe. Aggregate
`eligibleRecipients` can now be a real number after a fresh successful check;
it remains null when not evaluated/stale. Sending stays disabled. The closed
recipient gates described below record the original Phase 3A boundary.

This is the first bounded part of Phase 3, not completed email dispatch.
Standard projects reuse their existing campaign drafts, product sources, segment
versions, project profile, scoped RBAC and SQLite monolith. Crewin's external
campaign/template/dispatch endpoints and workflows are not changed.

## User flow

Campaigns > Drafts > Review and approve opens the SAVED draft, not unsaved editor
content. The view contains a sandboxed design preview, plain text, CTA URL,
content revision, content/audience checks, sending gates and decision history.

An editor can run preflight. Owners/admins can approve content after checking
the saved message and audience; request changes and withdrawal require a note.
Approval requires a fresh non-empty matched audience, not merely a saved rule.
The campaign remains a draft. There is no send button and no queue/send side
effect in any review operation. A content approval is NOT consent, sender-domain
verification or permission to deliver email.

## Contracts and persistence

Authenticated, same-origin POST, private/no-store `/api/platform/campaign-review`:

- GET `?id=CAMPAIGN_ID`: saved message, safe preview HTML, revision, decision
  history, last preflight and explicit readiness. GET is read-only.
- POST `{action:"check", id, expectedDigest}`: re-evaluate the pinned audience
  through the existing ProductSegments engine and persist one preflight receipt.
- POST `{action:"decide", id, decision, expectedDigest, expectedReviewId, note}`:
  approved/rejected/revoked. Reject/withdraw require a non-empty note, max 1000.

Migration 14 adds one preflight row/campaign and append-only review decisions.
Foreign keys and queries are scoped. Deleting a draft prunes its preflight but
retains decision/audit history without recipient addresses or full message text.
Pilot limits: 50 decisions/campaign, 5000/project and 100 decision attempts/project
per UTC day. Existing audience preview quotas still apply. Request body: 16 KiB.

The existing RBAC adds `campaign.approve` for owner/admin only. Editor's existing
dispatch permission does not imply approval permission and does not open sending.
Read-only members can inspect saved content but cannot preflight/decide. Live
membership and standard-project checks apply server-side, not just in buttons.

## Approval correctness

- Digest covers saved revision, campaign identity/name, content/CTA/channels,
  goal, pinned segment binding, project brand/language and renderer version.
  Saving a changed draft or brand/goal invalidates the displayed current approval.
- A successful preflight must be no older than 15 minutes, match this digest,
  retain a current active/fresh source and have at least one matched record.
  Unknown records are not treated as matches or consented recipients.
- Approve rechecks source freshness, live permission and the same segment
  evaluator's current data revision inside a transaction. A changed population
  requires a new explicit preflight, not silent approval of a different audience.
- Optimistic latest-decision identity prevents overwriting another review.
  Identical repeated decisions by the same actor do not append duplicates.
- Removing an approver's authority through membership management appends
  revocation decisions transactionally. Restoring their role does not resurrect
  old approvals. Read-time authority checks also fail closed.
- This is a human content approval, not a mandatory two-person/separation-of-duty
  workflow. Owners/admins may approve their own content. A later sender must
  re-evaluate current permission, source, recipients, consent and suppression.

Content approval currently requires email-only channels, a safe non-empty subject,
plain text up to 20,000 characters, a credential-free HTTPS CTA, a pinned segment
and no unresolved `{{variables}}`. Mixed-channel drafts and larger content can
still be saved by the existing draft flow but are blocked from email approval.

Preview HTML is generated from escaped plain text, includes no remote media,
scripts, active CTA or real unsubscribe tokens, and carries restrictive CSP.
Client iframe has an empty sandbox and no-referrer. It is explicitly a preview,
not a sendable template. No second template registry is created in this phase.

## Sending gates deliberately closed

SMTP readiness means at least one active project connection has a current,
revision-bound successful access check (within one hour). It does not select a
sender, prove domain authentication or show provider acceptance/delivery.

`sendingEnabled` is always false. `eligibleRecipients` is null, not zero. Sender
domain, explicit email/identity mapping, verified communication permission,
suppression, project-bound unsubscribe and controlled dispatch worker remain
closed. There are no new public callbacks, sender credentials or provider writes.
Existing Crewin global sender/allowlist is never inherited by standard projects.

Next Phase 3B must implement these gates with project-scoped data, then extend the
existing persistent queue for bounded idempotent dispatch, recipient outcomes,
cancellation, rate limits and ambiguous-provider-result handling. Fake transport
tests must pass before any explicitly approved small real-recipient pilot.

## Validation

The platform suite includes review lifecycle/idempotency, changed content/brand,
optimistic races, authority loss/restoration, viewer/editor/foreign/legacy denials,
stale/paused/changed audience, invalid email content, XSS-safe preview, scoped SMTP
readiness, quotas, retained audit history and migration 14 preservation.
HTTP checks use actual temporary-server login/session/origin enforcement.

Visual fixture command (disposable DB, no customer data):

```powershell
node scripts/preview-design.cjs --product-data --product-webhooks --segments --campaign-review
```

Current development remains at port 3033; production build uses the separate
`.next-monolith-platform` directory. No customer sending or deployment is part of
this phase's verification.

Verified 2026-10-15:

- 96 platform unit/SQLite tests and 22 existing Crewin agent regression tests pass.
  Actual localhost HTTP login/origin/isolation, preflight, approval, escaped HTML,
  outdated decision and still-denied launch checks pass. TypeScript and separate
  production build pass. The existing multiple-lockfile warning remains.
- Chrome disposable fixture: normal login, saved preview, preflight with 1/2
  actual fixture matches, approval, reopening, withdrawal, change request, draft
  edit and outdated state. Final UI confirms decisions without sending mail.
- TR/EN and light/dark, desktop 1440x1000, tablet 820x1180 and mobile 390x844.
  Document scroll/client widths: 1425/1425, 805/805, 375/375. No overflowing mobile
  controls or console errors. Preview iframe sandbox is empty and referrer policy
  is no-referrer. Plain-text and rendered views were inspected.
- Screenshots: `screenshots/campaign-review-desktop.jpg` and
  `screenshots/campaign-review-mobile.jpg`. All review decisions used disposable
  test data, not real customer campaigns. No real SMTP send was attempted.
- Local database backed up before additive migration 14; integrity is ok and
  foreign-key error count is zero. Dev process restarted at port 3033. No deploy.
