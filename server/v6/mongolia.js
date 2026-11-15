import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sites from '../../public/mongolia/sites.json' with { type: 'json' };
import snapshots from './data/mongolia/power.json' with { type: 'json' };
import waterSnapshots from './data/mongolia/water.json' with { type: 'json' };
import { mongoliaSiteId } from '../../app/lib/countries.js';
import { collectRegions, findRegion } from '../../public/legacy/projection.js';
import { buildPointReport, fetchNasaPowerMonthly, fetchWaterPrecision } from './exact-point.js';

const waterCache = new Map();

let regions;
export async function coordinateInMongolia(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 41 || lat > 53 || lon < 87 || lon > 120) return false;
  regions ??= readFile(path.join(process.cwd(), 'public', 'mongolia', 'geometry.json'), 'utf8')
    .then(raw => collectRegions(JSON.parse(raw).regionData)).catch(error => {
      regions = undefined;
      throw error;
    });
  return Boolean(findRegion(await regions, lon, lat));
}

function mongoliaPoint({ parameters, elevationM, water, ...location }) {
  if (!Number.isFinite(elevationM)) throw new Error('NASA POWER grid elevation is unavailable.');
  const result = buildPointReport({
    ...location, params: parameters, requireComplete: true, water,
    terrain: { elevationM, slopeDeg: null, source: 'NASA POWER grid elevation, used for air density correction' },
  });
  result.meta.country = 'mn';
  result.meta.score_type = 'Mongolia climate, renewable energy, and water screening score';
  return result;
}

let reports;
function referenceReports() {
  if (reports) return reports;
  const entries = sites.map(site => {
    const snapshot = snapshots[site.code];
    const [lon, lat] = site.point;
    if (snapshot?.point[0] !== lon || snapshot.point[1] !== lat) {
      throw new Error(`Missing or mismatched Mongolia reference for ${site.code}`);
    }
    const raw = mongoliaPoint({ lat, lon, water: waterSnapshots[site.code], ...snapshot });
    return {
      mode: 'region', partial: false, count: sites.length, chart: raw.point_charts, hydro: null,
      region: { name: site.region, hub_city: site.name },
      meta: { ...raw.meta, ranked_sites: sites.length },
      ranking: { ...raw.point_ranking, site_id: mongoliaSiteId(site.code), region: site.region },
    };
  }).sort((a, b) => b.ranking.scores.overall - a.ranking.scores.overall || a.ranking.site_id.localeCompare(b.ranking.site_id));

  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    entry.ranking.rank = previous?.ranking.scores.overall === entry.ranking.scores.overall ? previous.ranking.rank : index + 1;
  });
  reports = new Map(entries.map(entry => [entry.ranking.site_id, { ...entry, leader: entries[0].ranking }]));
  return reports;
}

export function mongoliaRegionReport(id) {
  return referenceReports().get(id) ?? null;
}

export async function analyzeMongoliaPoint({ lat, lon, startYear, endYear, horizonYears, signal }) {
  const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cachedWater = waterCache.get(coordKey);
  const [data, water] = await Promise.all([
    fetchNasaPowerMonthly(lat, lon, signal, startYear, endYear),
    cachedWater ? Promise.resolve(cachedWater) : fetchWaterPrecision(lat, lon, signal),
  ]);
  if (!cachedWater && water.status === 'measured') {
    if (waterCache.size >= 200) {
      const firstKey = waterCache.keys().next().value;
      if (firstKey !== undefined) waterCache.delete(firstKey);
    }
    waterCache.set(coordKey, water);
  }
  return mongoliaPoint({ lat, lon, startYear, endYear, horizonYears, water, ...data });
}
