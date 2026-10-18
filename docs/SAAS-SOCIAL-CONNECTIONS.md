# Customer social connections

Update: the separate [LinkedIn text-publication pilot](SAAS-SOCIAL-PUBLISHING.md)
now extends these connections. Read-only OAuth remains the default; write scope
is explicit opt-in and actual publication defaults OFF. The original connection
checks below still do not prove publishing access by themselves.

## Current scope

- LinkedIn personal-account OAuth, requesting only `openid profile`.
- Manual LinkedIn/X OAuth2 user-token configuration and exact account matching.
- Existing project-scoped encrypted registry and verification jobs, no publishing.

Crewin's social token files, global env credentials and legacy posting adapters
remain isolated from these customer connections.

## LinkedIn server setup

Use a SaaS LinkedIn Developer application with the **Sign In with LinkedIn using
OpenID Connect** product enabled. Register the exact callback and set server-only
environment variables in `crewinjob-web/.env.local`:

```dotenv
PLATFORM_LINKEDIN_CLIENT_ID=YOUR_CLIENT_ID
PLATFORM_LINKEDIN_CLIENT_SECRET=YOUR_CLIENT_SECRET
PLATFORM_LINKEDIN_REDIRECT_URI=http://localhost:3033/api/platform/social/callback
```

Use an accepted, exactly registered development callback; if the provider requires
HTTPS for your app, use the HTTPS development origin consistently for the panel
and callback. Production must use HTTPS. Restart after env changes. Never use
`NEXT_PUBLIC_*`, copy secrets into Git or enable `DEBUG=simple-oauth2*` in production.

In Project Settings, expand **Connect LinkedIn Account**, enter a display name,
and continue. The user personally approves consent on LinkedIn. On return the
server binds the account subject to the originating project. It does not request
email or write permission, treat the ID token as a platform login, or claim to
verify the real-world identity of the account holder.

Successful connection creation still awaits a real user-approved provider test.
Wrong project/browser, replay, expired request, account mismatch and concurrent
revocation are already covered by disposable automated fixtures.

## Manual tokens

Choose Social in Add Connection Details, then LinkedIn or X, an account display
name and the exact account ID. LinkedIn uses its UserInfo `sub`, not an organization
URN; X uses the numeric user ID returned by `/2/users/me`, not a username. Provide
the account's own authorized OAuth2 user token, never an app-only bearer token.
X requires the relevant user-read scopes and provider API access.

Test Access performs only a read-only account match. No message, post, media upload
or tracking metric is produced. Existing placeholder social connections must be
updated with platform/account metadata before they can be tested.

Local revoke clears stored credentials and invalidates pending flows. Provider-side
grant removal remains manual so that a shared grant is not revoked unexpectedly.
LinkedIn reconnect is required at token expiry; no refresh support is assumed.

## Next adapters and gates

1. Facebook/Instagram OAuth, explicit page/business-account selection and app review.
2. X OAuth onboarding and scoped refresh-token rotation; TikTok if required.
3. Per-channel publishing permission checks, media handling and user-approved pilot.
4. Dispatch worker, scheduling, cancellation, quotas and actual delivery/metrics.

These are not enabled by the current account-access check. No live provider secrets
were entered or consent approved during QA.

References: [LinkedIn OpenID Connect](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2),
[LinkedIn authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow),
[X authenticated-user sample](https://github.com/xdevplatform/samples/blob/main/python/users/get_users_me.py).
