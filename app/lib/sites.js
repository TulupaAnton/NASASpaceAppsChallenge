import { finlandRegionId } from '../../public/legacy/finland-data.js';
import { CACHED_POINTS } from '../../public/legacy/point-api.js';
import { referenceSites } from '../../public/legacy/reference-sites.js';
import canadaReferences from '../../public/canada/sites.json' with { type: 'json' };
import { canadaSiteId, countries } from './countries.js';
import { coordinates } from './format.js';

const finlandReferences = [
  ...referenceSites,
  { name: 'Inari', region: 'Lappi', point: [27.0288, 68.9050] },
  ...CACHED_POINTS.map(point => ({
    name: point.name, region: 'Satakunta', point: [point.longitude, point.latitude],
  })),
];

const canadaSites = canadaReferences.map(site => ({ ...site, major: true, siteId: canadaSiteId(site.code) }));
const finlandSites = finlandReferences.map(site => ({ ...site, siteId: site.siteId ?? finlandRegionId(site.region) }));
export const countrySites = Object.fromEntries(Object.entries({ fi: finlandSites, ca: canadaSites }).map(([id, references]) => [
  id, references.map((site, index) => ({ ...site, index, xy: countries[id].project(...site.point) })),
]));

export function selection(point, region, site, country = 'fi') {
  const [longitude, latitude] = point;
  return {
    point, longitude, latitude, region, country, name: site?.name, index: site?.index,
    siteId: site?.siteId ?? countrySites[country].find(reference => reference.region === region)?.siteId,
    xy: site?.xy ?? countries[country].project(...point),
  };
}

function pointReport(raw) {
  if (!raw?.point_ranking || !raw.point_charts) throw new Error('The point report is incomplete.');
  return {
    mode: 'point', partial: raw.partial === true, count: raw.total_ranked,
    ranking: raw.point_ranking, chart: raw.point_charts, hydro: raw.point_hydro, meta: raw.frontend?.meta ?? raw.meta,
  };
}

async function readResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? 'Data could not be loaded.');
  return payload;
}

export function selectionKey(site) {
  return `${site.country ?? 'fi'}:${site.latitude.toFixed(5)},${site.longitude.toFixed(5)}`;
}

export function siteLabel(site) {
  return site.name ?? `Point ${coordinates(site.latitude, site.longitude, 2)}`;
}

export const DEFAULT_TIME_RANGE = { startYear: 2005, endYear: 2024, horizonYears: 10 };

export function isDefaultTimeRange(range = DEFAULT_TIME_RANGE) {
  return range.startYear === DEFAULT_TIME_RANGE.startYear &&
    range.endYear === DEFAULT_TIME_RANGE.endYear &&
    range.horizonYears === DEFAULT_TIME_RANGE.horizonYears;
}

export function timeRangeKey(range = DEFAULT_TIME_RANGE) {
  return `${range.startYear}-${range.endYear}:${range.horizonYears}`;
}

export async function getSiteReport(site, signal) {
  const sample = (!site.country || site.country === 'fi') && CACHED_POINTS.find(point =>
    Math.abs(site.latitude - point.latitude) < .00005 && Math.abs(site.longitude - point.longitude) < .00005);
  return readResponse(await fetch(`/api/regions/${sample?.id ?? site.siteId}`, { signal }));
}

export async function getExactReport(site, signal, timeRange = DEFAULT_TIME_RANGE) {
  const response = await fetch('/api/point', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: site.latitude,
      lon: site.longitude,
      country: site.country,
      startYear: timeRange.startYear,
      endYear: timeRange.endYear,
      horizonYears: timeRange.horizonYears,
    }),
    signal,
  });
  return pointReport(await readResponse(response));
}

export function getAnalysisReport(site, exact, signal, timeRange = DEFAULT_TIME_RANGE) {
  return exact || !isDefaultTimeRange(timeRange)
    ? getExactReport(site, signal, timeRange)
    : getSiteReport(site, signal);
}

export const comparisonColors = ['#a3e7c8', '#ffc477', '#a4bfff'];
