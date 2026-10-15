# Dashboard redesign — 1 October 2026

The dashboard presents a business overview with colourful glass panels, the Mooco lime identity, cyan / violet / rose / amber accents, a stable sidebar and matching dark mode. The expanded palette follows the owner's request for colourful glassmorphism.

## Research and design direction

- [Stripe's dashboard overview](https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights?locale=en-GB): useful financial summaries, quick access to frequent tasks and configurable sections.
- [Linear's interface redesign](https://linear.app/changelog/2024-03-20-new-linear-ui): clear hierarchy, restrained navigation, readable contrast and less visual clutter.
- [UX Design Awards 2024 yearbook](https://ux-design-awards.com/media/pages/events-media/ux-design-awards-yearbook-2024/4dc7c247ef-1726050755/uxdesignawards_yearbook_2024.pdf): the nominated Composable Dashboard provided a reference for configurable financial experiences. This app has not received an award.

## Features

- Sales, milk intake, operating expenses and an explicitly labelled operating-surplus estimate.
- Manual sales, milk, expenses and product chart tabs, product selection and an equal-length previous-period comparison. No chart autoplay.
- Current retail stock, varieties, stock value, the existing 500 L tank capacity and negative / over-capacity warnings.
- Milk allocation journey, cash / online / khata collection breakdown and actionable operational priorities.
- Best sellers, largest customer receivables with credit-limit warnings, expense categories and recent transactions.
- Current cash and bank / wallet balances, separate cash in transit and party payments.
- Saved section visibility, manual refresh, overview CSV export and mobile quick actions.
- Keyboard focus indicators, named icon controls, reduced-motion support and a focus-managed milk detail dialog.

## Premium sidebar

The sidebar now uses a floating frosted panel, an inset logo mark, colour-coded icon tiles, fine category dividers, a lime selection marker and a glass profile menu in both themes. Link labels remain available in compact mode through accessible names and tooltips.

The compact control saves its preference and shares it with Settings. Hover and keyboard expansion reveal the menu over the page while the compact rail keeps the dashboard width stable. The existing module permissions still determine visible links, groups and section headings.

Mobile navigation opens as a focus-managed drawer with a blurred backdrop, an inert background, swipe-left dismissal, vertical menu scrolling and Escape support. Focus returns to the opener when the drawer closes. Navigation closes the mobile drawer automatically.

`node scripts/verify-sidebar.mjs` uses the real navigation provider with isolated user data and a placeholder for destination pages. It covers group / child selection, compact persistence, preference synchronization, profile actions, focus restoration, drawer bounds at 320 and 390 pixels, vertical touch scrolling, swipe dismissal, reduced motion and restricted permissions. Running it generates screenshots and results in `screenshots/sidebar-redesign/`; previous generated captures were removed during project cleanup.

## Glass, motion and touch upgrade

- Translucent surfaces, softened colour gradients, glass borders, tinted charts and an ambient aurora background. Desktop hover states lift cards; the stock vessel has a subtle liquid wave.
- Dashboard entry reveals the greeting, toolbar, four individual KPI cards, chart and stock panel in a short stagger. The stock vessel fills smoothly and the current chart draws in. Entry motion replays when a saved dashboard tab is shown; date filters and data refreshes retain the current page. Mobile uses a shorter rise and duration, and keyboard focus bypasses entry motion. Reduced-motion preferences show the content immediately. Directional chart transitions remain available. All animation colours and glass treatments are defined in the central theme and stylesheet.
- On mobile, KPI summaries, the milk journey, operational priorities and the three business-insight panels use native horizontal momentum scrolling and snap positions. A partial next card shows the additional content. The carousel footer, dots and previous / next buttons have been removed at the user's request; focused card tracks support arrow keys and Home / End.
- Swipe left / right over the performance chart to cycle through sales, milk, expenses and products. Swipe over the reporting-period selector to step between Today, Yesterday, 7 days and This month; date navigation stops at each end.
- Vertical touch gestures retain ordinary page scrolling. Form controls and screen-edge navigation gestures are excluded from custom swipes. Small movements do not change views, and a completed swipe does not activate its underlying button.
- Keyboard arrows support the chart and date controls. Reduced-motion changes are honoured while the app is open, including native carousel navigation and chart rendering. Mobile uses less blur and disables ongoing background movement.

## Reporting corrections

Dates and timestamped sales use Asia/Karachi. Daily charts cover all 24 hours in half-hour buckets; entries that only store a date use the noon bucket. Weekly and month-to-date comparisons use the preceding period with the same number of days. Current stock and balances remain current when a historical reporting period is selected. Liquidity excludes non-cash account types. Zero reorder levels remain disabled. Retail allocations are not reduced by separately allocated production input.

Operating surplus is sales less milk procurement and operating expenses. It is an estimate, not a full inventory-based profit-and-loss report. The interface identifies this distinction.

## Verification

Run the app locally, then `node scripts/verify-dashboard.mjs`. The script uses an isolated browser context and substitutes representative records in that browser only. It does not seed, modify or connect to the production database.

Verified: KPI totals, Pakistan midnight boundaries, equivalent previous periods, stable current stock, metric and product controls, saved panel visibility, refresh, CSV export, milk details, keyboard focus, mobile navigation and both themes. Viewport widths: 320, 360, 390, 430, 640, 768, 1024, 1440 and 1920 pixels. Empty periods, zero denominators, large amounts, long names and negative stock were also checked.

The touch checks send real browser touch events: both directions on all four card tracks, readable card widths, keyboard carousel navigation, touch-to-open milk details, chart metric swipes, product selection, date boundaries and vertical page scrolling without an unintended metric change. Reduced-motion and keyboard alternatives are also covered.

The stock panel's View stock and Allocate milk action row has been removed. Daily business-performance charts now aggregate all four metrics into 48 half-hour buckets from 00:00 to 23:30 in Pakistan time, for both the selected and previous day. The axis automatically spaces labels to fit the screen; tooltips identify each half-hour bucket. Multi-day ranges retain daily totals. Date-only records remain at noon because they have no recorded transaction time. Automated checks cover 00:29:59 / 00:30:00 boundaries, UTC-to-Pakistan midnight, 23:59:59, previous-day comparison and preserved totals.

Running the dashboard verification script generates screenshots in `screenshots/dashboard-redesign/` using representative test data. Its generated `checks.json` records responsive checks and runtime errors. Previous captures and exports were removed during project cleanup. The app continues to use the real DairyContext in normal operation.
