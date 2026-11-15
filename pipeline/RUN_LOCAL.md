# Run the supplied Finland pipeline locally

Use Python 3.10 or newer. Install the supplied dependencies with
`python -m pip install -r requirements-api.txt`, then start the API with
`python -m uvicorn api:app --host 127.0.0.1 --port 8000` from this directory.

`GET /regions?wind_source=gwa` and `GET /regions?wind_source=merra2` serve the
regenerated regional datasets included in this package. An exact `POST /point`
can contact external data sources and update the point cache. Both the legacy
test fixture and old incomplete point caches are excluded from this local server
bundle. The original archive preserves them.

For browser integration, the Next.js site's `NEXT_PUBLIC_FINLAND_POINT_API`
environment variable adds the exact-coordinate action. Set it to the local API
base URL and restart or rebuild Next.js. Serve the
frontend and API over compatible origins and protocols, and verify the API
supports requests from the frontend origin. The public-facing site uses
regional, precomputed data by default. Its optional exact-point action is only
shown when an API base is configured. Treat model fallback values as estimates.
