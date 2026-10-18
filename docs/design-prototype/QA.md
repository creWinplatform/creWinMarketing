# Prototype verification

## Confirmed

- JavaScript syntax checks: `node --check studio.js` and `node --check scene.js`.
- CSS parsed successfully with the existing project's PostCSS installation.
- Landing and workspace rendered in Chrome at 1440px and 390px viewport widths.
- Mobile workspace and campaign editor had no horizontal document overflow.
- Mobile menu opened, navigated to campaigns, and closed on selection.
- Closed mobile navigation is inert, keeping its offscreen controls out of focus order.
- Editing the email subject appeared in the preview.
- Pilot control remained disabled before campaign approval.
- Approval changed campaign readiness and enabled the pilot control.
- Pilot simulation completed explicitly without sending any email.
- Workspace search filtered to Content Studio and opened the matching view.
- The existing career image loaded in Content Studio.
- Desktop navigation reached research, calendar, SEO, measurement, connections,
  settings, campaign, content and inbox views.
- Example data is labelled. Measurement view shows disconnected sources, not invented
  Search Console, ranking, PageSpeed, revenue or performance metrics.
- Scene canvas frame counter advanced, and selecting the second phase changed its
  selected state.
- Pixel checks of saved scene regions were nonblank on desktop and mobile.
  RGB channel standard deviations: desktop [54.26, 40.94, 44.89],
  mobile [63.59, 48.38, 52.73].
- Content Security Policy has `connect-src 'none'`; there are no API clients or tokens.

## Limitations

- Later browser transport recovery switched to the in-app browser. Its viewport
  capability did not apply requested tablet/narrow-phone dimensions (the observed
  viewport remained 1280x720). These extra sizes are not claimed as verified.
- Direct `file:` navigation is not permitted by the browser automation policy and
  was not tested. Local HTTP preview is the verified route.
- The Three.js legacy browser build emits a deprecation warning. It is deliberately
  pinned only in this isolated prototype. A production adoption should use the
  application's package-managed module build.
- Backend integration, durable records, real sends, real scheduling and live metrics
  are outside this design exploration.
- No Next.js build or existing application test suite was run: application code and
  dependencies were not changed by this prototype.

## Screenshots

See `screenshots/landing-desktop.jpg`, `dashboard-desktop.jpg`,
`landing-mobile.jpg`, `dashboard-mobile.jpg`, and `campaign-mobile.jpg`.
