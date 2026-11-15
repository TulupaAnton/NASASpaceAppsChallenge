export const CANADA_REGIONS = {
  'Newfoundland and Labrador': 'CA-NL', 'Prince Edward Island': 'CA-PE',
  'Nova Scotia': 'CA-NS', 'New Brunswick': 'CA-NB', Quebec: 'CA-QC', Ontario: 'CA-ON',
  Manitoba: 'CA-MB', Saskatchewan: 'CA-SK', Alberta: 'CA-AB',
  'British Columbia': 'CA-BC', Yukon: 'CA-YT', 'Northwest Territories': 'CA-NT', Nunavut: 'CA-NU',
};

// Geographic landmarks only; these markers do not imply an available analysis dataset.
export const CANADA_SITES = [
  ['Vancouver', 'British Columbia', -123.1207, 49.2827, true],
  ['Victoria', 'British Columbia', -123.3656, 48.4284, false],
  ['Calgary', 'Alberta', -114.0719, 51.0447, true],
  ['Edmonton', 'Alberta', -113.4909, 53.5461, false],
  ['Regina', 'Saskatchewan', -104.6189, 50.4452, false],
  ['Winnipeg', 'Manitoba', -97.1384, 49.8951, true],
  ['Toronto', 'Ontario', -79.3832, 43.6532, true],
  ['Ottawa', 'Ontario', -75.6972, 45.4215, false],
  ['Montreal', 'Quebec', -73.5674, 45.5019, true],
  ['Quebec City', 'Quebec', -71.2080, 46.8139, false],
  ['Fredericton', 'New Brunswick', -66.6431, 45.9636, false],
  ['Halifax', 'Nova Scotia', -63.5752, 44.6488, true],
  ['Charlottetown', 'Prince Edward Island', -63.1311, 46.2382, false],
  ["St. John's", 'Newfoundland and Labrador', -52.7126, 47.5615, false],
  ['Whitehorse', 'Yukon', -135.0568, 60.7212, true],
  ['Yellowknife', 'Northwest Territories', -114.3718, 62.4540, true],
  ['Iqaluit', 'Nunavut', -68.5170, 63.7467, true],
].map(([name, region, longitude, latitude, major], index) => ({
  name, region, point: [longitude, latitude], major, index,
  markerId: 'ca_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
}));

export const COUNTRIES = [
  {
    code: 'CA', name: 'Canada', image: '/countries/ca/satellite.webp',
    geometry: '/countries/ca/geometry.json', credits: '/countries/ca/sources.html',
    sources: '/countries/ca/sources.html', sites: CANADA_SITES,
    flightTarget: { longitude: -102, latitude: 56 },
  },
  {
    code: 'FI', name: 'Finland', image: '/legacy/assets/finland-satellite.webp',
    geometry: '/legacy/assets/finland-geometry.bin', credits: '/legacy/credits.html',
    sources: '/legacy/data-package.html',
    flightTarget: { longitude: 28.212890625, latitude: 68.291015625 },
  },
];

export function getCountry(code = 'FI') {
  const country = COUNTRIES.find(entry => entry.code === code);
  if (!country) throw new RangeError('Unknown country: ' + code);
  return country;
}

export function matchingCountries(query) {
  const prefix = query.trim().toLowerCase();
  return COUNTRIES.filter(country => country.name.toLowerCase().startsWith(prefix));
}

export function canadaSelection(point, region, site) {
  const [longitude, latitude] = point;
  return {
    countryCode: 'CA', countryName: 'Canada', longitude, latitude, point, region,
    regionName: region, regionCode: CANADA_REGIONS[region], name: site?.name,
    markerId: site?.markerId ?? null, referenceSiteId: null, index: site?.index,
  };
}
