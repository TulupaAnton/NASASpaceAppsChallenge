# Analysis panel integration

Source: `origin/main-dontDelete`, commit `e4f85c6` (November 15, 2026).
The source was imported selectively; no merge or replacement of the opening
flow was performed.

The complete panel includes Site/Compare navigation, history presets and year
selectors, forecast horizons, weighted screening-score contributions, lazy
Chart.js charts, disclosures for measurements and methodology, exact-point
analysis, and comparisons of up to three locations. The old Area tab and its
unused components/API were removed to match the source branch.

The point API and calculation engine now accept `startYear`, `endYear` and
`horizonYears`. Default regional reports remain bundled; nondefault windows
use the exact-point engine. Comparisons check period, weights, data coverage
and wind-source compatibility before showing score differences. The archived
Rauma sample remains partial and intentionally has no total screening score.

The panel's styles, footer-height measurement and map viewport/zoom behavior
were merged into the local shell. Earth assets, intro timing, country picker,
cloud crossing and full-screen-to-fitted map reveal remain intact. The map's
first-paint handshake and continuous feathering were preserved. The legacy
report pages and datasets remain available for existing source/download links.

Checks cover every bundled region plus Rauma, comparison compatibility,
custom history/forecast periods through the real engine with provider fixtures,
and the existing opening/cloud/map regressions. Visual assessment remains with
the user.
