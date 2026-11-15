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

export function pointReport(raw, mode) {
  if (!raw?.point_ranking || !raw.point_charts) throw new Error('The point report is incomplete.');
  return {
    mode, partial: raw.partial === true, count: raw.total_ranked,
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

export async function getSiteReport(site, wind, signal) {
  const sample = CACHED_POINTS.find(point =>
    Math.abs(site.latitude - point.latitude) < .00005 && Math.abs(site.longitude - point.longitude) < .00005);
  return readResponse(await fetch(`/api/regions/${sample?.id ?? site.siteId}?wind=${wind}`, { signal }));
}

function postReport(endpoint, payload, signal) {
  return fetch(`/api/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal,
  }).then(readResponse);
}

export async function getExactReport(site, wind, signal) {
  const raw = await postReport('point', { lat: site.latitude, lon: site.longitude, wind }, signal);
  return pointReport(raw, 'point');
}

export function getAreaReport(site, radius, source, wind, signal) {
  return postReport('area', { lat: site.latitude, lon: site.longitude, radius, source, wind }, signal);
}

export const comparisonColors = ['#a3e7c8', '#ffc477', '#a4bfff'];
