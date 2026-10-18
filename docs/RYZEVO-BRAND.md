# Ryzevo product identity

- SaaS platform name: **Ryzevo**, wordmark: **ryzevo**.
- Intended product domain: **ryzevo.com**.
- User-supplied logo source: `design-prototype/assets/ryzevo-brand-board.png`.
- Brand direction: the supplied black, white and lime logo variants.
- The original logo board is retained unchanged; the prototype uses CSS display
  windows and a canvas texture rather than redrawing the logo geometry.

## Keep product and customer identity separate

CrewinJob is a customer/example project inside Ryzevo. Its customer-specific
modules, campaign content, sender branding, crewinjob.com URLs, api.crewin.org
integration, credentials and tenant configuration must not be globally renamed.

The application now uses a shared Ryzevo brand component on the landing page,
login, invitation page and workspace navigation. The standard SaaS overview uses
project-scoped operational records; it does not import prototype metrics.

The landing scene uses a lazy-loaded Three.js module, with pause controls,
reduced-motion support and explicit WebGL resource cleanup. The original logo
board is also copied unchanged to `crewinjob-web/public/brand/`.

Deployment, DNS, TLS, authentication, customer integrations and database keys
are unchanged. No public signup, billing or automatic sending is enabled by this
visual integration. `ryzevo.com` is the intended brand domain, not a deployed URL.

## Local verification

`npm run dev` serves the app on port 3033. The isolated design reference remains
under `docs/design-prototype/`; it is not the production application.

After building with `NEXT_DIST_DIR=.next-monolith-platform`, developers can run
`node scripts/preview-design.cjs` from `crewinjob-web` for visual QA on port 31450.
It creates a temporary fixture database and never opens the normal application
database. Fixture measurements are examples, not customer performance.
