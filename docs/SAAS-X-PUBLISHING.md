# X text publication pilot

## Boundary

X text publishing extends the EXISTING project connections, saved content and
campaign drafts, Calendar > Social publications, approval, queue, worker and audit.
Internal channel key stays `twitter`; no data rename or schema migration is needed.
No legacy `TWITTER_*`, Crewin token file, ABP service or other customer's grant is
read. Images, threads, replies, Premium long posts and engagement metrics are not
part of this adapter. No provider consent, real post or deployment was performed.

## Private operator configuration

Use a separate X confidential Web App with OAuth 2.0 enabled. Register the exact
callback in the provider console and verify current API access and billing there.
Local configuration alone is NOT evidence of provider access or payment readiness.

```dotenv
PLATFORM_X_CLIENT_ID=YOUR_CLIENT_ID
PLATFORM_X_CLIENT_SECRET=YOUR_CLIENT_SECRET
PLATFORM_X_REDIRECT_URI=http://localhost:3033/api/platform/x/callback
PLATFORM_SOCIAL_PUBLISH_ENABLED=0
```

Production callback must use the deployed HTTPS panel origin. Credentials remain
server-side; never enter them in chat or NEXT_PUBLIC variables. This change does
not populate `.env.local` or enable the global live-publication flag.

## Connection and permissions

Project Settings > Connections > Connect X account uses S256 PKCE, a short-lived
HttpOnly browser cookie, encrypted server-side verifier and the existing scoped,
single-use OAuth request store. State belongs to actor, organization and project.
Role loss, credential replacement or revocation during consent prevents saving a
stale grant. Application revision is checked before and after code exchange.

Default scopes are `tweet.read users.read`. Only explicit checkbox consent adds
`tweet.write`. Token exchange uses confidential Basic authentication and validates
the actual returned scopes, expiry and exact `/2/users/me` account identity.
Tokens and write-scope provenance are stored only in the scoped AES-GCM envelope.
The generic connection endpoint cannot set that provenance, even if a caller
includes `xPublishing` in JSON. A manually saved token cannot become publishable
through an identity-only check, and replacing a grant clears its proof.

This pilot does not request `offline.access`, retain a refresh token or silently
refresh credentials. The provider normally issues a two-hour token; the actual
expiry returned by OAuth is displayed and enforced. Reconnect before expiry.
Live jobs cannot be scheduled beyond that expiry. Reconnect invalidates existing
queued approval; review and enqueue anew instead of silently transferring consent.

Publishing check validates saved write-scope provenance, current app revision,
expiry and fresh exact user identity. It does NOT invent a token-introspection
endpoint or guarantee that posting permissions, app access or billing have not
changed at the provider. Such changes fail closed when the provider rejects the
actual post. Proof expires within five minutes; worker repeats the checks.

## Publishing

1. Save an X text in the existing Content Library, or use `perPlatformContent.twitter`
   in an existing campaign draft. A saved campaign CTA is appended once, before
   preview, counting and approval. No other channel is dispatched.
2. Choose the matching X account in Calendar > Social publications. Exact saved
   text is shown with a server-computed weighted counter using official
   `twitter-text@3.1.0` (including URL/emoji rules), maximum 280. Empty, oversized,
   invalid/control characters, media and unresolved template variables are blocked.
   Text is not truncated, rewritten or silently normalized by this adapter.
3. Run rehearsal now or scheduled. No provider request occurs, and no write access
   or delivery success is claimed. Future jobs wait; unsent jobs can be cancelled.
4. A real post additionally needs the operator flag, valid current grant check and
   explicit public-publication approval of exact source/account/schedule revision.
   An operator must authorize a real pilot separately; never enable it just for QA.
5. Worker durably reserves the attempt before ONE `POST https://api.x.com/2/tweets`
   with only `{text}`. A valid 201 receipt with a numeric post ID is accepted and
   linked through `https://x.com/i/status/ID`; untrusted provider URLs are ignored.
   Known 4xx rejections (including access, billing or rate-limit errors) fail without
   exposing provider bodies. Network errors, 5xx, malformed/oversized receipts or
   lost responses are uncertain, NOT automatically retried. Accepted/uncertain
   content is deduplicated for that account. Cancellation after submission is not
   deletion or retraction.

Existing shared pilot limits remain: 20 new intents and 100 permission checks per
project/day; 5 actual reserved attempts/day shared across social platforms; 500
retained jobs. Snapshots are encrypted. Fresh role/source/credential/app checks,
leases and idempotency prevent stale or concurrent workers from reposting.

## Validation

New unit suite: `test/platform-x-publications.test.cjs` (17 cases), included in
`npm run test:platform`. Coverage includes weighted limits/URLs/emoji/CJK, exact
payload, OAuth provenance and replay protection, wrong project/browser, revoked
consent, role loss, expiry, immutable previews, schedule/cancel, fenced workers,
deduplication, safe receipts and no retry after an uncertain outcome.

HTTP tests additionally exercise same-origin/RBAC, exact callback boundaries,
read-vs-write consent URLs, ignored forged grant metadata and scoped X rehearsal.
Fixtures use disposable databases and fake credentials with real publishing OFF.
Visual fixture: `node scripts/preview-design.cjs --x-publications` (port 31450).
Never use fixture credentials or examples as customer/provider acceptance evidence.

Verified locally on 2026-10-16: all 234 platform tests, 22 legacy-agent tests,
isolated production HTTP suite, `npx tsc --noEmit` and production build passed.
`npm audit --omit=dev --audit-level=high` reported zero vulnerabilities. The existing
multiple-lockfile/root-inference build warning remains; no X import warning remains.
Chrome checked 1440/768/390 widths, TR/EN, light/dark, X content counter/overlength,
rehearsal, actual future scheduling and cancellation. Page scroll width matched
client width at all tested breakpoints. OAuth consent checkbox was unchecked by
default and no browser console errors/warnings were captured. Real provider OAuth
consent and posting were NOT exercised. Screenshots: `docs/screenshots/x-publications-desktop.jpg`,
`x-publications-mobile-cancel.jpg`, `x-connection-desktop.jpg`.

## Primary References

- [X OAuth 2.0 PKCE, scopes and token lifetime](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X create-post endpoint](https://docs.x.com/x-api/posts/create-post)
- [Official twitter-text implementation](https://github.com/twitter/twitter-text/tree/master/js)

Operator must recheck provider access/terms before live activation. This pilot is
not general SaaS launch readiness; onboarding/recovery, billing, production
operations and a second-business live pilot remain in SAAS-NEXT-DELIVERY.md.
