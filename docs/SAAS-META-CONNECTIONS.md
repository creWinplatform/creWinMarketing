# Customer Facebook / Instagram connections

Facebook Page text publishing is an explicit opt-in extension, documented in
SAAS-FACEBOOK-PUBLISHING.md. Read-only connection checks below remain distinct
from publishing permission, live approval and provider acceptance. Instagram
single-image publishing is now documented in SAAS-INSTAGRAM-PUBLISHING.md.

## Setup

Use a separate SaaS Meta developer application, not Crewin's legacy app/env tokens.
Configure the Facebook Login product, accepted callback and the required provider
review/business verification/access levels. Enable a supported Graph version in
that application; the connector deliberately does not guess the latest version.

Set private server values in `crewinjob-web/.env.local` and restart:

```dotenv
PLATFORM_META_APP_ID=YOUR_APP_ID
PLATFORM_META_APP_SECRET=YOUR_APP_SECRET
PLATFORM_META_REDIRECT_URI=http://localhost:3033/api/platform/meta/callback
PLATFORM_META_GRAPH_VERSION=YOUR_ENABLED_VERSION
```

Graph version must have the form `vNN.0`. Register the exact accepted callback.
If Meta requires HTTPS for the development application, use the same HTTPS origin
for the panel and callback; do not bypass browser certificate warnings. Production
requires HTTPS. These values must not use `NEXT_PUBLIC_*` or enter Git/screenshots.
Do not enable OAuth-library request debug logs in production.

This implementation uses **Facebook Login for Pages / linked Instagram accounts**,
not the separate Instagram Login API. A supported Instagram business/professional
account must be connected to a page accessible through the granted permissions.

## Customer flow

1. Enter the correct project and open Project Settings.
2. Expand Connect Facebook / Instagram and select the intended account type.
3. Continue to Meta; the user personally approves the requested provider consent.
4. Return to the panel and explicitly choose an accessible page.
5. For Instagram, the page must show a linked Instagram account. A missing linked
   account is disabled. No page is preselected.
6. Confirm the selected account. Its current access/link is checked again before
   one encrypted project connection is saved. Other pages are not connected.
7. Test Access checks the selected page token and, for Instagram, the parent-page
   relationship. No publishing or delivery takes place.

Page selection expires after ten minutes. Cancel or start again to clear it.
If access is removed or the Instagram link changes, retry from authorization.
Provider pagination is limited to 200 pages and exposes no token-bearing URLs.

## Permissions and boundaries

Facebook requests `pages_show_list,pages_read_engagement` by default; explicit
Facebook Page publishing opt-in also requests `pages_manage_posts`. Instagram additionally
requests `instagram_basic`; its explicit publishing opt-in adds `instagram_content_publish`.
Connection checks alone do not prove publishing rights. Relevant
app review and actual page access are prerequisites, not automatically granted by
the panel. Separate write permissions, roles, media validation and explicit pilot
approval must precede posting.

User grants and page tokens stay encrypted server-side. API responses contain only
page names/IDs and linked Instagram IDs/usernames. Local revoke erases credentials
and invalidates pending selection; provider-side shared grant revocation remains
manual. Expired grants require reconnect; no indefinite token validity is promised.

## Verification Still Required

- Real app code/long-lived token exchange with an accepted callback.
- Real page listing, granted/declined permissions and pagination.
- Facebook page selection and Instagram linked-account selection.
- Provider role removal, token expiry/reconnect and app review/version requirements.
- Live publishing permission acceptance and a separately approved real pilot.

Automated tests and Chrome checks use disposable fixtures, never real Meta grants.
Meta developer documentation was rate-limited during implementation; live app
contract verification remains mandatory before claiming operational readiness.

References: [Pages API](https://developers.facebook.com/docs/pages-api/getting-started),
[Instagram with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started),
[Meta's Instagram sample](https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md).

## Inbox permissions (29 October 2026)

The connection form has an "Also request … comment and message permissions for the inbox" box. When it is ticked, Meta is asked for extra permissions on top of the basic ones:

- Facebook Page: `pages_read_user_content`, `pages_messaging`, `pages_manage_metadata`.
- Instagram: `pages_manage_metadata`, `instagram_manage_comments`, `instagram_manage_messages`.

Without them, the social inbox cannot read or answer comments and messages. The box starts ticked in the Crewin workspace, which connects Meta only for the inbox.

In development mode, the app's role holders can grant these permissions. Public use needs Meta app review.

