# Agency view

Decisions (27 October 2026):

- **Access to client projects.** A client can invite an agency, and an agency can open client projects of its own.
- **Agency package.** 10 client projects for USD 299 a month (yearly = 10 months, USD 2,990). Each linked project gets Growth rights.
- **Coverage.** The package covers every project the agency links: projects it opened, and projects a client invited it to. A client project joins the package only with the client owner's consent.

## Phase 1: invitations of existing accounts and the portfolio (schema 60)

### Inviting an existing account

Project settings → Team → "Invite an existing account".

- A member with `members.manage` invites an existing Ryzevo account by its email, as editor, analyst or viewer; admin is reserved for owners.
- Only a SHA-256 hash and a masked form (`t***@agency.example`) of the email are stored.
- The answer is the same whether or not such an account exists.
- The invitation reaches only an account whose verified account email matches, so it depends on account email (SES) being on.
- At most 20 open invitations per project and one per email. Invitations last 14 days and can be revoked.
- Accepting adds the membership with the invited role, inside the project's team limit and the trial's two seats. It is refused when the inviter has since lost the right to add people, or is no longer the owner for an admin invitation.
- Declining, revoking and expiry all close the invitation.
- The invitee hears about it in "Needs attention" (and in the alert email when opted in), with counts only.

### The portfolio

`/portfolio`, reached from "All projects" in the project switcher, lists every standard project the person belongs to (first 50). Each project shows:

- the role and plan;
- urgent alerts and warnings, and decisions waiting for the person — the same lists that project's overview shows them;
- live posts in the last 30 days;
- open inbox items, only with the reading duty;
- whether last month's report is approved.

Everything is read with the person's own rights in that project; nothing crosses from one project to another. Opening a project switches the session through `/api/workspace`, and membership is checked again on every request. Pending invitations are accepted or declined on the same page.

### Files and tests

- Server: `lib/platform/member-invites.ts`, `portfolio.ts` and `member-invites-types.ts`.
- Routes: `app/api/platform/member-invites/route.ts` and `app/api/platform/portfolio/route.ts`.
- Page: `app/portfolio/page.tsx`.
- UI: `PortfolioPage.tsx` and `ProjectAccountInvites.tsx`, plus the switcher link in `WorkspaceShell.tsx`.
- Tests: `test/platform-member-invites.test.cjs`, plus HTTP checks — the signed-out `/portfolio` redirects to login, and both APIs return 401.
- QA: `scripts/preview-design.cjs --dev --inbox --alerts --portfolio`.

## Phase 2: the agency package (schema 61)

### Buying

- The package is bought on any project's Plan and payment section. It is sold through the same live PayTR flow, terms snapshot, contract email and 14-day renewal window as Launch and Growth; the price is USD 299 a month or USD 2,990 a year.
- It is stored as a Growth period marked `package='agency'` on that project, which becomes the agency's home project. Only Growth may carry the marker, enforced by a CHECK constraint.
- No stored card and no automatic renewal. Live payment stays behind `PLATFORM_PAYTR_LIVE_ENABLED`.

### What it covers

- The home project, and up to 10 linked client projects. Pending requests count towards the 10.
- Each covered project gets Growth rights while the package or its 7-day grace runs. A project's own paid period comes first.
- Pilot projects keep pilot rights and cannot be linked.
- When the package and its grace end, linked projects return to their own base: a trial, or for agency-opened projects the base mode `agency`. In base mode `agency`, records stay and new work stops, like an ended trial.

### Opening a client project

From `/portfolio` → "Open a new client project":

- It creates a new organization and project, owned by the agency owner, with base mode `agency`, and links it at once.
- The mode exists because `trial_owner_id` is unique, so each person has one trial; an agency's projects must not use up its trial or receive a free one.
- The agency invites its client from that project's Team section.

### Linking an invited project

From `/portfolio` → "Add to agency package" on a project the agency owner is a member of:

- If the agency owner also owns that project, it is linked at once.
- Otherwise it becomes a request. The client owner sees it in "Waiting for your decision" and in Plan and payment → "Agency package", and approves or declines it.
- Approval re-checks that the package is running and has room.
- The client owner can remove the project at any time, and so can the agency. Coverage ends at once.

### Rights

- Only the home project's owner (`billing.manage`) manages the package.
- Only the client project's owner decides on its link.
- Every request re-checks membership, project type and the package period.

### Storage

- Two new columns, `platform_billing_live_orders.package` and `platform_project_subscriptions.package`.
- A new table, `platform_agency_links`: agency and client project, origin (`created` or `invited`), state (`requested`, `linked`, `declined` or `removed`) and who decided. At most one open link per project.
- `platform_project_entitlements` is rebuilt in place to allow the `agency` mode. No table references it; the dry run on a copy and a test with existing pilot and trial rows confirm the rows are unchanged.

### Files and tests

- Server: `lib/platform/agency.ts`.
- Package plan: `AGENCY_PACKAGE` in `plan-catalog.ts`, handled in `billing-live.ts`.
- Rights: `entitlements.ts`.
- Routes: `app/api/platform/agency/route.ts` and `agency-links/route.ts`.
- UI: the agency section of `PortfolioPage.tsx` and `AgencyLinksPanel.tsx`.
- Tests: `test/platform-agency.test.cjs` covers purchase through a signed notification, opening projects up to 10, consent, removal, lapse, rights, the portfolio and the migration. HTTP 401 checks are included.
- QA: `scripts/preview-design.cjs --dev --portfolio --agency`. It writes a stub agency period; no PayTR call is made.
