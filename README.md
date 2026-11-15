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
- The pin shows the selected coordinates. The **Regional reference** label shows the coordinates supplying the bundled statistics for each of Finland’s 19 regions. The Rauma-area marker has its own archived point dataset with partial water data.
- The siting score shows the model’s weights and links to the highest-ranked region for comparison. The amCharts 5 temperature chart shows annual averages for the NASA POWER historical record (2005–2024) or the modeled scenario (2025–2034). The Chart.js resource chart highlights the strongest month for solar irradiation or wind speed at 100 m.
- Switch between Global Wind Atlas and NASA MERRA-2 in **Wind dataset**. The data package includes detailed regional reports and downloadable CSVs. **Back to map** returns to the full satellite map.

The screening index uses climate and cooling (25%), renewable energy (60%), and water resources (15%). The score supports comparisons among regional reference sites. Map imagery, boundary credits, and source information are available in the app.

## Sites, areas and comparisons

- **Site** shows the supplied v6 fixed-anchor screening model for the corresponding reference site, with charts and source downloads. **Analyze exact coordinates** runs the supplied v6 engine on the server and queries its live providers.
- **Area** uses a 50, 100, 150 or 200 km radius. Bundled view averages the reference sites inside the circle. Coverage can be sparse and the panel shows the locations used and the sample range. It applies no area-level suitability score.
- **Live NASA POWER** fetches monthly data for the center and up to four additional Finnish coordinates, spread around the center inside the circle. It averages available samples for 2005–2024. The measurements are air temperature, annual sunlight and wind at 50 m. Nearby coordinates can share a native NASA grid cell. This sample average does not provide continuous area coverage.
- **Compare** supports up to three locations. Add each location from the map or site menu, then choose a shared data source. Areas share the same radius. The table shows the basis for each result, and the charts use a common scale. Siting scores are shown side by side only when the inputs and weights match.
- Live point and area modes need the server to reach upstream data providers. Bundled references, rankings and area comparisons work locally after dependencies have been installed.

The endpoints are `GET /api/regions/[id]?wind=gwa`, `POST /api/point` with JSON fields `lat`, `lon`, `wind`, and `POST /api/area` with `lat`, `lon`, `radius` (km), `source` (`bundled` or `live`) and `wind` (`gwa` or `merra2`). Live NASA area wind comes from WS50M. The wind setting applies to bundled comparisons and exact points.

## Project layout

- `app/` contains the Next.js app, canvas map controller, and chart components.
- `public/flight/` contains the locally served globe animation and poster.
- `public/legacy/` contains the satellite imagery, geometry, source pages, detailed reports, and regional datasets.
- `server/v6/` contains the supplied point engine adapted to this project, the area calculation and bundled water-proximity data.
- `pipeline/` and `tools/` contain the supplied data processing code and data preparation script.
