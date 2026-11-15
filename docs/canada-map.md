# Canada map and analysis handoff

Canada is implemented through the country-map stage. The approved Earth opening,
ivory country picker, cloud approach/exit and full-screen-to-fitted map reveal
are shared with Finland. Selecting Canada targets the existing cloud texture
over central Canada. Finland retains its existing analysis path.

## Country assets

Canadian paths, clipping, borders and regional highlights are prepared in a
dedicated worker (`app/lib/map-worker.js`) using `OffscreenCanvas`. Layers are
fully rasterized to transferable `ImageBitmap`s before returning to the UI.
Both countries preload during the opening. Departure waits for the selected
map's first actual canvas paint, including when preloading is still pending or
the browser needs the main-thread fallback. This prevents cold preparation from
interrupting the flight. Artwork construction is shared in `map-artwork.js` so
the worker and fallback use identical drawing styles and projection parameters.

- `app/lib/countries.js`: country configuration, search and Canadian city landmarks.
- `public/countries/ca/geometry.json`: 13 provinces/territories, national outline
  and the projection parameters.
- `public/countries/ca/satellite.webp`: 4096 × 2560 NASA Blue Marble raster.
- `public/countries/ca/sources.json` and `sources.html`: provenance and credits.
- `app/lib/map-projections.js`: shared image/boundary/interaction transform.

The Canadian map uses a spherical Lambert conformal conic projection with
standard parallels at 49° and 77° N. The raster is reprojected with exactly the
same parameters as the boundary paths and coordinate hit testing. The geometry
is simplified for display; islands smaller than 2 km² are omitted. Geography is
not a live-weather or analysis dataset.

## Connect analysis

A Canadian point selection places a pin and highlights its province/territory
without opening Finland's analysis panel or requesting Finland's endpoints.
The component accepts `onLocationSelected(location)` for a parent integration.
It also dispatches `datax:location-selected` on `window` with `event.detail`:

```js
{
  countryCode: 'CA',
  countryName: 'Canada',
  longitude: -114.0719,
  latitude: 51.0447,
  point: [-114.0719, 51.0447],
  region: 'Alberta',
  regionName: 'Alberta',
  regionCode: 'CA-AB',
  name: 'Calgary',             // undefined for an arbitrary map point
  markerId: 'ca_calgary',      // null for an arbitrary map point
  referenceSiteId: null,      // no Canadian analysis dataset is implied
  index: 2,                   // optional local landmark index
  xy: [490.88, 720.14]        // projected map coordinates; not geographic input
}
```

Use `countryCode`, longitude, latitude and `regionCode` for the next feature.
The landmark index is only a UI identifier; it must not be used as a Finnish
reference-site ID. The backend and Canadian analysis panel remain separate work.

## Regenerate assets

No additional dependencies are needed to run the website. For asset preparation
only, install `numpy`, `pillow`, `pyproj` and `shapely` in a Python virtual environment.
Download the NASA raster and Statistics Canada GeoJSON using the URLs recorded
in `public/countries/ca/sources.json`, then run:

```sh
python tools/build_canada_map.py --geometry /path/to/provinces.geojson --image /path/to/world.jpg
```

The generator writes the raster, simplified boundaries and source manifest.
No access token is needed at runtime; all map assets are served locally.

## Flight regression check

`npm test` covers projection, geographic picking and the original Earth/cloud
timing. The optional `tests/browser/country-flight.mjs` check requires Playwright
and Chrome. Set `PLAYWRIGHT_MODULE` to an installed Playwright module if it is not
available as a local dependency, then run:

```sh
node tests/browser/country-flight.mjs
SLOW_MAP=1 node tests/browser/country-flight.mjs
```

It checks that first paint precedes departure, Canadian layers arrive from the
worker as bitmaps, and active flight has no map-preparation tasks over 100 ms.
It also selects Calgary and replays into Finland. WebGL draw calls are suppressed
only in the test to separate map stalls from headless software rendering; the
real camera clock, worker and Canvas2D map still run. It takes no screenshots and
makes no visual assertions.
