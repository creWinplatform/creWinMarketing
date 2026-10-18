# Phase 3C2b - Amazon SES controlled pilot

## Release boundary

Implemented inside the existing Next.js modular monolith. Existing campaign,
consent, connection, suppression, unsubscribe and job services are reused.
Crewin's adapters and credentials are unchanged. This is a bounded standard-
project pilot, not bulk marketing or a production launch. Sending defaults OFF.
No actual email was sent during development; unit transports/provider replies
and browser QA credentials are disposable fixtures, not live provider evidence.

## Operator setup

1. Save a customer-project SES SMTP connection for the chosen region (465 TLS or
   587 STARTTLS), then select it in Sender & pilot. Do not copy Crewin credentials.
2. Verify the sending domain and Easy DKIM in SES. Complete Ryzevo's separate DNS
   TXT ownership challenge. If custom MAIL FROM is configured it must succeed in
   SES. Provider-managed MAIL FROM is supported, but is not receiver SPF evidence.
3. Create a project-specific configuration set with an enabled SNS destination
   covering DELIVERY, BOUNCE and COMPLAINT. Use a distinct topic/project in the
   same AWS sending account and commercial region. Historical topic ownership
   cannot move projects.
4. In SES settings enter configuration-set name, topic ARN and a permanent AWS
   access-key pair matching the selected SMTP account. Access-key ID must equal
   SMTP username; AWS's regional SMTP-password derivation must match the saved
   password. Unrelated IAM keys and temporary STS keys are rejected. Keys use the
   existing project-bound encrypted envelope and never appear in responses.
5. Required IAM actions on that principal: `ses:SendRawEmail` for the authorized
   sender, `ses:GetEmailIdentity`, `ses:GetAccount`, and
   `ses:GetConfigurationSetEventDestinations`. Restrict resources where supported;
   account-level reads need the appropriate account scope. The app never creates
   IAM grants, identities, subscriptions or DNS records automatically.
6. Deploy behind public HTTPS and set `PLATFORM_PUBLIC_ORIGIN` to the actual
   Ryzevo origin. Copy the scoped feedback URL from the panel. Create and confirm
   the SNS HTTPS subscription in AWS with raw-message delivery disabled. Ryzevo
   never visits SubscribeURL or auto-confirms a subscription.
7. Publish `{"eventType":"RyzevoFeedbackCheck"}` through that SNS topic. AWS wraps
   and signs it. Only a genuine signed notification records endpoint evidence;
   posting unsigned JSON cannot open the gate.
8. Check SES from the panel. Identity, Easy DKIM, sending health and the exact
   configuration-set event destination must pass. SES evidence expires after an
   hour; signed feedback evidence after 24 hours. DNS/SMTP have independent
   lifetimes. AWS still enforces sandbox destination-identity restrictions.
9. Only after operator approval set `PLATFORM_EMAIL_PILOT_SEND_ENABLED=1` and
   restart the deployment. Do not enable it just to make local status green.
   Review consent, suppression and the pilot allowlist. An owner/admin must
   approve current content and separately acknowledge the real pilot.

## Existing queue and API

Migration 18 preserves migration-17 rehearsal jobs and encrypted snapshots. It
adds SES settings, historical topic bindings, signed-receipt deduplication,
encrypted prepared MIME and unique submission reservations. `platform_jobs`
uses `email.pilot_send` beside `email.rehearsal`, not a second worker subsystem.

- `/api/platform/ses`: authenticated GET; POST `action:save` or `action:verify`.
  Standard-project connection/recipient managers only. Fixed AWS SDK read commands,
  exact saved credentials, one attempt and bounded timeout; no global AWS fallback.
- GET `/api/platform/email-pilots?campaignId=...&mode=send`: scoped actual history.
  Omit mode for existing rehearsal history.
- POST `action:enqueue_send`: campaignId, expectedDigest, expectedReviewId,
  idempotencyKey, acknowledged, sendAcknowledged. Client mode/proof/scope cannot
  grant authority; existing `enqueue` remains no-send.
- POST `action:run_send`: id; one recipient per call. The existing private cron
  worker handles the same job type. POST `action:cancel` cancels untouched rows;
  already handed to SMTP means uncertain, not falsely unsent.
