import { project, unproject } from '../../public/legacy/projection.js';
import { projectCanada, unprojectCanada } from './canada-projection.js';

export const countries = {
  fi: {
    id: 'fi', name: 'Finland', project, unproject,
    satellite: '/legacy/assets/finland-satellite.webp',
    geometry: '/legacy/assets/finland-geometry.bin',
    sources: '/legacy/data-package.html', credits: '/legacy/credits.html',
  },
  ca: {
    id: 'ca', name: 'Canada', project: projectCanada, unproject: unprojectCanada,
    satellite: '/canada/satellite.webp',
    geometry: '/canada/geometry.json', projection: { type: 'canada' },
    sources: '/canada/sources.html', credits: '/canada/sources.html#map-credits',
    // Center the cloud approach over central Canada; the map uses a conic projection.
    approachTarget: { longitude: -102, latitude: 56 },
  },
};

export const canadaSiteId = code => `ca_${code.toLowerCase()}`;

export function getCountry(id = 'fi') {
  const country = countries[id.toLowerCase()];
  if (!country) throw new RangeError('Unknown country: ' + id);
  return country;
}
