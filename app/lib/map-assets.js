import { loadFinlandGeometry } from '../../public/legacy/finland-geometry';
import { collectRegions, findRegion } from '../../public/legacy/projection';
import { getCountry, canadaSelection } from './countries.js';
import { createMapProjection } from './map-projections.js';
import { sites as finlandSites, selection } from './sites';
import { prepareMapArtwork } from './map-artwork.js';

const pending = new Map();

function regionLookup(regionData) {
  const cells = new Map();
  const cellIndex = value => Math.floor(value * 2);
  for (const region of collectRegions(regionData)) {
    for (const polygon of region.polygons) {
      const [west, south, east, north] = polygon.bounds.map(cellIndex);
      for (let x = west; x <= east; x++) {
        for (let y = south; y <= north; y++) {
          const key = x * 512 + y;
          let cell = cells.get(key);
          if (!cell) cells.set(key, cell = []);
          if (cell.at(-1)?.name !== region.name) cell.push({ name: region.name, polygons: [] });
          cell.at(-1).polygons.push(polygon);
        }
      }
    }
  }
  return (longitude, latitude) => {
    const cell = cells.get(cellIndex(longitude) * 512 + cellIndex(latitude));
    return cell ? findRegion(cell, longitude, latitude) : null;
  };
}

function mapAssets(image, geometry, config, artwork) {
  const projection = createMapProjection(geometry.projection);
  const { project } = projection;
  const sites = (config.sites ?? finlandSites).map(site => ({ ...site, xy: project(...site.point) }));
  const select = config.code === 'CA' ? (point, region, site) => ({ ...canadaSelection(point, region, site), xy: project(...point) })
    : (...args) => ({ ...selection(...args), countryCode: 'FI', countryName: 'Finland' });
  return { image, ...artwork, projection, sites, select,
    countryCode: config.code, regionAt: regionLookup(geometry.regionData) };
}

function loadWorkerMap(countryCode) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./map-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) { reject(new Error(data.error)); return; }
      try {
        const { image, geometry, highlights, ...artwork } = data;
        resolve(mapAssets(image, geometry, getCountry(countryCode), { ...artwork, highlight: name => highlights.get(name) }));
      } catch (error) { reject(error); }
    };
    worker.onerror = event => {
      event.preventDefault();
      worker.terminate();
      reject(new Error('Unable to prepare country map in the background'));
    };
    worker.postMessage(countryCode);
  });
}

function loadCanvasMap(countryCode) {
  const country = getCountry(countryCode);
  const image = new Image();
  image.src = country.image;
  const geometry = countryCode === 'FI' ? loadFinlandGeometry(country.geometry)
    : fetch(country.geometry).then(response => {
      if (!response.ok) throw new Error('Unable to load country boundaries');
      return response.json();
    });
  return Promise.all([image.decode(), geometry])
    .then(([, geometry]) => mapAssets(image, geometry, country, prepareMapArtwork(image, geometry)));
}

export function loadMap(countryCode = 'FI') {
  if (!pending.has(countryCode)) {
    const background = countryCode === 'CA' && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    pending.set(countryCode, (background ? loadWorkerMap(countryCode).catch(() => loadCanvasMap(countryCode)) : loadCanvasMap(countryCode))
      .catch(error => {
        pending.delete(countryCode);
        throw error;
      }));
  }
  return pending.get(countryCode);
}