- Public `/api/platform/email-feedback/{connectionId}` accepts bounded SNS
  envelopes. Persisted connection/topic bindings determine project ownership.

Every submit rechecks source freshness, exact content approval, initiator/manual-
runner roles, consent, unsubscribe/suppression, allowlist, SMTP/DNS, SES proof,
configuration revision and deployment flag. Checks run again after network setup
immediately before reserving the single SMTP attempt.

## Limits and semantics

- 1-5 deterministic allowlisted recipients/pilot; one active actual job/project.
- At most 20 reserved actual recipients/project/UTC day; once/contact/day and
  once/campaign-content-contact. A new idempotency key or cancellation does not
  recycle reservations. Conservative reservations require deliberate review.
- Existing shared queue quota: 20 new pilot jobs/project/day, 500 retained jobs;
  rehearsal and actual modes share it. SES checks: 20/day.
- One recipient/claim, 60-second fenced lease, 18-second SMTP deadline, 2-second
  minimum gap, at most seven claims for a five-recipient job.
- `accepted` means SES acknowledged SMTP, not delivery. `delivered` requires a
  signed Delivery event and means recipient-server acceptance, not inbox/read.
  Queue `completed` means all submission attempts were processed.
- Ambiguous SMTP or expired in-flight lease is not retried automatically; the
  rest stops. SMTP Message-ID is not an exactly-once guarantee.
- Permanent bounce/complaint blocks the project address and source identity,
  cancels unsent rows and cannot be downgraded by Delivery. Earlier-send feedback
  still works after credential rotation or manager revocation.
- Signature, fixed certificate host/public-IP pin, TLS, certificate size/expiry,
  timestamp, topic/account, random attempt, recipient HMAC and provider message ID
  are validated. Raw SNS bodies and SMTP responses are not persisted/returned.

## Remaining live acceptance

Choose one explicitly authorized test address. Inspect received content and
Authentication-Results (SPF/DKIM/DMARC), DKIM coverage of one-click unsubscribe
headers, body unsubscribe and one-click POST. Reconcile real signed feedback.
Do not claim this from metadata, offline MIME or fixture events.

Back up database AND encryption key before deployment; restore with the same
key and AUTH_SECRET. Current Node 20 works with this installed SDK; plan Node 22+
before adopting AWS SDK versions requiring it. No major runtime upgrade included.

Primary references: [SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html),
[SNS signatures](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html),
[SES event fields](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html),
[RFC 8058](https://www.rfc-editor.org/info/rfc8058/).

## Local verification - 2026-10-16

- 153 platform tests pass, including 20 SES/transport/feedback/migration tests.
  Official SDK commands and native SNS cryptography are covered without real
  credentials or sends. An 18-second stalled-DNS test checks the real deadline.
- All 22 existing agent regression tests pass. The Windows sandbox initially
  denied atomic rename; the unchanged suite passes outside that restriction.
- TypeScript and isolated production build pass. Expanded production HTTP test
  passes with disposable databases, revoked/viewer/cross-project checks, unsigned
  feedback denial, rejected client proof, OFF deployment flag and rehearsal mode.
- Production dependency audit: zero vulnerabilities. Existing development-tool
  advisories and workspace-root/lockfile build warning were not silently changed.
- Chrome: 1440 desktop, 768 tablet and 390 mobile; no document horizontal overflow.
  TR/EN, light/dark, mismatched-key error, successful disposable save with cleared
  secret fields, reopening forms and three-recipient no-send rehearsal checked.
  Real pilot remained disabled; no actual message or AWS verification was made.
- Before local migration, online backup:
  `crewinjob-web/data/backups/2026-10-16T07-48-32-812Z-5fde2263` (schema 17).
  Local schema 18 integrity is `ok`, foreign-key errors zero, SES configurations
  zero; fixture accounts/credentials were not added to the real database.
- Local development restored on port 3033, isolated dev output, sending OFF.
  Disposable QA servers/tabs closed and viewport override reset. No deploy.

Screenshots: [desktop](screenshots/ses-settings-desktop.jpg),
[mobile](screenshots/ses-pilot-mobile.jpg). They show disposable QA data only.
