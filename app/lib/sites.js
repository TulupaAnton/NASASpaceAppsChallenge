import { finlandRegionId } from '../../public/legacy/finland-data';
import { CACHED_POINTS } from '../../public/legacy/point-api';
import { project } from '../../public/legacy/projection';
import { referenceSites } from '../../public/legacy/reference-sites';

export const sites = [
  ...referenceSites,
  { name: 'Inari', region: 'Lappi', point: [27.0288, 68.9050] },
  ...CACHED_POINTS.map(point => ({
    name: point.name, region: 'Satakunta', point: [point.longitude, point.latitude],
  })),
].map((site, index) => ({
  ...site, index, xy: project(...site.point), siteId: site.siteId ?? finlandRegionId(site.region),
}));

export const siteOptions = [...sites].sort((a, b) => a.name.localeCompare(b.name));

export function selection(point, region, site) {
  const [longitude, latitude] = point;
  return {
    point, longitude, latitude, region, name: site?.name, index: site?.index,
    siteId: site?.siteId ?? finlandRegionId(region), xy: site?.xy ?? project(...point),
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
  return `${site.latitude.toFixed(5)},${site.longitude.toFixed(5)}`;
}

export function siteLabel(site) {
  return site.name ?? `Point ${site.latitude.toFixed(2)}° N, ${site.longitude.toFixed(2)}° E`;
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
  const sample = CACHED_POINTS.find(point =>
    Math.abs(site.latitude - point.latitude) < .00005 && Math.abs(site.longitude - point.longitude) < .00005);
  return readResponse(await fetch(`/api/regions/${sample?.id ?? site.siteId}`, { signal }));
}

export async function getExactReport(site, signal, timeRange = DEFAULT_TIME_RANGE) {
  const response = await fetch('/api/point', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: site.latitude,
      lon: site.longitude,
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
