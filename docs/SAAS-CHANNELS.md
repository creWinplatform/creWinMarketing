# TikTok, Pinterest and YouTube Shorts publishing (4 November 2026)

Standard Ryzevo projects can publish approved items to three more channels, through the same publication center, approval, publishing check, server switch (`PLATFORM_SOCIAL_PUBLISH_ENABLED`) and daily limits as Instagram, Facebook, LinkedIn and X.

| Channel | What is published | Account | Provider API |
|---|---|---|---|
| TikTok | One video (MP4/MOV, up to 300 MB, from the team's own https address), or a photo post of 1–5 images; caption up to 2,200 characters | The creator (`open_id`) | Content Posting API, `PULL_FROM_URL` (video: the team's address; photos: signed media URLs on `PLATFORM_PUBLIC_ORIGIN`) |
| Pinterest | One pin: one image (2:3 allowed) or one video, the item's title, a description up to 500 characters and the first link to the team's site | One board (its numeric id) | API v5 `POST /v5/pins`: `image_base64`, or `/v5/media` upload + `video_id` |
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
  - TikTok needs a video (format `feed`) or 1–5 images; YouTube needs a video;
  - Pinterest needs exactly one image or one video. Pinterest images may be 0.5–1.91 (2:3 pins); every other channel keeps 0.8–1.91 (`normalizePublicationImage(data, mime, platform)`);
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
- **TikTok photo posts:**
  - Ryzevo sets the preparation time, signs one URL per image on the public origin and sends them to TikTok.
  - `providerPublicationImage` serves a TikTok job's images in the checking, submitting and accepted states for 15 minutes, because TikTok fetches them after accepting the post.
  - The origin's domain must be verified in the TikTok app.
- **Pinterest video pins:**
  1. Register the media (`POST /v5/media`).
  2. Stream the approved file as multipart to the Pinterest upload host (only `*.amazonaws.com`, never held in memory).
  3. Poll `/v5/media/{id}` until it succeeds (at most about 3 minutes).
  4. `reserve()` and create the pin. The job lease is extended to 15 minutes.
- **Engagement counts** (Publication center → refresh, with a fresh access token):
  - YouTube: views, likes, comments.
  - Pinterest: impressions, saves, outbound clicks (90 days).
  - TikTok: views, likes, comments, shares. They are read once TikTok has made the post public (status fetch → `video.list`). TikTok connections now also ask for `video.list`.

## Server settings (`.env.local.example`)
- `PLATFORM_TIKTOK_CLIENT_KEY`, `PLATFORM_TIKTOK_CLIENT_SECRET`, `PLATFORM_TIKTOK_REDIRECT_URI`.
- `PLATFORM_TIKTOK_PRIVACY`: default `SELF_ONLY`. An unaudited TikTok app may post only privately; after TikTok's audit, e.g. `PUBLIC_TO_EVERYONE`.
  - The domain the video is served from must be verified in the TikTok developer portal (`PULL_FROM_URL`).
- `PLATFORM_PINTEREST_CLIENT_ID`, `PLATFORM_PINTEREST_CLIENT_SECRET`, `PLATFORM_PINTEREST_REDIRECT_URI`. Pinterest's trial access may limit pins until the app is upgraded to standard access.
- `PLATFORM_YOUTUBE_CLIENT_ID`, `PLATFORM_YOUTUBE_CLIENT_SECRET`, `PLATFORM_YOUTUBE_REDIRECT_URI`.
- `PLATFORM_YOUTUBE_PRIVACY`: default `private`. Unverified Google projects upload private videos; after verification of the `youtube.upload` scope, `public` or `unlisted`.
- All three redirect URIs must be `<panel>/api/platform/channels/callback` and registered in each provider's app.

## Not covered
- Pinterest board creation.
- YouTube long videos and playlists.
- A TikTok post URL: TikTok returns the publish id; the public post id appears in its counts once it is public.
- Real-account acceptance: nothing was sent to a real provider. Every test uses a fake provider.

## Tests
`test/platform-channel-publications.test.cjs` covers:
- OAuth for each channel (scopes, account identity, no secret in views);
- a missing scope or a foreign board;
- a Pinterest pin end to end;
- the TikTok video post with the private default;
- refresh-token rotation outside the envelope;
- the YouTube resumable upload, #Shorts title and a 4xx rejection;
- 2:3 Pinterest images;
- a TikTok photo post with signed media URLs;
- a Pinterest video pin (multipart stream, processing wait, upload-host check);
- the three channels' engagement counts.
