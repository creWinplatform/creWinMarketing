# İYS in the send flow (30 October 2026)

İYS (İleti Yönetim Sistemi) is Turkey's register of commercial-message consents. Ryzevo checks it inside the email pilot and WhatsApp send flows of standard projects, so no live commercial message reaches a recipient in Turkey without a consent İYS confirms. New consents and opt-outs are reported to İYS within three business days.

## Decisions
- **Duty:** İYS is mandatory for a project that declares "we send commercial messages to recipients in Turkey". Without a declaration, live email and WhatsApp stay closed; rehearsals work. A "no" is recorded with who and when.
- **Scope:** Ryzevo projects only. Crewin's own email and WhatsApp tools do not check İYS (a later, separately approved step). Since 30 October, Crewin's WhatsApp sends need a consent recorded in the panel (`docs/CREWIN-WHATSAPP-CONSENT.md`).
- **Recipients:** treated as individuals (BIREYSEL); the merchant (tacir) exemption is not used.
- **Channels:** email is EPOSTA; WhatsApp is MESAJ.
- **Deadline:** three business days. Weekends are skipped; public holidays are not counted as days off, so the deadline is never later than the legal one.
- **Legal confirmation:** the owner confirms with a legal adviser that WhatsApp counts as MESAJ, the deadline rule, and the exemptions below.

## How it works
- **Declaration and connection** (Project settings → Sending consents (İYS), `components/platform/IysPanel.tsx`, `GET/POST /api/platform/iys`):
  - The declaration and the connection need `connections.manage`.
  - The connection takes the İYS API user (username, password), İYS code, brand code and environment (live or sandbox).
  - The user is checked at connect time: a token is requested (password grant) and the brand must be one of the account's brands.
  - Credentials are stored in the encrypted connection envelope (provider `iys`) and never returned.
- **Statuses** (`platform_iys_recipients`): what İYS reported per recipient and channel (ONAY / RET), where it came from (query, change feed or our own upload) and when.
  - The keys are the same ones the email store (`emailIdentity(...,'email',[email])`) and the WhatsApp store (`phone_hash`) use. Addresses are stored encrypted.
- **Reporting queue** (`platform_iys_outbox`):
  - **Queued as a consent (ONAY):**
    - email consent reviews (`EmailRecipients.review`), which then need "How was consent obtained?" (an İYS `HS_*` source);
    - WhatsApp contacts added with consent, which need the same.
    - A consent older than three business days is not queued; İYS should already hold it, so its status is queried instead.
  - **Queued as an opt-out (RET):**
    - a consent withdrawal;
    - a Ryzevo unsubscribe link (`processRyzevoUnsubscribe` + `queueIysUnsubscribe`; the address is found in the mapped source);
    - an opt-out reported by the product webhook;
    - a WhatsApp opt-out or STOP reply.
    - An opt-out blocks sending at once, before İYS is told.
  - **Unresolved:** when the address cannot be found, the item is marked failed for a person to report.
- **Worker** (`deliverIysOutbox`, `pullIysChanges`):
  - Uploads up to 10 due items per tick. An İYS rejection is final; other failures retry up to 3 times.
  - Reads İYS's change feed every 30 minutes per project, so rejections made on İYS's side apply.
- **Status query:** the "Check recipients in İYS" button queries the email pilot allowlist (addresses found in mapped records) and the WhatsApp contacts: at most 50 per run, oldest first.

## The gate
`iysGate(db, scope, channel, key)` runs right before each live send: `EmailPilotQueue.liveReason` for `email.pilot_send`, and the claim step of `ProjectWhatsApp.process`.

| Reason | When |
|---|---|
| `iys_scope_missing` | no declaration |
| `iys_not_connected` | declared Turkey, no connection |
| `iys_no_consent` | no ONAY known for the recipient |
| `iys_rejected` | RET (ours or İYS's) |
| `iys_stale` | the status is older than 24 hours and the change feed has not been read successfully in 24 hours |

- **Before queueing:** a live pilot or WhatsApp batch is refused without a declaration, or without a connection for Turkey (`iysSendBlock`). The campaign review shows an "İYS declaration and connection" check before approval.
- **Not gated:**
  - rehearsals (nothing is sent);
  - inbox replies to conversations the customer started (24-hour window).

## Also in this change
- **WhatsApp:** removing a contact that had opted out keeps a hashed suppression (`platform_whatsapp_suppressions`). The number comes back only with a consent dated after the opt-out.
- **Team alerts:**
  - `iys_deadline`: items due within a day, overdue, or failed;
  - `iys_sync`: the change feed has not been read for 6 hours.
- **Job guide:** the email job has "Declare sending consents (IYS)". The go-live checklist item points to the panel.
- **Schema 67:** `platform_iys_settings`, `platform_iys_recipients`, `platform_iys_outbox`, `platform_whatsapp_suppressions`. The recovery contracts cover both encrypted recipient columns.

## Open points
- **API details:** the paths and fields follow İYS's service-provider API as used by public client libraries:
  - `POST /oauth2/token`;
  - `GET /sps/{iysCode}/brands`;
  - `POST /sps/{iysCode}/brands/{brandCode}/consents`;
  - `POST .../consents/status`;
  - `GET .../consents/changes?after=`.
  - The official documentation could not be opened from here, so check the paths, the status query and the change-feed paging against it, ideally in the sandbox, before going live.
- **Not built yet:**
  - the tacir exemption;
  - SMS;
  - a public-holiday calendar;
  - İYS for Crewin's legacy senders. Its WhatsApp route has had its own consent and opt-out list since 30 October (`docs/CREWIN-WHATSAPP-CONSENT.md`).

## Tests
`test/platform-iys.test.cjs` uses a fake İYS transport, with no network. It covers:
- the declaration gate, viewer and Crewin access;
- connect and verify, with no password in views or storage;
- queueing, the 3-business-day rule, the upload body (BIREYSEL, İYS date format) and freshness;
- opt-outs from withdrawal, unsubscribe (resolved and unresolved) and the change feed;
- the email pilot refusal and the review check;
- the WhatsApp source requirement, opt-out, suppression after removal and shared keys;
- bounded queries, business-day deadlines and final İYS rejections;
- the team alert.

Shared fixtures (`email-pilot-fixture.cjs`, the WhatsApp test setup) declare "no İYS duty" so the existing live-send tests keep their meaning.
