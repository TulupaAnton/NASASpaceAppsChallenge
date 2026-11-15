const DEFAULT_WIND_SOURCE = 'gwa';

export const CACHED_POINTS = Object.freeze([
  Object.freeze({
    id: 'rauma',
    name: 'Rauma-area site',
    latitude: 61.13,
    longitude: 21.51,
    partial: true,
  }),
]);

function resolveWindSource(windSource = DEFAULT_WIND_SOURCE) {
  if (windSource !== 'gwa' && windSource !== 'merra2') {
    throw new TypeError('Wind source must be gwa or merra2');
  }
  return windSource;
}

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
  windSource = DEFAULT_WIND_SOURCE,
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
    wind_source: resolveWindSource(windSource),
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
    getHealth({ signal } = {}) {
      return jsonRequest(new URL('health', base), { signal });
    },
    getRegions(windSource, { signal } = {}) {
      const url = new URL('regions', base);
      url.searchParams.set('wind_source', resolveWindSource(windSource));
      return jsonRequest(url, { signal });
    },
    getPoint(point, { signal } = {}) {
      return jsonRequest(new URL('point', base), {
        body: { ...pointPayload(point), ...optionsPayload(point) },
        signal,
      });
    },
    getPoints({ points, ...options }, { signal } = {}) {
      if (!Array.isArray(points) || points.length === 0) {
        throw new TypeError('Supply at least one point');
      }
      return jsonRequest(new URL('points', base), {
        body: { points: points.map(pointPayload), ...optionsPayload(options) },
        signal,
      });
    },
    analyze(payload, { signal } = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('Supply a site ranking payload');
      }
      return jsonRequest(new URL('analyze', base), { body: payload, signal });
    },
  };
}

/** Load an archived sample only when the selected coordinate matches at its recorded precision. */
export async function loadCachedPoint(latitude, longitude, windSource, { signal, base = 'data/' } = {}) {
  coordinates(latitude, longitude);
  const source = resolveWindSource(windSource);
  const sample = CACHED_POINTS.find(point =>
    Math.abs(latitude - point.latitude) < 0.00005 && Math.abs(longitude - point.longitude) < 0.00005,
  );
  if (!sample) return null;
  const url = `${base}cached-points/${sample.id}-${source}.json`;
  return jsonRequest(url, { signal });
}
