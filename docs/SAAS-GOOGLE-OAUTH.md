# Customer Google connections

The customer connector belongs to the Next.js monolith. It does not reuse Crewin's
service-account credentials, GA4 property, Search Console site or token caches.

## Server configuration

Create a Google OAuth Web application client for the SaaS application. Enable the
Analytics Admin API and Search Console API in that Google Cloud project. Configure
the consent screen and test users for a test-only application. Public access needs
the appropriate Google review/verification for the selected scopes.

Register this exact local callback on that client:

`http://localhost:3033/api/platform/google/callback`

Set these private server variables in `crewinjob-web/.env.local`:

```dotenv
PLATFORM_GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID
PLATFORM_GOOGLE_CLIENT_SECRET=YOUR_WEB_CLIENT_SECRET
PLATFORM_GOOGLE_REDIRECT_URI=http://localhost:3033/api/platform/google/callback
```

Restart the development server after changing environment variables. Production
must use the application's HTTPS origin and the same callback path, registered
exactly in Google Cloud. Do not put these variables in `NEXT_PUBLIC_*`, client
code, screenshots, Git or support logs. Back up SQLite with its encryption key.

## Customer flow

1. Enter the correct standard customer project and open Project Settings.
2. Expand Connect Google Account and choose GA4 or Search Console.
3. Enter the numeric GA4 property ID, or the exact Search Console property
   (for example `sc-domain:example.com` or `https://example.com/`).
4. Set an account display name and continue to Google.
5. The user personally chooses the account and grants the requested read-only
   consent. The account must already have access to the requested property.
6. On return, the server validates the flow and property before encrypting tokens.
7. Run Test Access. Later verification jobs renew expired access tokens when needed.

Do not switch project during consent. A callback with a different active project,
browser, expired state or removed permission is rejected. Retry by starting a new
flow; authorization codes are intentionally single-use.

Local Revoke clears credentials and invalidates pending flows. Google-side grant
removal is not automatic: use Google account permission management if required.
This avoids invalidating a shared grant used by another property connection.

## Acceptance checks

Still needs real credentials and user-approved consent:
- Authorized GA4 and Search Console connection creation.
- Explicit denial and missing-property permission.
- Renewal after access-token expiry and reconnect after Google grant revocation.
- Google account selection and production callback registration.

Automated tests use disposable accounts/databases and mocked Google token responses;
they do not substitute for these live checks. This connector does not enable mail
sending, social publishing or marketing report ingestion by itself.

Reference: [Google web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
