# Multi-country map and analysis integration

The local Earth/cloud opening is combined with the remote branch through
`332d71c`, retaining Canada analysis and GloFAS water indicators. The local
checkpoint before merging is `820bd17`; it is also retained at
`checkpoint/pre-cloud-sync-820bd17`.

## Active country configuration

`app/lib/countries.js` exposes the shared `countries` configuration with IDs
`fi` and `ca`. Frontend selections and API requests use these lowercase IDs.
The root's `data-country` diagnostic attribute uses uppercase. `getCountry`
accepts either case and normalizes before caching preparation jobs.

- Finland retains its photographic perspective transform and legacy assets.
- Canada uses the remote spherical Lambert projection, `/canada` geometry,
  satellite raster and 13 reference locations.

The raster, paths, marker coordinates, inverse projection and backend land
checks use the same country assets. The earlier Statistics Canada experiment
under `/countries/ca` and its build tool remain as archived source material;
these assets are not loaded by the active country picker.

## Preserved opening and preparation

Non-Finnish map artwork is prepared in `app/lib/map-worker.js`, which uses
`OffscreenCanvas` and transfers fully rasterized `ImageBitmap`s to the view.
Only the two supported country maps preload early. On selection, departure waits for the
selected map's actual first Canvas2D paint before starting the camera.
The same gate applies if worker preparation falls back to the main thread.
This retains the fix for the cold-map freeze during flight.

Earth appearance, fixed sunlight, 24 cloud shells, approved timing and the
full-screen-to-fitted map reveal are unchanged. The rolled-back LOD, frame cap,
atlas removal and lazy-highlight optimization are not included. Canada's
approach retains the previously tested existing cloud texel at 102° W, 56° N.

The remote header country switcher and map transition are retained. Switching
clears the analyzed site and comparison list, and binds the new country's
reference markers and analysis panel. Replay restores the opening flow.

## Analysis

`countrySites` and `selection` in `app/lib/sites.js` provide reference IDs and
country identity to map picks and reference markers. The panel reads the
remote `server/v6/canada.js` reports via the regional API alongside Finland's catalog.
Exact-coordinate requests include `country`, historical years and horizon.
Bundled reference water inputs and live water-provider hooks come from the
remote GloFAS update. The complete model uses 25% climate/cooling, 60% renewable
energy and 15% water; incomplete inputs retain the engine's partial-result rules.

`onLocationSelected(location)` and `datax:location-selected` remain available.
The detail contains `country` (`fi`/`ca`), longitude, latitude, region,
optional reference index/name and `siteId`. A reference ID belongs to its country;
it must not be reused as a Finnish identifier.

## Verification

- `npm test` checks all 13 Canadian references, water-aware
  scores, live-provider adapters, map preparation/picking, original Finland
  calculations and Earth/cloud timing.
- `tests/browser/country-flight.mjs` requires Playwright and Chrome. Set
  `PLAYWRIGHT_MODULE` to an installed Playwright module if needed. It checks the
  first-paint gate, optional delayed loading (`SLOW_MAP=1`), Canadian analysis,
  switching to Finland, water report APIs and Replay.
- `tests/browser/switch-picking.mjs` performs arbitrary pointer picks through
  Finland → Canada → Finland with the switch animation enabled.
  It derives screen targets from actual Canvas2D drawing and checks the emitted
  geographic coordinates. Exact-point provider requests are mocked in this
  interaction test so provider quotas cannot mask a picking regression.
- The browser test suppresses native WebGL draws to isolate map stalls from
  headless SwiftShader cost. Shader compilation, camera clocks and Canvas2D
  drawing still run. It takes no screenshots or visual assertions.
