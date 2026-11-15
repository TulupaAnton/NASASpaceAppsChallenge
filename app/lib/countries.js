import { project, unproject } from '../../public/legacy/projection.js';
import { projectCanada, unprojectCanada } from './canada-projection.js';

export const countries = {
  fi: {
    id: 'fi', name: 'Finland', project, unproject,
    satellite: '/legacy/assets/finland-satellite.webp',
    sources: '/legacy/data-package.html', credits: '/legacy/credits.html',
  },
  ca: {
    id: 'ca', name: 'Canada', project: projectCanada, unproject: unprojectCanada,
    satellite: '/canada/satellite.webp',
    sources: '/canada/sources.html', credits: '/canada/sources.html#map-credits',
    // Center the cloud approach over central Canada; the map uses a conic projection.
    approachTarget: { longitude: -96, latitude: 61 },
  },
};

export const canadaSiteId = code => `ca_${code.toLowerCase()}`;
