import { readFile } from 'node:fs/promises';
import path from 'node:path';
import gwa from '../../public/legacy/data/gwa.json' with { type: 'json' };
import metadata from '../../public/legacy/data/metadata.json' with { type: 'json' };
import hydro from './data/hydro/region-proximity.json' with { type: 'json' };
import special from './data/hydro/special-proximity.json' with { type: 'json' };
import { canadaRegionReport } from './canada.js';
import { mongoliaRegionReport } from './mongolia.js';

const { regions } = metadata;
const files = new Map();
const dataRoot = path.join(process.cwd(), 'public', 'legacy', 'data');

async function readDataset(file) {
  if (!files.has(file)) {
    const task = readFile(path.join(dataRoot, file), 'utf8').then(JSON.parse).catch(error => {
      files.delete(file);
      throw error;
    });
    files.set(file, task);
  }
  return files.get(file);
}

export async function regionReport(id) {
  if (id.startsWith('ca_')) return canadaRegionReport(id);
  if (id.startsWith('mn_')) return mongoliaRegionReport(id);
  if (id === 'rauma') {
    const raw = await readDataset('cached-points/rauma-gwa.json');
    return {
      mode: 'archive', partial: raw.partial, meta: raw.meta, count: raw.total_ranked,
      ranking: raw.point_ranking, chart: raw.point_charts,
      hydro: raw.point_hydro ?? special.rauma ?? null,
    };
  }

  if (!Object.hasOwn(regions, id)) return null;
  const { meta, ranking } = gwa;
  const row = ranking.find(entry => entry.site_id === id);
  if (!row) return null;
  const series = await readDataset(`charts/${id}.json`);
  return {
    mode: 'region', partial: false, chart: series.chart, meta, count: meta.ranked_sites,
    ranking: { ...row, validation: { ...row.validation, heldout_monthly: series.heldout } },
    region: regions[id], leader: ranking.find(entry => entry.rank === 1),
    hydro: hydro.regions[id] ?? null,
  };
}
