# DataX Documentation

**Team Prumaty · NASA Space Apps Challenge 2026 · Version 2.0.0**

DataX is a web application for exploring historical temperature trends and screening potential data center sites in Finland and Canada. The satellite map provides 19 Finnish and 13 Canadian regional reports, plus analysis for selected land coordinates.

For the *Be An Earth System Trend Detective!* challenge, DataX uses monthly NASA POWER near-surface air temperature (T2M). It shows where temperature is changing, plots the historical series as annual averages, and reports the rate of change in °C per decade, a 95% confidence interval, and a significance test. Solar, wind, and water indicators support the site screening use case. [Challenge description](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/?tab=details)

## 1. Quick start

Use Node.js 20.9 or later, npm, and a modern browser.

1. Open a terminal at the **project root**, alongside `package.json`, `package-lock.json`, and `app/`.
2. Install the locked dependencies and start the development server.

```bash
npm ci
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000).

Once installed, the map and prepackaged reference reports work without Python, API keys, or external data requests. Exact-coordinate analysis and custom dates require the server to reach the upstream data providers (with local hydrography fallbacks for Finland and Canada if the flood API is rate-limited). The globe intro uses WebGL, with a map fallback if WebGL is unavailable or reduced motion is enabled.

### Production deployment

Run the commands below from the same project root. Deploy to a Node.js host that can serve the API routes.

```bash
npm ci
npm run build
npm start
```

The default port is 3000. Set `PORT` to override it. For remote development, set `ALLOWED_DEV_ORIGINS` in `.env.local` to a comma-separated list of hostnames or IP addresses without schemes, ports, or paths. Then run `npm run dev -- --hostname 0.0.0.0`.

## 2. User guide

1. **Choose a country.** Select Finland or Canada in the country picker. Use **Skip intro** to open the map. Use the header buttons to switch countries and **Replay intro** to replay the globe sequence.
2. **Choose a site.** Select a city marker for a bundled regional sample, or select a point within the mapped land boundary to analyze those coordinates. Scroll, pinch, or use **+** and **−** to zoom. With the map focused, the arrow keys move the cursor, **Enter** selects a point, and **Home** fits the country to the viewport.
3. **Read the report.** In **Site**, check the screening score and its factor contributions. Open **Measurements and charts** for annual air temperature and monthly solar and wind charts. Open **Method & statistics** for the trend, confidence interval, p-values, and score weights.
4. **Change the period.** Open **Data period** and choose **Change dates**. Select a historical window and projection length, then choose **Apply dates**. To return to the bundled period, choose **Use default dates**, then **Apply dates**.
5. **Compare sites.** Choose **Add to comparison** on two or three sites in the same country, then open **Compare**. The first site is the baseline (A). The selected dates apply to all sites, and switching countries clears the list.

| Report label | What it represents |
| --- | --- |
| **Regional sample** | One reference location per Finnish region or Canadian province or territory. Each ranking covers only the reference sites in its country. |
| **Archived point** | A saved point report near Rauma with partial water data. |
| **Exact point** | A report based on gridded data queried for the selected coordinates. Select a point, choose **Analyze exact coordinates**, or apply a non-default historical period or projection length to generate it. Exact points have no regional rank. |

The default record is **2005–2024** and the default projection is **2025–2034**. The historical presets are 2005–2024, 2015–2024, and 1984–2024. A custom historical period must span at least three calendar years within 1984–2024. The interface offers projection lengths of 5, 10, 15, or 20 years.

The comparison shows score differences when the reports have complete scores and share the country, historical period, projection period, scoring mode, weights, active indicators, and wind data source (`merra2`). Other pairs can still show available measurements and charts. **Data & sources** and **Map credits** provide attribution. Finland also has downloadable CSVs and a pipeline archive.

## 3. Data and methodology

### Data sources

| Source | Use |
| --- | --- |
| [NASA POWER Monthly API](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/) | MERRA-2 near-surface temperature and winds at 10 and 50 m (used to estimate 100 m wind across both Finland and Canada), and CERES all-sky surface solar irradiation (`ALLSKY_SFC_SW_DWN`). The app reports annual solar irradiation in kWh/m² per year. |
| [Open-Meteo Flood API](https://open-meteo.com/en/docs/flood-api) and [Elevation API](https://open-meteo.com/en/docs/elevation-api) | Copernicus GloFAS v4 modeled discharge and Copernicus DEM GLO-90 elevation support the point water indicators. |
| [OpenStreetMap Overpass API](https://overpass-api.de/) & SYKE Ranta10 | Local hydrography indexes (`finland-water.json`: 38,011 points; `canada-water.json`: 162,397 lakes and rivers) provide offline water-proximity fallback if live flood APIs are rate-limited. |
| [NASA Blue Marble](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/) | Globe textures and basemaps. The satellite basemaps use July 2004 imagery. |
| [Statistics Finland](https://stat.fi/en/services/statistical-data-services/geographic-data/statistical-areas/municipality-based-statistical-units), [Statistics Canada](https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0), and [Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) | Generalized administrative boundaries for the active maps of Finland and Canada. |

### Temperature trends and significance

The calculation uses monthly T2M values. A positive slope indicates warming over the selected record.

- **Finnish regional samples.** The Python pipeline fits ordinary least squares (OLS) with a linear time term and calendar-month fixed effects. It uses Newey–West heteroskedasticity- and autocorrelation-consistent (HAC) standard errors and applies the Benjamini–Hochberg correction across the Finnish regional tests. The interface uses the adjusted p-value for the 5% result when available. The displayed 95% confidence interval describes the individual historical slope.
- **Live points and Canadian regional samples.** The Node.js engine subtracts the average for each calendar month, then fits a linear OLS trend to the resulting temperature anomalies. It uses Newey–West HAC standard errors and reports a two-sided single-site p-value and a 95% confidence interval for the slope.

The app's **Temperature projection** is an illustrative scenario that extends the fitted historical trend and retains the seasonal cycle. The displayed confidence interval applies to the historical slope. The report also compares the trend model's mean absolute error with a seasonal baseline on later historical months held out from fitting. For the default period, the model fits 2005–2018 and evaluates 2019–2024. Gridded data can assign nearby locations to the same underlying grid cell.

### Site screening score (0–100)

For a complete report, the engine linearly scales each indicator between the fixed thresholds below, caps each result to 0–100, and sums the weighted category contributions. Thresholds and weights are heuristic. The cooling indicators use the temperature scenario, so changing the projection length can change the score.

| Category | Weight | Indicators and weights within the category | Fixed thresholds |
| --- | ---: | --- | --- |
| Climate and cooling | 25% | Cooling degree days above 10 °C (75%) and the warmest month's average daily high (25%). Lower is better. | 150–2,500 degree-days/year and 16–35 °C |
| Wind and solar | 60% | Annual solar irradiation (40%) and wind power density at 100 m (60%). Higher is better. | 700–1,800 kWh/m²/year and 100–600 W/m² |
| Water | 15% | Modeled water proximity (70%) and modeled river discharge (30%). Shorter distance and higher discharge are better. | 0.5–15 km and 0.5–50 m³/s |

Live water screening samples the selected point and 48 surrounding points. The site distance uses the nearest sample with a qualifying discharge or low elevation, while the discharge indicator uses the largest mean discharge among the samples. If live water APIs are unavailable, Finland and Canada fall back to their local hydrography indexes for proximity; if no water data are available, the point API marks the report as partial and the interface hides the total score.

The score supports initial site screening. Monthly temperatures offer an approximation of cooling conditions, and modeled water indicators require site-level verification. A construction decision also depends on grid capacity, network connectivity, land, flood risk, water availability, and permits.

## 4. Architecture and API

| Directory | Purpose |
| --- | --- |
| `app/` | Next.js App Router and React interface, with a Three.js globe, a Canvas 2D map, and Chart.js report charts. |
| `app/api/` | Node.js routes for bundled regional reports and point analysis. |
| `server/v6/` | Country adapters, coordinate checks, report catalog, point calculations, and bundled water/climate inputs. |
| `public/` | Map imagery, country boundaries, globe textures, and Finnish/Canadian source pages and downloads. |
| `pipeline/`, `tools/` | Python pipeline and data preparation tools. |
| `tests/`, `docs/` | Automated tests and integration notes. |

### GET `/api/regions/{id}`

Retrieves a bundled report. Example IDs include `fi_aland`, `fi_uusimaa`, `ca_on`, and `rauma`. HTTP **200** includes `mode`, `ranking`, `chart`, `meta`, and `partial`. An unknown ID returns **404**.

```bash
curl http://localhost:3000/api/regions/fi_aland
```

### POST `/api/point`

Calculates a report for numeric latitude and longitude in degrees. The `country` field accepts `fi` or `ca` and defaults to `fi`. The integer fields `startYear`, `endYear`, and `horizonYears` default to 2005, 2024, and 10. The historical period must cover at least three years within 1984–2024. The API accepts projection lengths of 1–30 years.

```http
POST /api/point
Content-Type: application/json

{
  "country": "fi",
  "lat": 60.1699,
  "lon": 24.9384,
  "startYear": 2005,
  "endYear": 2024,
  "horizonYears": 10
}
```

HTTP **200** includes `point_ranking`, `point_charts`, `meta`, and `partial`. Invalid parameters or coordinates outside the mapped land boundary return **400**. A calculation error or a failure of a required upstream provider returns **502**. In the interface, use **Retry** or select a reference marker with default dates to open a bundled report.

## 5. Build and verification

Run `npm test` for the automated test suite and `npm run build` for the production build. The scripts in `tests/browser/` require Playwright and Chrome or Chromium. See `docs/canada-map.md` for setup.
