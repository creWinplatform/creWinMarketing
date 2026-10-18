# Ryzevo responsive and keyboard acceptance

18 October 2026. This is a bounded local acceptance pass, not a WCAG
certification or a claim that every legacy Crewin screen has been audited.

## Scope and changes

- Shared SaaS shell, public landing, sign-in and representative dashboard,
  campaign editor, settings/plan/billing and work calendar views.
- Mobile/tablet form fields use 16px text. Shared controls and landing scene
  controls have 44px touch targets; the narrow header can wrap without covering
  content. Legacy tool-specific layout rules are not replaced.
- Mobile navigation makes the background inert, traps keyboard focus, closes
  on Escape and at the desktop breakpoint, and restores the actual opener.
  Choosing a tool places focus in the main content instead.
- Wide table/calendar/goal regions have keyboard focus, descriptive names and
  visible focus outlines. Horizontal scrolling remains inside the region.
- Sign-in password has a separate label and named visibility toggle with
  pressed/control semantics. Identity pages expose their selected language.
- Campaign body character counts describe the field rather than becoming its
  accessible name.

No auth/permission, payment, sending, external API or database schema contract
changed. The optional `--dev` mode on `scripts/preview-design.cjs` uses its own
`.next-design-qa` build directory; the normal fixture uses the production build.
Next's generated TypeScript include for that directory is retained.

## Verification

Chrome viewport checks used 1440x960, 768x1024, 390x844 and 320x740. These are
desktop-browser viewport overrides, not real iOS/Android hardware checks.

| Check | Observed result |
| --- | --- |
| Public landing | Brand and scene visible, headings fit, no document-level horizontal overflow at tested sizes. Stage selection and animation pause work. |
| Three.js content | Saved desktop before/after stage images had a 0.754 changed-pixel ratio in the scene crop; mobile scene was nonblank. This is not an animation performance benchmark. |
| Sign-in | Production field text is 16px at 390px; password name is exactly Password, toggle state/control is present, selected page language is en. Fictional-account login succeeds. |
| Mobile menu | Close receives initial focus; reverse/forward Tab wrap stays inside; Escape returns to the actual opener. Background inert is restored on close. |
| Breakpoint change | Resizing an open menu to desktop closes it and restores scrolling/focus. |
| Narrow layout | 320px production menu fits the viewport. Representative SaaS pages do not horizontally scroll the document. |
| Campaign editor | At 320px the visible inputs/selects/textarea use 16px, channel choices are at least 44px tall, body count is a description. Editor was cancelled without saving. |
| Calendar/table keyboard scroll | ArrowRight scrolls the focused calendar and payment-history regions; the page itself remains within the viewport. |
| Tablet | Dashboard, menu/search and calendar fit; search/select text is 16px. |
| Build | `NEXT_DIST_DIR=.next-monolith-platform npm run build`: passed, including type validation and 28 static pages. |
| TypeScript | `npx tsc --noEmit`: passed. |
| Offline platform suite | 395 passed, 0 failed, 0 skipped. |
| Production HTTP regression | `npm run test:platform:http`: passed; login, provisioning, cross-scope denial, revocation and legacy API boundary. |

Authenticated visuals used a temporary SQLite fixture, fictional example.com
project and offline provider stubs. Actual sends, social publishing, public
signup and PayTR checkout were gated OFF. The fixture was stopped; the main
3033 development server was kept separate and running. No deployment occurred.

The authenticated screenshots below were recaptured on the final production
build, without development overlays:

- [Desktop workspace](screenshots/saas-workspace-desktop-20261018.jpg)
- [Tablet workspace](screenshots/saas-workspace-tablet-20261018.jpg)
- [Mobile workspace](screenshots/saas-workspace-mobile-20261018.jpg)
- [Mobile sign-in](screenshots/saas-login-mobile-20261018.jpg)
- [Desktop landing](screenshots/saas-landing-desktop-20261018.jpg)
- [Tablet landing](screenshots/saas-landing-tablet-20261018.jpg)
- [Mobile landing](screenshots/saas-landing-mobile-20261018.jpg)

## Remaining boundaries

Screen-reader acceptance, contrast auditing across every state, OS reduced-motion
emulation, real-device checks and a complete legacy Crewin module audit remain.
Existing live-provider, PayTR merchant, second-business pilot and production
operations gates in SAAS-NEXT-DELIVERY.md are unchanged. The earlier Docker QA
image predates this frontend increment and is not a release artifact for it.

18 October subsequent release check: Tailwind/PostCSS 4.3.3 migration has a
legacy/shared utility regression and zero full-audit advisories. Desktop menu
visibility was made explicit; sampled light muted text is now 5.22:1 against
the workspace surface. HSS Digital temporary fixture passed desktop/tablet/dark,
390px and 320px checks, campaign save and audit-to-calendar flow. Landing stage
change pixel ratio was 0.520 in the scene crop; mobile RGB standard deviations
were 71/70/72 (nonblank), both visible brand images loaded. OS reduced-motion,
actual devices and full screen-reader/contrast acceptance are still not claimed.
Current Linux application QA image is `ryzevo-monolith:qa-release-20261018`,
not the earlier historical image referenced above. See SAAS-RELEASE-STATUS.md.
