export const CACHED_POINTS = Object.freeze([
  Object.freeze({
    id: 'rauma',
    name: 'Rauma-area site',
    latitude: 61.13,
    longitude: 21.51,
    partial: true,
  }),
]);

function coordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw new RangeError('Latitude must be between -90 and 90 degrees');
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new RangeError('Longitude must be between -180 and 180 degrees');
  }
  return { lat: latitude, lon: longitude };
}

function pointPayload({ latitude, longitude, siteId, region, country }) {
  return {
    ...coordinates(latitude, longitude),
    site_id: siteId,
    region,
    country,
  };
}

function optionsPayload({
  horizonYears = 10,
  useCache = true,
  includeBaseline = false,
}) {
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 30) {
    throw new RangeError('Scenario horizon must be between 1 and 30 years');
  }
  if (typeof useCache !== 'boolean' || typeof includeBaseline !== 'boolean') {
    throw new TypeError('useCache and includeBaseline must be booleans');
  }
  return {
    wind_source: 'gwa',
    horizon_years: horizonYears,
    use_cache: useCache,
    include_baseline: includeBaseline,
  };
}

async function jsonRequest(url, { body, signal } = {}) {
  const request = {
    signal,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    request.method = 'POST';
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(body);
  }
  const response = await fetch(url, request);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = typeof payload?.detail === 'string' ? ` · ${payload.detail}` : '';
    const error = new Error(`Climate data request failed (HTTP ${response.status})${detail}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Explicit opt-in. The static map does not discover or contact an API on its own. */
export function createPointApi({ baseUrl } = {}) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new TypeError('An explicit climate API base URL is required');
  }
  const base = new URL(baseUrl.trim(), globalThis.location?.href);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new TypeError('Use an HTTP(S) API base URL without embedded credentials, query, or fragment');
  }
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';

  return {
    getPoint(point, { signal } = {}) {
      return jsonRequest(new URL('point', base), {
        body: { ...pointPayload(point), ...optionsPayload(point) },
        signal,
      });
    },
  };
}

/** Load an archived sample only when the selected coordinate matches at its recorded precision. */
export async function loadCachedPoint(latitude, longitude, { signal } = {}) {
  coordinates(latitude, longitude);
  const sample = CACHED_POINTS.find(point =>
    Math.abs(latitude - point.latitude) < 0.00005 && Math.abs(longitude - point.longitude) < 0.00005,
  );
  if (!sample) return null;
  const url = `data/cached-points/${sample.id}-gwa.json`;
  return jsonRequest(url, { signal });
}
