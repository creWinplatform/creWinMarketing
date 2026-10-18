# Phase 3C1 - selected sender, DNS ownership and pilot boundaries

This is the sender/pilot safety slice, not a delivery worker. It extends the
existing Next.js monolith, encrypted SMTP registry, recipient checks, content
review and RBAC. Standard projects only; Crewin adapters, SMTP env credentials,
external ABP APIs and existing delivery workflows are unchanged.

## Operator flow

Campaigns > Sender & pilot:

1. Select an active project SMTP connection with saved sender settings. Choose
   a maximum of 1-5 recipients per pilot. Existing Connections handles SMTP/TLS
   access testing; only the selected account's current revision-bound test counts.
2. Publish the generated TXT name/value using the domain's existing DNS provider,
   then run Check DNS record. The panel does not write DNS records or send a
   verification email. Copy controls copy the exact DNS field value.
3. Add specifically authorized test addresses to this project's pilot allowlist.
   Acknowledge each addition. Allowlisting does not grant marketing consent,
   manufacture an identity, clear suppression or verify mailbox ownership.
4. Rerun saved campaign preflight. It reports eligible unique recipients, the
   allowlisted intersection, the count after the pilot cap and those outside
   the allowlist. These are diagnostic counts, not sent or delivered messages.

Real sender-domain ownership must be checked after publishing the actual generated
record. No customer DNS change, successful live domain proof, SMTP login or real
email send was performed in this development phase.

## Separate facts, not one green badge

- SMTP access: the selected active project connection has a successful check no
  older than one hour matching its encrypted-credential SHA-256 revision.
- DNS ownership: an exact randomly generated TXT value was observed for the
  selected sender domain. The observation expires after 24 hours, or when the
  challenge expires earlier. It is not SPF evaluation or DKIM verification.
- Authentication: `authentication: not_verified` remains explicit. No provider
  identity API, SPF/DKIM alignment or DMARC evaluation was implemented here.
- Delivery: not tested. `sendingEnabled` remains false even when ownership and
  SMTP access are both good. There is no new send button or customer transport.

## Persistence, privacy and consistency

Additive migration 16 adds `platform_email_sender` and
`platform_email_pilot_allowlist`, both scoped with foreign keys to existing
projects/connections/users. There is one selected sender policy per project, not
a second SMTP registry, campaign model, tenant system or queue.

Sender account name, domain and masked sender address are management metadata.
SMTP host/user/password and credential envelopes never appear in this API.
DNS challenges are 32 random bytes, stored as a hash plus the existing scoped
AES-GCM envelope so the operator can recover the public TXT value for setup.
The TXT value is intended to be public DNS data, not a platform login credential.
Pilot addresses use the same project/key-bound HMAC email identity as recipient
suppression; only masked labels and opaque IDs are stored/returned in this table.

Every mutation checks owner/admin `connections.manage` AND `recipients.manage`,
the standard product pack and an optimistic `expectedRevision`. Subject, project
and organization come from the server session, never request scope fields.
Removing addresses disables the grant; re-adding requires the full address and
explicit acknowledgement again. It never changes consent or unsubscribe records.

Connection revocation, edits or credential replacement immediately invalidate
sender readiness. A successful access test on a different SMTP account cannot
satisfy the selected sender's gate. A stale DNS result cannot commit after a
policy, challenge, connection or permission change during the lookup.

The existing membership transaction clears domain proof/challenge and disables
pilot grants owned by a manager who loses authority. Restoring their role does
not restore old proof or grants; explicit selection/renewal/addition is required.
Live permission checks also apply at read/check time.

Sender/credential/cap changes enter the campaign content digest and require a
new review. Pilot-list and DNS changes bump the existing project safety revision
and invalidate preflight counts, but do not themselves rewrite message approval.
The recipient engine emits internal scoped email keys only after its existing
identity, consent, deduplication and suppression rules pass. Pilot preflight
intersects those keys; no separate recipient evaluator or cross-source join exists.

## DNS lookup boundaries

Only `_ryzevo-verification.<selected sender domain>` is queried, not arbitrary
client-supplied URLs, ports, servers or record names. FQDN validation rejects
IP addresses, credentials, paths, malformed labels and private/reserved suffixes;
the full query name is bounded at 253 characters. Queries use the system resolver.

