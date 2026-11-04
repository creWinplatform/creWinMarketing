# TikTok, Pinterest and YouTube Shorts publishing (4 November 2026)

Standard Ryzevo projects can publish approved items to three more channels, through the same publication center, approval, publishing check, server switch (`PLATFORM_SOCIAL_PUBLISH_ENABLED`) and daily limits as Instagram, Facebook, LinkedIn and X.

| Channel | What is published | Account | Provider API |
|---|---|---|---|
| TikTok | One video (MP4/MOV, up to 300 MB, from the team's own https address); caption up to 2,200 characters | The creator (`open_id`) | Content Posting API, `PULL_FROM_URL` |
| Pinterest | One pin: one image, the item's title, a description up to 500 characters and the first link to the team's site | One board (its numeric id) | API v5 `POST /v5/pins`, `image_base64` |
| YouTube | One Short: the video streamed from the team's address; first line + `#Shorts` as title, the text as description (up to 5,000) | The channel (`UC…`) | Data API v3 resumable upload |

## Connecting (`components/platform/ChannelConnections.tsx`, `lib/platform/channel-oauth.ts`)
- Project settings → Connections → "Connect TikTok account / Pinterest board / YouTube channel". Needs `connections.manage`.
- **Pinterest:** the team enters the board id; it must belong to the authorized account.
- **Routes:** `GET/POST /api/platform/channels` and one callback, `/api/platform/channels/callback`, which redirects back with `?channelConnection=<platform>:connected|failed`.
- **OAuth requests:** the existing request store and browser cookie (`platform_channel_oauth`).
- **Provider specifics:**
  - YouTube uses PKCE and `access_type=offline`.
  - Every scope publishing needs must be granted, or the connection fails.
- **Storage:**
  - The connection vault stores the access token, the refresh token and the `channelPublishing` grant (app revision, scopes, access-token expiry).
  - The social account row's `expires_at` is the refresh token's lifetime (Google states none; 180 days is assumed, and every send re-checks the account).

## Tokens
- Access tokens are short-lived: TikTok 24 h, Pinterest 30 days, Google 1 h.
- `channelAccess` takes a fresh one from the refresh token when needed and keeps it **only in memory**. The encrypted envelope, and the approval bound to it, never change.
- A provider that rotates the refresh token (TikTok may) gets the new one in `platform_channel_tokens` (schema 68). It is encrypted, bound to the envelope revision, and covered by the recovery contract.

## Publishing (`lib/platform/channel-publishing.ts`, wired in `social-publications.ts`)
- **Eligibility:**
  - TikTok and YouTube need a video (format `feed`);
  - Pinterest needs exactly one image (the shared image rules: JPEG/PNG/WebP, ratio 0.8–1.91);
  - text limits are 2,200 / 500 / 5,000;
  - variables and control characters are refused, as elsewhere.
- **Check** (`publication center → check`): a refreshed token, then the provider's own check:
  - TikTok: creator info, and the privacy level this server uses must be offered;
  - Pinterest: the board;
  - YouTube: the channel id.
- **Send:**
  - the video must still be the approved file (`sameVideo`);
  - `reserve()` runs right before the call that creates the post;
  - a 4xx is a rejection; anything else is uncertain and never retried automatically;
  - YouTube's upload extends the job lease to 15 minutes.
- **Results:**
  - Pinterest: pin id → `https://www.pinterest.com/pin/<id>/`.
  - YouTube: video id → `https://www.youtube.com/shorts/<id>`.
  - TikTok: the `publish_id`; the post appears after TikTok processes it, so there is no URL.
- **Links:** Pinterest pin links and YouTube descriptions carry the item's `rz_` tag (`LINK_SOURCES`). TikTok captions are not clickable.
- **Engagement counts:** not read yet for these channels.

## Server settings (`.env.local.example`)
- `PLATFORM_TIKTOK_CLIENT_KEY`, `PLATFORM_TIKTOK_CLIENT_SECRET`, `PLATFORM_TIKTOK_REDIRECT_URI`.
- `PLATFORM_TIKTOK_PRIVACY`: default `SELF_ONLY`. An unaudited TikTok app may post only privately; after TikTok's audit, e.g. `PUBLIC_TO_EVERYONE`.
  - The domain the video is served from must be verified in the TikTok developer portal (`PULL_FROM_URL`).
- `PLATFORM_PINTEREST_CLIENT_ID`, `PLATFORM_PINTEREST_CLIENT_SECRET`, `PLATFORM_PINTEREST_REDIRECT_URI`. Pinterest's trial access may limit pins until the app is upgraded to standard access.
- `PLATFORM_YOUTUBE_CLIENT_ID`, `PLATFORM_YOUTUBE_CLIENT_SECRET`, `PLATFORM_YOUTUBE_REDIRECT_URI`.
- `PLATFORM_YOUTUBE_PRIVACY`: default `private`. Unverified Google projects upload private videos; after verification of the `youtube.upload` scope, `public` or `unlisted`.
- All three redirect URIs must be `<panel>/api/platform/channels/callback` and registered in each provider's app.

## Not covered
- Engagement counts for the three channels.
- TikTok photo posts.
- Pinterest video pins, board creation and 2:3 images (the shared image rules allow 0.8–1.91).
- YouTube long videos and playlists.
- Real-account acceptance: nothing was sent to a real provider. Every test uses a fake provider.

## Tests
`test/platform-channel-publications.test.cjs` covers:
- OAuth for each channel (scopes, account identity, no secret in views);
- a missing scope or a foreign board;
- a Pinterest pin end to end;
- the TikTok video post with the private default;
- refresh-token rotation outside the envelope;
- the YouTube resumable upload, #Shorts title and a 4xx rejection.
