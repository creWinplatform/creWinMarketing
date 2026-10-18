# Social formats and engagement - 18 October 2026

This increment extends the existing standard-project publication center. It does
not replace the Crewin pack, its external backend, OAuth vault or worker queue.
No live account grant, publication, comment, message or provider payment was made.

## Implemented scope

| Account | Publication formats | Read-only engagement |
| --- | --- | --- |
| Facebook Page | Existing text, new single JPEG photo plus caption | Reactions, comment count and shares when returned |
| Instagram professional | Existing single image, new ordered 2-5 image carousel | Likes and comments when returned |
| X | Existing weighted-length text | Public likes, replies, reposts, quotes, bookmarks and impressions when returned |
| LinkedIn organization | Existing text | Post-specific organization statistics, behind separate operator opt-in and approved read scope |
| LinkedIn person | Existing text | Not enabled; personal restricted analytics is not inferred from posting access |

Video, Reels, Stories, LinkedIn/X image upload, TikTok/YouTube adapters, comment
inboxes/replies and automated DMs are NOT implemented by this increment. Existing
draft-only channels do not become publishable because they appear in an editor.

## User workflow

1. Content Library: save a Facebook photo or select up to five Instagram images.
   Images can be reordered or removed before saving. Input total is at most 5 MB.
2. Publications: choose the saved draft and matching project-owned account.
   All normalized images must load before the exact content can be approved.
3. Rehearse without network publication, or explicitly approve a live publication
   only after the existing server gate and provider permission checks pass.
4. After a real provider receipt is accepted, refresh engagement from its row.
   Read counters are cached per publication, not added to conversion funnels.

Absent metrics remain absent, rendered as a dash. Provider-confirmed zero remains
zero. Each successful observation has its own timestamp. Failed refresh retains
the last successful counters with a visible failure state; it never relabels old
data as a fresh measurement or invents CTR/conversions. Facebook reactions are
not labeled as likes. No aggregate sums compare unlike provider definitions.

## Safety and storage

- Same tenant/project guards, owner/admin publication permissions, origin checks,
  entitlements, existing encrypted snapshots, durable job reservations and worker.
- Local images only: real decoder, metadata stripping and JPEG normalization.
  Up to five normalized images, total at most 3 MB, existing project image quota.
- Carousel order and all image bytes are part of the approved source digest and
  deduplication key. Source/account changes invalidate pending work.
- Instagram children and parent are prepared once under the existing lease and
  a bounded time budget. The final publish happens only after FINISHED. Lost
  preparation responses do not cause child/parent creation to retry. Already
  prepared unpublished containers may remain at Meta until their expiry; no
  cleanup deletion or retraction is claimed.
- Temporary Instagram media is signed per job/image index, expires after 15
  minutes and stops serving after cancellation, revocation or submission.
  Facebook uploads JPEG bytes directly; no public media route is needed.
- Metrics accept only stored receipts, validate provider author/owner, use fixed
  API hosts, do not follow redirects or provider-supplied next URLs and never
  persist raw responses, tokens, usernames or comment bodies.
- Per-publication one-minute cooldown, lease fencing and 100 project refresh
  attempts per UTC day. No new automatic polling job or paid-provider loop.
- Additive schema 28 stores last success/attempt and lease metadata. Recovery
  supports schema 28 and the existing encrypted snapshot contract. No reset or
  destructive migration is required; older migration fixtures remain covered.

## Operator acceptance still required

`PLATFORM_SOCIAL_PUBLISH_ENABLED` stays OFF unless explicitly enabled by the
operator. Real Meta/X permissions, API products/versions and provider quotas must
be validated with customer-owned accounts. Local mocked receipts do not close
this live acceptance.

`PLATFORM_LINKEDIN_ANALYTICS_ENABLED=0` is the default. Enable it only when the
LinkedIn app is approved for `r_organization_social`; then reconnect the selected
organization through OAuth to grant that scope. Existing tokens are not silently
upgraded. Personal analytics remains unavailable. Provider plan/app-review
limitations show unavailable, not fabricated values.

Useful official contract references:

- [Meta Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/)
- [Meta Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Official Meta Instagram workspace](https://www.postman.com/meta/instagram/overview)
- [X Post lookup](https://docs.x.com/x-api/posts/lookup/introduction)
- [LinkedIn organization share statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics)

Meta documentation was partially rate-limited during local implementation;
provider-backed acceptance remains explicit, not represented as completed.

## Verification

Dedicated format/engagement regression suite exercises normalization, carousel
order, signed media indices, cancellation checks, ambiguous outcomes, multipart
photo publication, counter zero/missing semantics, scope/role isolation, concurrent
refresh fencing, quotas, connection replacement and additive migration.

Final local checks: 418 platform tests passed on the Windows development host,
including 16 new social-extension cases, zero failures/skips. TypeScript,
production build (28 static routes) and actual production HTTP regression passed.
This increment was not rerun inside the previous offline Linux image and does
not establish native EC2 Windows/Node-22 or live-provider acceptance.

Chrome acceptance: Instagram carousel preview loaded both real images; rehearsal
completed without publication. Editing, reordering and saving the two images
persisted their swapped dimensions (640/720 -> 720/640). Facebook photo rehearsal
also completed. Measured page widths stayed within 320, 390, 768 and 1440 pixel
viewports; mobile/tablet and dark-theme states were inspected. Missing counters,
measured zero and last-success-after-failure are distinct in the UI. Screenshots
under `docs/screenshots/social-*20261018.jpg` use visibly QA-labeled fixtures.

Temporary 31450 QA was stopped and viewport overrides reset. The agent-owned
3033 development process was narrowly verified/restarted for schema loading, with
publication, signup, identity delivery and payment gates OFF. No `.env.local`
credentials or actual campaign/contact data were edited.

Visual QA uses `node scripts/preview-design.cjs --social-extensions` on private
loopback port 31450 and a fresh temporary database. QA-labeled counters/receipts
are display fixtures ONLY. Actual 3033 data and environment files are not opened
by that fixture. Do not enable provider gates or test real sends there.
