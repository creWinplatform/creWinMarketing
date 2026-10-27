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

## Phase 2 (next): the agency package

- An agency account and the package purchase: prepaid, through PayTR live behind the same switches.
- Agency-opened client projects.
- Linking an invited client project with the client owner's consent (it shows in the client's approval list).
- Growth rights for linked projects while the package or its grace runs.
