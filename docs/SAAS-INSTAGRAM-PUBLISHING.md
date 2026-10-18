# Instagram single-image pilot

Extends the existing content library, encrypted connections, SocialPublications,
Calendar, permissions, audit and private worker. No duplicate media library,
scheduler or Crewin backend service is introduced.

## Scope

One saved image and caption via Instagram with Facebook Login and a linked
professional account. Instagram Login is a different API, not substituted here.
LinkedIn/Facebook remain text-only. Reels, video, Stories, carousel, tagging,
engagement analytics, X and LinkedIn company pages are NOT delivered by this step.

The existing content editor accepts JPEG/PNG/WebP. Text-only editing preserves the
image; explicit removal clears it. Sharp decodes, rotates and strips metadata,
converts to JPEG, flattens transparency on white and resizes without crop/enlarge.
Our conservative pilot bounds (not Meta maximums): input <=5 MB/16 million pixels,
width >=320, aspect 0.8-1.91; output <=1080x1350 and 1 MB. Caption 1-2200 UTF-16
units, no unresolved template variables/control characters. Saved campaign images
can be used if the existing draft contains imageData/imageMime, but the campaign
editor does not yet offer attachments; use Content Library for the image workflow.

## Setup and consent

Use the existing separate SaaS Meta app and PLATFORM_META_* configuration, never
Crewin's legacy tokens. Instagram publishing opt-in adds instagram_content_publish
to pages_show_list/pages_read_engagement/instagram_basic, NOT pages_manage_posts.
The checkbox defaults OFF and resets on account-type change. Only explicit OAuth
opt-in retains an encrypted User grant after exact Page/account selection.

Publishing checks current scopes, Page content task, exact granted Page token and
linked Instagram identity. App, Graph version and expiry must match. Client proof
and grant fields are ignored. Read-only connection checks do not prove publishing.

Actual image preparation also requires PLATFORM_PUBLIC_ORIGIN to be a PUBLIC
HTTPS origin matching the Meta callback origin exactly: no paths/query/fragment,
port, credentials, IP literal or local/test/internal hostname. Never infer it from
Host/proxy headers. Localhost can rehearse but cannot serve images to Meta.
Restart after configuration. PLATFORM_SOCIAL_PUBLISH_ENABLED stays 0 by default.

App review/access, current account eligibility, exact callback and one expressly
authorized public pilot remain operator checks. No real consent, post, app change,
deploy or permanent worker setup is performed by code or fixture QA.

## Workflow

1. Save the image/caption in the existing library. In Calendar > Social
   publications choose the matching source and Instagram account. The PRIVATE
   preview is the same normalized JPEG frozen on enqueue. Live approval is blocked
   until it loads. Image errors and content/account/profile edits invalidate use.
2. Rehearse locally, now or scheduled: no Meta request, no permission proof.
3. Live approval explicitly covers exact image/text/account/time and short-lived
   image access for Meta. The image is stored in the existing project-bound
   encrypted job snapshot, not a public/static folder.
4. The existing worker durably reserves preparation before POST /media, saves the
   returned container ID and requeues with a ten-second not-before timestamp.
5. Subsequent executions recheck current authority/source/connection/provider
   grant. IN_PROGRESS backs off. FINISHED permits one durably reserved POST
   /media_publish. ERROR/EXPIRED stop. At most 30 claims and fifteen minutes of
   preparation; transient status reads can requeue only within those bounds.
6. Lost creation receipt/crash after reservation is uncertain and NEVER creates
   another container. No public publish request was made in that state. Lost,
   malformed or 5xx final publish replies are also uncertain, never retried.
   Deduplication binds image digest, caption and exact account. This is at-most-once
   automatic submission, not guaranteed exactly-once provider delivery.
7. Valid media IDs record provider acceptance. A URL appears only if Meta returns
   a matching valid www.instagram.com/p/... permalink. Failed read-back does not
   fabricate a URL, engagement or conversion metric, or erase known acceptance.

Cancellation before final reservation prevents media_publish. An unpublished Meta
container may remain until provider expiry; no deletion/retraction is claimed.
After final reservation cancellation cannot promise to unsend the post.

## Image handoff security

Only exact `/api/platform/publication-media/{UUID}` is cookie-free. Its scoped
per-job HMAC binds organization, project, job, preparation start and body digest;
invalid signatures are rejected before snapshot decryption. Signed URLs are never
returned in workspace/job responses. Possession allows reading one image during
its <=15-minute ACTIVE preparation window: redact this route/query in proxy/access
logs. No directory listing, arbitrary URL proxy or static public file is created.

Source edits, role loss, revoke, gate OFF, expiry, cancel or final submission end
access. Response headers: JPEG, private/no-store, nosniff, noindex, no-referrer.
Private `/api/platform/publication-preview` requires the correct project session;
foreign source/job IDs are denied. It does not expose the provider signature.

## Storage and verification

Migration21 adds preparation_started_at, provider_container_id, next_check_at and
image_bytes to the existing scoped table; no old approval/row is rewritten. Back
up SQLite AND its encryption key first. Old LinkedIn/Facebook jobs keep their
meaning and three-claim bound.

Shared pilot bounds: 500 retained jobs, 20 new intents/day, 100 explicit permission
checks/day, 200 image previews/day, five durable publication/preparation attempts
per UTC day across providers. Queue image bytes <=32 MB/project; library encoded
image data <=32 MB/project. No automatic retention purge; production quota and
retention policies remain launch work.

Tests mock provider replies and use disposable databases. They cover real image
decoding, scoped preview, HMAC/expiry/revoke, Page association, cancellation,
parallel workers, both interruption points, polling bounds, safe receipt URLs and
additive schema20 upgrade. Live provider acceptance is still not verified.

Verified locally on 2026-10-16:
- 217 platform tests (12 Instagram cases), 22 legacy Crewin agent tests, production
  HTTP integration suite, TypeScript and isolated production build pass.
- Chrome disposable fixture: saved image survives draft editing; normalized
  preview loads at 1080x720; local rehearsal, scheduled timestamp, mobile cancel
  and immutable job image preview verified. Wrong-channel account selection is
  disabled. Instagram write opt-in starts OFF and resets on channel change.
- 1440px desktop, 768px tablet and 390px mobile: no horizontal overflow. TR/EN,
  light/dark checked, no console errors in the QA run.
- Browser file-picker upload was NOT completed: the Chrome extension does not
  have local-file access. This permission was not changed. Actual image POST,
  format decoding, JPEG conversion and image preservation passed in HTTP tests;
  browser rehearsal used the pre-saved disposable brand-board fixture.
- Example-only [desktop](screenshots/instagram-publications-desktop.jpg),
  [dark desktop](screenshots/instagram-publications-desktop-dark.jpg),
  [mobile cancellation/image](screenshots/instagram-publications-mobile-cancel.jpg).
- Backup before migration21:
  data/backups/2026-10-16T16-23-35-427Z-7a003927. Main schema21 integrity ok, zero
  foreign-key errors and zero publication rows. No fixture seeded into main DB.
- Existing port3033 login returns HTTP200. Temporary test servers stopped; live
  send gates remain OFF. No real Meta OAuth/permission grant/post or deploy.

Primary references:
- [Meta SDK: image_url, caption, media/media_publish](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/iguser.py)
- [Meta sample: linked Page and asynchronous processing](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md)
- [Content publishing guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/)

SDK/sample were accessible; the guide was rate-limited/unavailable here. Do not
infer current app eligibility/live acceptance from those samples. No hard-coded
provider quota or automatic Graph version fallback is used.
