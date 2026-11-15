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

The panel's styles and map viewport/zoom behavior were merged into the local
shell. The bottom footer and its height observer were subsequently removed;
map credits are in the header. Earth assets, intro timing, country picker,
cloud crossing and full-screen-to-fitted map reveal remain intact. The map's
first-paint handshake and continuous feathering were preserved. The legacy
report pages and datasets remain available for existing source/download links.

Checks cover every bundled region plus Rauma, comparison compatibility,
custom history/forecast periods through the real engine with provider fixtures,
and the existing opening/cloud/map regressions. Visual assessment remains with
the user.

## Data period controls

The `DateRepo` commit `1996b9b` replaces the History/Forecast controls with
`DataPeriod`. The collapsed card shows historical and projected years and
average temperatures. Change dates opens a draft editor; Cancel and Escape
discard edits, while Apply dates recalculates. History covers 1984–2024 with
a minimum three-year span, and the projection offers 5, 10, 15 or 20 years.
Use default dates restores 2005–2024 with a ten-year projection.

Comparison uses the same applied period for every site and reuses a saved
report only when its period key matches. Temperature projection is available
as a comparison chart metric, with the selected metric retained across date
changes. Existing country configuration and the cleaned map shell are preserved.
While Compare is open, its loader owns period recalculation; the hidden Site
view does not issue a duplicate exact-point request. Returning to Site loads
the report for the current applied dates.

`tests/browser/data-period.mjs` verifies draft/cancel/Escape, date application,
summary temperatures, comparison report reuse and reset through real browser
input. Custom reports are computed from bundled Canadian fixtures through the
real point engine; no live provider calls or visual inspection are required.
