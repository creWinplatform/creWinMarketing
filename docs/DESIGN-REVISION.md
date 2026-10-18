# Product design revision - 2026-10-14

The previous delivery established functionality, but its visual hierarchy, small
typography, generic brand treatment and cropped product preview were insufficient.
This revision changes presentation and task ergonomics, not the external Crewin
API contracts or organization/project authorization boundaries.

## Changes

- Locally bundled Manrope variable typography, neutral operational surfaces,
  graphite navigation, lime navigation accent and cobalt action buttons.
- Shared brand, project selector, breadcrumbs, accessible mobile navigation and
  context tools integrated into the top bar. Existing saved theme preferences are
  preserved; new browsers start in the light theme.
- New public landing composition: full-bleed raster art, larger brand typography,
  real product screenshots, interactive accessible product tabs and honest pilot
  scope. No invented testimonials, performance, logos or pricing.
- New login composition, retaining existing authentication behavior.
- Customer dashboard with prioritized work, actual manual goal observations,
  project readiness and direct navigation to existing tools.
- Crewin dashboard with live-data availability checks, consistent KPI hierarchy,
  registration and profile distributions, existing content/post history and
  actionable navigation. Additional profile/company views are collapsed instead
  of preceding and duplicating the main dashboard.
- Common form, list, table, settings, calendar, responsive and empty/error styles.
  Campaign editing brings the editor into view and focuses its first field.

## Visual assets

The original architectural hero was generated with the built-in image generation
tool. Asset: `crewinjob-web/public/images/marketing-pathway-v2.webp`; the full PNG
is retained beside it. WebP conversion only compresses the original raster.

Prompt: A premium, physically realistic architectural still-life, ultrawide. A
continuous folded paper/anodized-metal ribbon rising through straight layered
fins and terraces. Main sculpture across the lower right and centre, clean neutral
white negative space at the upper left for typography. Crisp sunlight, physical
paper texture and contact shadows. White and silver, acid-yellow/lime ribbon and
a small cobalt structural piece. No text, logos, dashboards, people, balls,
gradients, bokeh, globes or plants. One immersive scene, not split panels/cards.

The six `product-*-v2.webp` screenshots are real browser captures from a disposable
SQLite fixture, using an explicitly fictional Northstar project. Demonstration
observations are labelled as manual example data. No private application data,
credentials or actual customer performance is published in these assets.

## Verification Scope

Desktop 1440px, mobile 390px, tablet 768px and narrow 320px were inspected in
Chrome. Shared navigation, dashboard, campaign list/editor, reports and calendar
were exercised in the isolated fixture. The landing product tabs, actual image
loading, mobile composition, overflow and login were checked separately.

Existing Crewin tools remain available; a live provider send or full operational
acceptance test of every legacy tab is not implied by this visual revision.
The commercial SaaS gaps in SAAS-PILOT-READINESS.md remain unchanged.

TypeScript, the isolated production build, 51 unit/SQLite tests and the HTTP
integration scenario pass. Production dependency audit remains at zero findings;
the seven previously documented web build-toolchain advisories are unchanged.
The final browser check confirmed editor focus/scroll positioning, campaign edit
save and persistence after reload, light/dark contrast, loaded product screenshots
and keyboard navigation between the landing's product tabs. The 3033 development
server remains running; the disposable fixture server is stopped after QA.

Proof images: `docs/screenshots/landing-redesign-desktop.jpg`,
`docs/screenshots/landing-redesign-mobile.jpg`,
`docs/screenshots/workspace-redesign-desktop.jpg`.
