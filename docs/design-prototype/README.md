# Ryzevo Growth Studio: isolated design prototype

Platform name: **Ryzevo**. Intended product domain: **ryzevo.com**.
CrewinJob remains an example customer project, not the SaaS platform name.
The user's original logo board is reused unchanged, with CSS logo windows for
the supplied light and dark variants. No logo geometry has been redrawn.
Domain registration, DNS, TLS, deployment, real service URLs and tenant names
are not changed by this prototype branding update.

This is a local design exploration, not a replacement for the application.
For local HTTP preview, run `node preview.mjs` (loopback only, default port 3034).
All fonts, icons, 3D code, and images are local; no npm installation is necessary.
Direct file navigation was not browser-verified because the automation policy permits
HTTP(S) only. Use the HTTP preview for the validated experience.

## Scope

- Landing with a custom Three.js scene and three phase selectors.
- Workspace overview, campaign list, step-based campaign editor, review inbox.
- Content previews, research context, calendar, SEO handoff, measurement plan, settings.
- Search, example project switching, mobile drawer and mobile navigation.
- Approval and pilot interactions are simulations. No email is sent.
- No existing source, auth, database, API, permissions, campaign or customer record is modified.
- All counts, people, companies, dates and campaign outcomes are clearly example data.
- Changes are in memory for the current page session, not durable application records.
- Some secondary save controls only demonstrate feedback; this is not a complete
  replacement for the application's persistence, delivery or scheduling logic.

## Design handoff

The landing is a brand and product narrative. The workspace prioritizes work waiting
for a decision, campaign readiness, the day's agenda, and project-defined outcomes.
The campaign view connects an inspectable sequence to a contextual editor. On mobile,
the sequence and editor stack rather than shrinking a desktop canvas.

If adopted, wire these components into existing scoped repositories, API bridges,
approval rules and SiteSeoAction flows. Do not create duplicate data or delivery paths.

## Dependencies

- Three.js 0.160.0, MIT, https://github.com/mrdoob/three.js
- Lucide 0.468.0, ISC, https://github.com/lucide-icons/lucide
- Manrope, SIL Open Font License, from the existing project's installed font package.
- Career preview image reused unchanged from the project's existing public assets.

Pinned local browser builds keep this exploration independent of npm installation,
Next.js build output, production dependencies and CDN availability.
