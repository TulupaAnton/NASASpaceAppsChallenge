# Earth to Finland

A React and Next.js app for screening potential data center locations in Finland. The Earth flight opens on the night side, fades in city lights, then rotates and descends into a satellite map with national and regional borders. Select a point inside Finland or choose a reference site. On desktop, the country shifts left and a single analysis panel opens on the right. On smaller screens, the panel appears below the map.

## Run on localhost

Install Node.js 20.9 or newer, extract the ZIP, and open a terminal in the extracted `finland-data-center-siting` directory (the one containing `package.json`).

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). This mode uses bundled data and requires no Python or API keys. Internet access is needed for the initial `npm ci`.

## Run on a staging server

Use the production build for staging. From the project folder on the server, run:

```sh
npm ci
npm run build
npm start
```

On a hosting platform, use `npm run build` as the build command and `npm start` as the start command. The server uses port 3000 by default and accepts the platform’s `PORT` environment variable.

If you need hot reload through a staging proxy or network address, add the exact hostname or IP shown in the browser to `.env.local` beside `package.json`:

```dotenv
ALLOWED_DEV_ORIGINS=stage-finland.example.com
```

Use hostnames or IPs without a protocol, port, or path. Separate multiple addresses with commas. Restart the development server with `npm run dev -- --hostname 0.0.0.0` and refresh the page. This setting applies only to the Next.js development server.

## Explore a site

- The globe flight plays once. Use **Skip flight** to go directly to the highlighted country or **Replay flight** to watch again. With reduced motion enabled, the app opens on the map.
- Click or tap in Finland, or use **Choose a reference site**. On the focused map, the arrow keys move the cursor and Enter selects its point. Pinch the trackpad, scroll, or use the zoom buttons. Pinch with two fingers on touchscreen devices. Zoom follows the gesture position. Use **Fit Finland** to reset the view.
- The pin shows the selected coordinates. The **Regional sample** badge shows the coordinates supplying the bundled statistics for each of Finland’s 19 regions. The archived Rauma marker has its own archived point dataset with partial water data.
- The siting score shows how each weighted factor contributes to the total. The Compare view links to the highest-scoring regional benchmark. Open **Measurements and charts** for annual air temperatures and the monthly solar and wind profiles. Chart.js draws the contribution, historical, seasonal and comparison charts.
- Wind data use Global Wind Atlas. The data package includes detailed regional reports and CSV downloads. **Back to map** returns to the full satellite map.

The screening index uses climate and cooling (25%), renewable energy (60%), and water resources (15%). The score supports comparisons among regional reference sites. Map imagery, boundary credits, and source information are available in the app.

## Sites and comparisons

- Select a named marker or use **Choose a reference site** for bundled regional analysis. Click anywhere else inside Finland for live analysis at those coordinates. You can switch between the exact result and the regional reference using the link beneath the report.
- Pan, zoom, or choose another location while the analysis panel stays open.
- **Add to comparison** saves up to three locations. Compare shows differences from location A. Score gaps under two points are labeled **Essentially equal** when the reports share the same scoring basis. Open **Method & statistics** in the Site view for p-values, confidence intervals, weights and CSV exports.
- Exact-point analysis contacts upstream providers from the server. The engine uses the MERRA-2 wind estimate when Global Wind Atlas is unavailable. Bundled reference analysis runs offline after installing dependencies.

Use `GET /api/regions/[id]` for regional reports and `POST /api/point` with JSON fields `lat` and `lon` for exact points.

## Project layout

- `app/` contains the Next.js app, canvas map controller, and chart components.
- `public/flight/` contains the locally served globe animation and poster.
- `public/legacy/` contains the satellite imagery, geometry, source pages, detailed reports, and regional datasets.
- `server/v6/` contains the supplied point engine and bundled water-proximity data.
- `pipeline/` and `tools/` contain the supplied data processing code and data preparation script.

## Analysis data model

The display model is defined in [docs/site-analysis.ts](docs/site-analysis.ts). [docs/sample-site-analysis.json](docs/sample-site-analysis.json) is a normalized example from the bundled Kainuu report. The scoring engine and inputs remain unchanged.

The modeled water proximity is a scoring input. The distance to a mapped water sample describes a separate map layer. The model uses fixed scoring anchors and some factors can reach their maximum at several sites. A narrow score gap is a display cue for comparing the underlying inputs.
