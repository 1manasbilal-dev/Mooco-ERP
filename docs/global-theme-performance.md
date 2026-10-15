# Global theme and app performance

The shared shell, forms, cards, tables, buttons and segmented controls now use the central Mooco theme. The lime brand is complemented by the dashboard's cyan, violet and rose accents. Due and advance colours retain their financial meanings. Light and dark modes share the same hierarchy and focus treatment.

The glass appearance uses tinted surfaces, gradients, fine borders and inset highlights. Scrolling cards no longer each need a backdrop blur; the mobile header and drawer use smaller blur areas. The large background colour wash is static. Interactive transitions, dashboard swipe gestures and reduced-motion support remain available. Saved theme and font scale apply before the first paint; one font family loads with `display=swap`.

## Performance changes

- Restored workspace tabs download a page only after it is visited. A session with 16 saved tabs loads one active page at startup, verified before and after with the same isolated probe.
- Visited pages use React Activity to keep their DOM and draft state while pausing hidden effects. Closing a tab releases its page. Tests verify effect cleanup, reactivation, scroll position, input draft and DOM identity.
- Notification commands have a stable context separate from the changing toast list. Showing and dismissing a notification no longer re-renders command consumers. Toast animation uses CSS.
- Quick search and user switching load when opened. Protected-route checks continue to gate business pages.
- PDF dependencies load on export and share a cached promise. Failed loads can retry. Both Day Book and customer-balance downloads are exercised in an isolated browser.
- Shared JSX, CommonJS and class-name helpers live outside optional chart/animation bundles. The production entry graph no longer pulls in charts or animations just to use a shared helper.

## Measurements

The table below retains the historical raw and gzip byte measurements. Generated measurement files, screenshots and PDF test exports were removed during project cleanup. `scripts/measure-bundle.mjs` generates a fresh measurement for the current build when run. Measurements sum the production entry and its static JavaScript dependencies. Optional pages, the dashboard chart once opened, fonts, CSS, data and PDF downloads are separate. These are byte reductions, not promises about a particular device's elapsed loading time or database response time.

| Measurement | Before | After (approximately) |
| --- | ---: | ---: |
| Initial static JavaScript | 1,405 KB | 872 KB (38% less) |
| Initial static JavaScript, gzip | 407 KB | 247 KB (39% less) |
| Reports page JavaScript | 830 KB | 234 KB (72% less) |
| Saved page modules loaded at startup, 16 saved tabs | 16 | 1 |

Total application JavaScript remains approximately 3.53 MB: optional features were deferred rather than removed. The build emits a manifest for independently checking the entry graph.

## Reports and verification

Reports fit the available workspace height and scroll internally. Its mobile category menu overlays the report within the available bounds. Compact chart ticks preserve full values in tooltips while avoiding clipped axis labels. Print previews define light paper tokens and dark semantic text so PDF exports remain white and readable while the app is in dark mode. Verification also found a missing credit-bill count used by the existing Day Book template; it now receives the computed count, and the invoice total uses the unique sale count rather than summing overlapping tender categories.

- `scripts/verify-global-theme.mjs`: all 16 modules at 1440, 390 and 320 pixels, light and dark modes; 96 combinations. Uses isolated representative records, blocks live data requests and does not save business records.
- `scripts/verify-workspace-performance.mjs`: saved-tab loading, notification rendering, hidden effects and form/scroll retention. `--baseline` captured previous behavior.
- `scripts/verify-production-loading.mjs`: production startup and manifest dependencies, fresh storage and blocked live data calls.
- `scripts/verify-reports-performance.mjs`: deferred PDF loading, both real PDF downloads, white paper in dark mode and mobile report selection.
- Existing dashboard and sidebar checks cover totals, touch swipes, focus, permission filtering, compact mode and theme persistence.
- TypeScript and production build checks complete the verification. Screenshots use test records and are visual previews, not live balances.

Implementation references: [React Activity](https://react.dev/reference/react/Activity), [Vite dynamic import handling](https://vite.dev/guide/features.html#dynamic-import), and [Rollup manual chunks](https://rollupjs.org/configuration-options/#output-manualchunks).
