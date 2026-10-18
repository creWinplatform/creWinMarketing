# Facebook Page text-publishing pilot

Extends the existing SocialPublications service, content library, campaign drafts,
Calendar and private worker. No second scheduler, task table or provider service.
Crewin's legacy tokens, ABP calls and existing publishing routes are not adopted
by customer workspaces. Organization/project scope and current owner/admin
authority are required. Real posting remains OFF by default.

## Setup and explicit consent

Use the existing separate SaaS Meta app configuration in `.env.local.example`:
PLATFORM_META_APP_ID, PLATFORM_META_APP_SECRET, PLATFORM_META_REDIRECT_URI and
PLATFORM_META_GRAPH_VERSION. Do not guess or auto-downgrade the Graph version.
Production requires an exact trusted HTTPS callback. Credentials stay server-side.
Do not reuse Crewin's app or credentials for other customers.

In Project Settings > Connections > Facebook / Instagram, choose Facebook and
explicitly check the Page publishing option. The default remains read-only.
Only this opt-in adds pages_manage_posts to pages_show_list/pages_read_engagement.
Instagram never requests publishing access in this phase. The user approves the
provider consent and selects an exact Page; no Page is silently preselected.

Only an explicitly opted-in grant retains the User access token, encrypted in the
SAME scoped credential envelope as the Page token. It is needed to check current
permissions and Page tasks. No token, app secret or grant is returned to clients.
Manual connection bodies cannot set this internal grant. Reconnection without the
opt-in removes it. Revoking the connection clears the encrypted credential value.

Before a live pilot, the operator must confirm the app's current Meta access,
review/verification requirements and selected Page tasks. Test responses do not
prove these provider-side prerequisites. No actual grant or public post was
performed by this implementation. Keep PLATFORM_SOCIAL_PUBLISH_ENABLED=0 until
one exact, expressly authorized live pilot is ready.

## Flow and boundaries

1. Save Facebook text in the existing library or a campaign draft. A campaign
   targeting LinkedIn and Facebook appears as two channel-specific previews,
   without creating duplicate campaigns. CTA and per-platform text are reused.
2. Calendar > Social publications: choose source and matching Page. Cross-channel
   account selection is disabled and independently rejected server-side.
3. Run a local rehearsal, now or scheduled. It never contacts Meta and does not
   assert that the Page grant can publish.
4. Check publishing access: the retained User grant must match the configured app
   and Graph version, have a future expiry and all three required permissions.
   A bounded /me/accounts lookup must return the selected Page, the SAME Page
   token and CREATE_CONTENT or PROFILE_PLUS_CREATE_CONTENT task. Finally the Page
   token's /me identity must match. Missing/rotated grants require reconnection.
   At most four 50-Page batches are checked with a 20-second overall deadline;
   provider paging.next URLs are never followed. Failure stays not-ready.
5. Permission evidence is fenced, revision-bound and lasts at most five minutes.
   Actual execution checks Meta again, current member authority, saved content,
   account revision, server config, schedule and live gate before submission.
6. Explicit approval covers the exact public text, selected Page and time. The
   existing worker sends POST /{version}/{pageId}/feed with only message and a
   Page token in the Authorization header. Scheduling stays local; no separate
   Meta scheduled post is created. Rehearsals and email queues remain separate.
7. A successful response must contain a Page-prefixed post ID. Store that receipt
   and a Facebook URL, not an invented reach/click/delivery metric. Malformed,
   mismatched, lost or 5xx responses after the durable reservation are uncertain,
   never automatically retried. Check the Page manually before a new publication.

The shared text-only pilot cap is deliberately 3000 UTF-16 code units, not a claim
about Meta's maximum. Images/video/HTML and unresolved template variables are
blocked rather than silently dropped. Instagram/X, media, company LinkedIn pages,
post deletion, engagement read-back and causal attribution are not delivered.

## Compatibility and verification

No migration is needed: schema20 remains unchanged. New encrypted snapshots add
platform; old snapshots lacking that property continue as LinkedIn. Existing
LinkedIn approval digests are preserved. Public API adds source/item platform and
per-target configured; the server still derives platform from the scoped saved
account, not a caller's provider field. Both providers share existing quotas and
durable one-attempt reservation/cancellation semantics.

Automated coverage includes scopes/tasks/token/page mismatch, safe pagination,
one reservation before POST, uncertain outcomes, cancellation/content/config
changes, tenant isolation, OAuth opt-in and old LinkedIn snapshot compatibility.
Provider responses are mocked; the visual QA database is disposable and contains
no customer credentials or real provider permission proof.

Verification on 2026-10-16:
- 205 platform tests pass, including 11 Facebook and 19 existing social cases.
- The production HTTP suite, TypeScript check, isolated production build and 22
  legacy Crewin agent tests pass. Initial Windows sandbox filesystem errors were
  resolved by rerunning those checks with the required filesystem permissions.
- Chrome: English/Turkish, light/dark, 1440px desktop, 768px tablet and 390px
  mobile; no horizontal overflow or console errors. Saved source/Page matching,
  opposite-channel disablement, rehearsal, scheduled timestamp and mobile
  cancellation verified. No real OAuth/provider acceptance was exercised.
- Example screenshots: [desktop](screenshots/facebook-publications-desktop.jpg),
  [mobile](screenshots/facebook-publications-mobile.jpg),
  [mobile cancellation](screenshots/facebook-publications-mobile-cancel.jpg).
- Main SQLite integrity is ok, zero FK errors, zero publication records. No schema
  change was needed and no QA fixture was added to the main database.
- Port3033 login returns HTTP200. Temporary QA server stopped; no worker was
  installed, no real provider post was sent and no deployment occurred.

Primary references checked during implementation:
- [Meta's official Page SDK: feed/message and Page task enums](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py)
- [Meta's official API workspace](https://www.postman.com/meta/facebook/overview)
- [Meta Pages publishing documentation](https://developers.facebook.com/docs/pages-api/posts/)

The SDK/workspace were accessible; the publishing documentation returned 429 in
this environment. Current app-specific permission/review eligibility and one
authorized live post remain operator acceptance checks, not completed QA.
