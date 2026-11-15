import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeFinlandGeometry } from '../../public/legacy/finland-geometry.js';
import { collectRegions, findRegion } from '../../public/legacy/projection.js';

let polygons;
export function finlandRegions() {
  polygons ??= readFile(path.join(process.cwd(), 'public', 'legacy', 'assets', 'finland-geometry.bin'))
    .then(bytes => collectRegions(decodeFinlandGeometry(bytes).regionData)).catch(error => {
      polygons = undefined;
      throw error;
    });
  return polygons;
}

export function containsFinland(geometry, lat, lon) {
  return Boolean(findRegion(geometry, lon, lat));
}

export async function coordinateInFinland(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 59 || lat > 71 || lon < 18 || lon > 33) return false;
  return containsFinland(await finlandRegions(), lat, lon);
}
