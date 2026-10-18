# Ryzevo verified identity and recovery

Implemented inside the existing monolith. No customer or legacy Crewin mail
connection is used. Existing invitation, usernames, memberships, project packs
and login/session contracts are preserved.

## User flows

- Project settings > Account & access > Recovery email: enter the mailbox and
  current password, then explicitly confirm the emailed verification link.
  A username that happens to look like email is NOT automatically verified.
- Sign in > Forgot password: request a link using the verified recovery email.
  After reset, sign in with the original username and new password. Old scoped
  session versions and outstanding OAuth requests/proofs are invalidated.
- Sign in > New workspace: public registration stays invitation-only until the
  separate signup gate is enabled. First verify the mailbox; only then choose
  organization, project, website, timezone and password. It creates one new
  standard workspace/owner, never a Crewin membership or paid entitlement.
- Existing invitations continue through /join unchanged. Legacy deployment-admin
  recovery remains an operator secret-rotation operation, NOT public recovery.

Verified email changes/removal, MFA and domain ownership are NOT implemented.
Mailbox verification proves control of that mailbox, not ownership of a website
or an employer. Existing project goals/setup tools remain the onboarding path;
no duplicate project configuration wizard is added.

## Operator setup (not performed automatically)

1. Keep PLATFORM_AUTH_EMAIL_ENABLED=0 and PLATFORM_PUBLIC_SIGNUP_ENABLED=0 until
   readiness is approved. Back up the database and encryption key before upgrade.
2. Configure PLATFORM_AUTH_ORIGIN with the exact HTTPS Ryzevo origin. Localhost,
   127.0.0.1 and 127.0.0.2 HTTP are supported only for local QA. Links never use Host
   or forwarded headers. Deploy behind TLS before allowing public registration.
3. Configure dedicated PLATFORM_AUTH_FROM_EMAIL, PLATFORM_AUTH_SES_REGION,
   PLATFORM_AUTH_SES_ACCESS_KEY_ID and PLATFORM_AUTH_SES_SECRET_ACCESS_KEY. There
   is NO fallback to AWS default credentials, project SMTP, or legacy credentials.
4. Verify the sender/DNS/DKIM and SES account production access, quotas and
   recipient delivery. Give the dedicated IAM principal only the required SES
   SendEmail permission for the intended sender. The adapter explicitly disables
   click/open tracking using per-message ConfigurationOverrides; no configuration
   set is attached. Do not add downstream link rewriting to security messages.
5. Enable account email, run the existing authenticated platform worker, and do
   one operator-approved verification/reset round trip. The worker submits at
   most one identity message per invocation, with one eight-second SES attempt.
6. Only after abuse monitoring and operator acceptance, enable public signup.
   Hard pilot cap: 100 non-Crewin organizations. Billing is NOT included.

SES transport follows the official [SendEmail API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
The app cannot establish real IAM/DNS/sandbox/delivery readiness without operator
AWS access. It does not fabricate a verified sender or claim email delivery.

## Security and persistence

- Migration 22 is additive: verified mailbox mapping + pre-account identity
  challenges/outbox. No applied migration or existing user row is rewritten.
- Identity is global to the user. Verified mailbox is unique; project membership
  remains scoped by the existing repository. Reset requires an active platform
  account, unchanged security version, and an active workspace membership.
- Tokens are 256-bit random, hashed for lookup, expire in 30 minutes and are
  single-use. Outbox tokens are AES-GCM encrypted with the existing private key
  and a separate identity namespace. Plaintext tokens never enter API responses,
  normal server logs, query strings, activity logs, or project export/history.
- Links carry the token in the URL fragment. Pages remove it immediately, use
  no-referrer/noindex metadata and require an explicit POST to consume it. Simply
  opening an email link does not reset credentials or verify a mailbox.
- Public request responses do not reveal eligibility, configured mailboxes,
  throttling or existence. SES work is asynchronous, not part of request timing.
  Origin is mandatory on identity mutation routes; JSON bodies are bounded.
- Persistent limits: 3 requests/mailbox/hour across signup/reset, 3 verification
  requests/user/hour; global 100 requests/hour and 500/day. Proxy headers are not
  trusted as IP identity. This is a conservative pilot bound, not a replacement
  for edge abuse prevention/CAPTCHA, monitoring or production capacity testing.
- Expired/consumed deliveries lose their ciphertext. Rows expire after 24 hours
  beyond token expiry. At most 3,000 challenge rows are retained. Worker prunes.
- The worker rechecks origin/sender configuration, gates, account/security and
  expiry, reserves submission durably and clears the encrypted message before
  sending. Timeout/crash -> no automatic resend; a new link must be requested.
- Reset clears outstanding identity/OAuth proofs and social permission checks,
  and cancels pending actor-owned outbound work. Already submitted provider
  messages/posts cannot be recalled. Reset does not deactivate other members or
  reuse their credentials. No automatic login after reset or registration.
- Password change from existing settings also invalidates challenge security
  versions. Existing verified addresses cannot be silently rebound.

## Verification

`npm run test:platform:identity` tests isolated/in-memory accounts, fake SES
delivery, scoped registration, expiration/replay, quotas, switches, reserved
mailboxes, reset versions, and outbox reservation. The HTTP suite uses a temporary
database and decrypts its disposable outbox to simulate receipt; it never sends
to AWS. `scripts/preview-design.cjs --identity` uses a separate loopback host and
fake credentials; printed links are short-lived QA fixtures, not production
verification links. No live email, signup gate, or credentials were enabled in
the actual .env.local.