The Node DNS promise resolver uses a two-second query timeout, one try and a
four-second hard deadline with cancellation. No raw resolver errors, unrelated
TXT records or provider payloads are exposed or logged. Answers cap at 64 records,
32 chunks/record and 32 KiB total; chunked TXT values must match exactly. Missing,
unavailable, mismatching and oversized replies never become verified.
API reference: [Node DNS Resolver](https://r2.nodejs.org/docs/latest-v20.x/api/dns.html).

Challenges expire after seven days; rotation invalidates previous ownership proof.
A failed recheck clears earlier verification instead of retaining a green state.
No TXT-record presence is presented as proof of mail signing or inbox delivery.

## API

Private/no-store `/api/platform/email-sender`, JSON body bounded at 16 KiB.
Mutations require a same-origin POST. GET is read-only.

- GET: sender readiness, active SMTP choices (sanitized), current public TXT
  challenge, last check/error category, masked pilot allowlist and fixed limits.
- POST `action:select`: `connectionId, maxRecipients, expectedRevision`.
- POST `action:renew`: `expectedRevision` (new challenge, old proof invalidated).
- POST `action:verify`: `expectedRevision` (bounded read-only DNS lookup).
- POST `action:allow`: `email, acknowledged:true, expectedRevision`.
- POST `action:remove`: `id, expectedRevision` (disable this scoped pilot grant).

Client fields such as `verified`, `verifiedAt`, arbitrary tenant IDs or alternative
DNS adapters have no effect. Test DNS injection exists only as a server-function
argument in isolated tests; no HTTP test override or success flag is available.

Pilot limits: 1-5 recipients/campaign pilot, 20 active addresses/project, 1,000
stored distinct address grants/project, 100 setting/grant change attempts and 20
DNS check attempts/project/UTC day. Identical address additions are idempotent;
removed/inactive grants cannot be restored by stale requests or role restoration.

## Validation and outstanding work

117 platform tests cover exact/chunked TXT, missing/oversized/network/deadline
responses, cancellation, scoped sender selection, selected-only SMTP checks,
credential changes/revocation, proof expiry/rotation, optimistic races, authority
loss/restoration, allowlist quotas/suppression, existing consent intersection,
7 eligible -> 6 allowlisted -> 5 capped, and migration/data preservation.
The existing 22 Crewin agent regression tests pass. TypeScript and isolated
production build pass. The existing multiple-lockfile warning remains.

Actual temporary-server HTTP tests cover anonymous/viewer/legacy denial,
cross-project SMTP/grant rejection, origin protection, ignored forged proof
fields, cap rejection, masked allowlist add/remove, protected unsubscribe and
real absent TXT lookup. No SMTP authentication or email send is involved.

Visual QA uses disposable data and clearly named fake SMTP credentials:

```powershell
node scripts/preview-design.cjs --product-data --product-webhooks --segments --campaign-review --recipients --sender
```

Chrome verified selection/cap saving, address add/remove, bounded missing-DNS
feedback, copying TXT, mobile submission and 7 eligible -> 4 allowlisted -> 3
capped. TR/EN and light/dark were inspected. Document widths: desktop 1425/1425,
tablet 805/805, mobile 375/375. Screenshots: `screenshots/email-sender-desktop.jpg`
and `screenshots/email-sender-mobile.jpg`. After the final build, direct mobile
entry and language changes kept the selected fourth tab visible; the refresh
button stayed alongside the heading. No horizontal overflow or browser console
errors were observed. TypeScript, all 117 platform tests and the HTTP suite were
rerun successfully against the final output.

Local backup before migration: `data/backups/2026-10-15T20-41-17-602Z-051a277f`.
Local schema 16: integrity `ok`, zero FK errors. Dev runs on 3033, production
validation uses `.next-monolith-platform`; no deployment was performed.

Phase 3C2a now implements the no-send persistent rehearsal described in
[Pilot queue rehearsal](SAAS-EMAIL-QUEUE.md). Real delivery is still closed.
Subsequent Phase 3C2 work must extend the EXISTING persistent queue for bounded
per-recipient delivery, cancellation, live permission/source/consent/suppression/
allowlist/quota rechecks, stable sender and message snapshots, and explicit
ambiguous-provider-outcome handling (no blind retry). Provider authentication
verification and real sender configuration remain release gates. Fake-transport
failure/restart tests come before any explicitly approved small real-mail pilot.
