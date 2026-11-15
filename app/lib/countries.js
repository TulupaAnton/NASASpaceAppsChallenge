import { project, unproject } from '../../public/legacy/projection.js';
import { projectCanada, unprojectCanada } from './canada-projection.js';
import { projectMongolia, unprojectMongolia } from './mongolia-projection.js';

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
  mn: {
    id: 'mn', name: 'Mongolia', project: projectMongolia, unproject: unprojectMongolia,
    satellite: '/mongolia/satellite.webp',
    sources: '/mongolia/sources.html', credits: '/mongolia/sources.html',
    approachTarget: { longitude: 103.5, latitude: 46.8 },
  },
};

export const canadaSiteId = code => `ca_${code.toLowerCase()}`;
export const mongoliaSiteId = code => `mn_${code.toLowerCase()}`;
