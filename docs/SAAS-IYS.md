# İYS in the send flow (30 October 2026)

**Status (2 November 2026): switched off.** With `NEXT_PUBLIC_IYS_ENABLED` unset (`iysEnabled()` in `lib/platform/iys-types.ts`):
- every project, Crewin included, behaves as if it declared no İYS duty: no gate, no send block, no queueing, no worker calls to İYS, no team alerts;
- the settings tab, the consent-source selects, the review check and the job-guide step are hidden, and `/api/platform/iys` answers 404;
- records already stored stay in their tables.

Setting it to `1` and restarting turns everything below back on (a production build needs a rebuild, since the value is inlined in the browser bundle).

İYS (İleti Yönetim Sistemi) is Turkey's register of commercial-message consents. Ryzevo checks it inside the email pilot and WhatsApp send flows of standard projects, so no live commercial message reaches a recipient in Turkey without a consent İYS confirms. New consents and opt-outs are reported to İYS within three business days.

## Decisions
- **Duty:** İYS is mandatory for a project that declares "we send commercial messages to recipients in Turkey". Without a declaration, live email and WhatsApp stay closed; rehearsals work. A "no" is recorded with who and when.
- **Scope:** Ryzevo projects, and Crewin's own WhatsApp and email senders. Crewin declares and connects on its own project. Its WhatsApp gate applies to Turkish (+90) numbers; its email gate applies to recipients whose nationality is TR or unknown, skips company audiences (merchant exemption) and starts in measure mode (`docs/CREWIN-WHATSAPP-CONSENT.md`).
- **Recipients:** treated as individuals (BIREYSEL). The merchant (tacir/esnaf) exemption is off unless the project turns it on (schema 77, below).
- **Channels:** email is EPOSTA; WhatsApp is MESAJ.
- **Deadline:** three business days (`iysDueAt`).
  - Skipped: weekends and Turkey's full-day official holidays (`TR_FIXED_HOLIDAYS`, `TR_RELIGIOUS_HOLIDAYS`).
  - Half days (eves, 28 October) count as business days.
  - Religious holidays count only for years whose Diyanet calendar is published (2026 and 2027 for now; add a year when it is out). A year without them skips only the fixed holidays.
  - So the deadline is never later than the legal one.
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

## Merchant exemption (schema 77, 5 November 2026)

Commercial messages to merchants and tradespeople (tacir/esnaf) need no prior consent. The recipient can still reject through İYS.

**Turning it on**

- The exemption is the project's statement. It is turned on with an explicit acknowledgement by a connection manager (`setMerchantExemption`).
- Who turned it on and when is kept (`platform_iys_settings.merchant_*`). Turning it off makes marked recipients need a consent again.

**Marking recipients**

- Recipient or connection managers mark email addresses or phones as merchants, with an evidence note such as a trade name or tax number (`addMerchants`, `removeMerchant`).
- Marking needs the exemption on.
- The list is stored in `platform_iys_merchants`, encrypted and masked, with at most 2,000 per project.

**The gate for a marked recipient**

| Situation | Result |
|---|---|
| İYS holds a RET | `iys_rejected` |
| The recipient has been checked in İYS, and the check (or the change feed) is less than 24 hours old | sent, without needing an ONAY |
| Never checked | `iys_stale` |

**İYS calls**

- The status query uses `recipientType: TACIR` for marked recipients. The check time is stored even when İYS has no record.
- Their opt-outs are queued with `recipient_type = TACIR` and uploaded as such.
- Everyone else stays BIREYSEL.

**Panel:** Project settings → Sending consents (İYS) → "Merchant recipients".

**Legal confirmation:** which recipients count as merchants, and that a rejection check is enough for them, must be confirmed with a legal adviser before turning the exemption on.

## Open points
- **API details:** the paths and fields follow İYS's service-provider API as used by public client libraries:
  - `POST /oauth2/token`;
  - `GET /sps/{iysCode}/brands`;
  - `POST /sps/{iysCode}/brands/{brandCode}/consents`;
  - `POST .../consents/status`;
  - `GET .../consents/changes?after=`.
  - The official documentation could not be opened from here, so check the paths, the status query and the change-feed paging against it, ideally in the sandbox, before going live.
- **Not built yet:**
  - SMS;
  - religious holidays for 2028 onwards (add them to `TR_RELIGIOUS_HOLIDAYS` when Diyanet publishes the dates);
  - Reporting Crewin's sign-up email consents (ONAY) and backend opt-outs (RET): the panel's queue will report them once the backend exposes consent changes (`docs/CREWIN-BACKEND-IYS.md`).
  - Crewin campaigns sent by the backend's own Dispatch are not measured. In enforce mode the panel sends individual audiences itself, through the gate, until the backend applies the same rule.
  - Turkish recipients only: Crewin applies its gates to +90 numbers and to TR or unknown nationalities; Ryzevo projects still apply them to every recipient.

## Tests
`test/platform-iys.test.cjs` uses a fake İYS transport, with no network. It covers:
- the declaration gate, viewer and Crewin access;
- connect and verify, with no password in views or storage;
- queueing, the 3-business-day rule (official holidays included), the upload body (BIREYSEL, İYS date format) and freshness;
- the merchant exemption: opt-in, marking, the TACIR status query and opt-out upload, the rejection-only gate and turning it off;
- opt-outs from withdrawal, unsubscribe (resolved and unresolved) and the change feed;
- the email pilot refusal and the review check;
- the WhatsApp source requirement, opt-out, suppression after removal and shared keys;
- bounded queries, business-day deadlines and final İYS rejections;
- the team alert.

Shared fixtures (`email-pilot-fixture.cjs`, the WhatsApp test setup) declare "no İYS duty" so the existing live-send tests keep their meaning.
