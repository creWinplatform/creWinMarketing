# Ryzevo application integration QA

Date: 2026-10-15. Local only; no deployment or DNS changes.

## Scope

- Shared Ryzevo logo, default page titles, landing, login, invitation screen.
- Existing catalog-driven workspace shell, mobile navigation and scoped overview.
- Customer-specific CrewinJob modules, endpoints, tenant configuration, sender
  identities and stored data are not renamed or migrated.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run test:platform`: 51 passed.
- `NEXT_DIST_DIR=.next-monolith-platform npm run build`: passed (PowerShell
  environment assignment is required on Windows).
- `npm run test:platform:http`: passed, including public Ryzevo branding,
  authentication, cross-project denial and legacy endpoint boundaries.
- Chrome: normal desktop, 390x844 mobile, 768x1024 tablet, and 375x667 mobile.
  The content viewport excludes the browser scrollbar. No horizontal document
  overflow or overflowing tested button/heading text was found.
- A temporary fixture project was accessed through the normal login screen.
  A content draft was saved through the mobile UI; the overview content count
  changed from 0 to 1 and the readiness checklist changed from 2/4 to 3/4.
- Mobile drawer navigation closes on selection and restores trigger focus.
- Three.js scene is visible on desktop/mobile. Screenshot pixel checks over
  scene regions found nonblank RGB variation (standard deviation > 10).
  Phase selection and pause/resume controls were exercised. After the final
  scheduled frame, the paused frame counter remained stable.
- Supplied logo and public copy have identical SHA256 hashes.
- Test-workspace browser console contained no errors.

Screenshots are in `design-prototype/screenshots/ryzevo-app-*.jpg`. These are
application captures, not the original static prototype. Dashboard captures use
the isolated QA project and must not be presented as customer performance.

## Local server

Port 3033 serves the actual application. The old `.next` cache did not finish
starting; a separate `.next-ryzevo-dev` directory started successfully. To use
the same clean cache in PowerShell:

```powershell
$env:NEXT_DIST_DIR = '.next-ryzevo-dev'
npm run dev
```

The QA fixture server on 31450 was stopped after testing. No real email, social
post, provider authorization or production customer write was performed.

## Remaining limits

- Visual checks do not certify every existing Crewin-specific tab or external
  provider workflow. Those functional implementations were preserved.
- Public signup, billing and automatic sending remain disabled for the standard
  pilot. Branding does not make those capabilities active.
- npm installation reported 7 dependency audit findings (2 moderate, 5 high).
  No forced or unrelated dependency upgrade was applied during this design work.
- Build reports an existing multiple-lockfile/workspace-root warning.
