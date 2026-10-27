# Phone notifications, content repurposing and the last-opened project (schema 62)

## Last-opened project

- Switching project (`POST /api/workspace`) remembers the project in `platform_user_preferences`.
- Login returns to that project if the person can still open it. Otherwise it falls back to their first project, as before.
- Files: `lib/platform/user-preferences.ts`, `app/api/auth/login/route.ts`, `app/api/workspace/route.ts`.

## Content repurposing

On a saved social draft (LinkedIn, Facebook, Instagram, X or Telegram), "Adapt for other channels" creates one new draft for each chosen channel.

- **Nothing is published or scheduled.** Every version is an ordinary draft marked `repurposedFrom`.
- **Who can use it:** only members with `content.write`.
- **Not available for:**
  - starter drafts;
  - drafts that still contain a `{{…}}` placeholder.
- **Limits:**
  - 1–4 channels per request, never the draft's own channel;
  - 30 requests a day per project;
  - each new draft counts towards the content limit.

### Two modes

#### By rules (no AI)

The words stay the same:

- **X:** shortened to fit 280 characters, keeping the first link.
- **Instagram:** links are removed, because caption links do not work. A `{{…}}` note is added so the draft cannot be published until someone writes where to find the link.
- **Other channels:** the text is cut to the channel limit.

#### With AI

AI rewrites the draft for each channel, under the same rules as the growth coach:

- the draft is treated as data;
- no new claims, prices or links may be added;
- the banned-claims list applies;
- Instagram gets no URLs;
- each channel's limit is checked.

A suggestion that breaks any rule is rejected as a whole, and the AI use is refunded.

### Files and tests

- Server: `lib/platform/content-repurpose.ts`.
- Route: `app/api/platform/repurpose/route.ts`.
- UI: `components/platform/ContentRepurpose.tsx`, shown under each draft in `ProjectDrafts.tsx`.

## Phone notifications (web push)

- **Where:** a button in "Needs attention" on the overview turns notifications on or off for the current browser.
- **When one is sent:** when a new alert or a new decision ("Waiting for your decision") comes up in any of the person's projects. At most one is sent every 30 minutes per device.
  - What was already open when notifications were turned on is not notified.
  - A lower number of waiting decisions is not news.
- **No data in the push.** The push carries no payload, so nothing about the project passes through Google, Mozilla, Microsoft or Apple. The phone shows the fixed text "Something new needs you in one of your projects" and opens `/portfolio` when tapped.
- **Push services:** a subscription must point at FCM, Mozilla, Windows or Apple push. Any other address is refused, so the worker never posts to an address someone typed in.
- **Storage:**
  - the push address is stored encrypted (`push:<id>` resource, covered by the recovery check) and found by its SHA-256 hash;
  - one subscription per browser, for the person signed in last;
  - at most 10 devices per person.
- **When the subscription ends:**
  - the push service answers 404 or 410;
  - five errors in a row;
  - the person loses access to the project where they turned it on;
  - the person turns it off.
- **iPhone:** notifications work only after Ryzevo is added to the Home Screen (iOS 16.4 or later) and opened from there. The web app manifest (`app/manifest.ts`, served at `/manifest.webmanifest` without a session) makes it a standalone web app. Its icons are in `public/brand/ryzevo-app-*.png`, including a maskable one for Android.

### Switching it on

Push is off unless all four settings are present:

```
PLATFORM_WEB_PUSH_ENABLED=1
PLATFORM_WEB_PUSH_PUBLIC_KEY=<base64url, 65-byte uncompressed P-256 point>
PLATFORM_WEB_PUSH_PRIVATE_KEY=<base64url, 32 bytes>
PLATFORM_WEB_PUSH_SUBJECT=mailto:ops@your-domain
```

Generate the VAPID key pair once, then keep the private key secret. A new pair invalidates every existing subscription.

```
node -e "const {generateKeyPairSync}=require('crypto');const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});const p=publicKey.export({format:'jwk'}),d=privateKey.export({format:'jwk'}).d;console.log('PUBLIC',Buffer.concat([Buffer.from([4]),Buffer.from(p.x,'base64url'),Buffer.from(p.y,'base64url')]).toString('base64url'));console.log('PRIVATE',d)"
```

### Files and tests

- Server: `lib/platform/web-push.ts` (VAPID ES256 token per RFC 8292, sent without a payload) and `web-push-config.ts`.
- Route: `app/api/platform/push/route.ts`. The push address travels in the request body only, never in the URL.
- Service worker: `public/push-sw.js`.
- UI: `components/platform/PushNotifications.tsx`.
- Worker step: `deliverDuePushes`, up to 5 subscriptions per tick.

## Storage (migration 62)

Migration 62 only adds tables:

- `platform_user_preferences`;
- `platform_push_subscriptions`;
- `platform_push_notices`, deleted together with their subscription.

Tests are in `test/platform-launch-extras.test.cjs` and cover:

- the preference;
- both repurposing modes, rights and limits;
- VAPID signing, checked with the public key;
- pushes through a stub fetch, including that no payload is sent, the 30-minute gap, 404/410 and error handling;
- the migration.
