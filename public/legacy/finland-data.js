const boundaryRegionIds = {
  ahvenanmaa: 'fi_aland',
  aland: 'fi_aland',
  'aland islands': 'fi_aland',
  'etela-karjala': 'fi_south_karelia',
  'etela-pohjanmaa': 'fi_south_ostrobothnia',
  'etela-savo': 'fi_south_savo',
  kainuu: 'fi_kainuu',
  'kanta-hame': 'fi_kanta_hame',
  'keski-pohjanmaa': 'fi_central_ostrobothnia',
  'keski-suomi': 'fi_central_finland',
  kymenlaakso: 'fi_kymenlaakso',
  lappi: 'fi_lapland',
  lapland: 'fi_lapland',
  'paijat-hame': 'fi_paijat_hame',
  pirkanmaa: 'fi_pirkanmaa',
  pohjanmaa: 'fi_ostrobothnia',
  'pohjois-karjala': 'fi_north_karelia',
  'pohjois-pohjanmaa': 'fi_north_ostrobothnia',
  'pohjois-savo': 'fi_north_savo',
  satakunta: 'fi_satakunta',
  uusimaa: 'fi_uusimaa',
  'varsinais-suomi': 'fi_varsinais_suomi',
};
const ids = new Set(Object.values(boundaryRegionIds));
const requests = new Map();

function dataUrl(path, base = 'data/') {
  return `${base}${path}`;
}

function request(path, format = 'json', base) {
  const url = dataUrl(path, base);
  let promise = requests.get(url);
  if (!promise) {
    promise = fetch(url).then(response => {
      if (!response.ok) throw new Error(`Finland data unavailable (HTTP ${response.status})`);
      return response[format]();
    }).catch(error => {
      requests.delete(url);
      throw error;
    });
    requests.set(url, promise);
  }
  return promise;
}

function checkedWindSource(windSource) {
  if (windSource !== 'gwa' && windSource !== 'merra2') {
    throw new RangeError('Unknown Finland wind data source');
  }
  return windSource;
}

function checkedSiteId(siteId) {
  if (!ids.has(siteId)) throw new RangeError('Unknown Finland region');
  return siteId;
}

export function finlandRegionId(name) {
  if (ids.has(name)) return name;
  if (typeof name !== 'string') return null;
  const key = name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return Object.hasOwn(boundaryRegionIds, key) ? boundaryRegionIds[key] : null;
}

export async function loadFinlandCatalog(windSource = 'gwa', base) {
  const wind = checkedWindSource(windSource);
  const [summary, metadata] = await Promise.all([request(`${wind}.json`, 'json', base), request('metadata.json', 'json', base)]);
  return { ...summary, ...metadata, windSource: wind };
}

export async function loadFinlandRegion(siteId, windSource = 'gwa', base) {
  const id = checkedSiteId(siteId);
  const [catalog, series] = await Promise.all([
    loadFinlandCatalog(windSource, base),
    request(`charts/${id}.json`, 'json', base),
  ]);
  const { meta, regions, legacySuitability, ranking } = catalog;
  const regionalRanking = ranking.find(item => item.site_id === id);
  if (!regionalRanking || !regions[id]) throw new Error('Ranking for Finland region is unavailable');
  const chart = windSource === 'merra2' ? {
    ...series.chart,
    monthly_climatology: series.chart.monthly_climatology.map((row, index) => ({
      ...row,
      wind_speed_100m_ms: series.merra2WindClimatology[index],
    })),
  } : series.chart;
  return {
    flavor: 'regional',
    windSource,
    meta,
    ranking: {
      ...regionalRanking,
      validation: { ...regionalRanking.validation, heldout_monthly: series.heldout },
    },
    chart,
    region: regions[id],
    legacySuitability: legacySuitability.regions[id],
  };
}

function historyPath(siteId, period) {
  const region = checkedSiteId(siteId).slice(3);
  if (period !== 'annual' && period !== 'monthly') throw new RangeError('Unknown Finland history interval');
  return `history/${region}_${period}.csv`;
}

export function finlandHistoryCsvUrl(siteId, period) {
  return dataUrl(historyPath(siteId, period));
}

// These per-region CSVs contain ISO dates and numeric values, with no quoted fields.
function parseHistory(csv) {
  const [header, ...rows] = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const fields = header.split(',');
  return rows.map(row => {
    const values = row.split(',');
    if (values.length !== fields.length) throw new Error('Invalid Finland history row');
    return Object.fromEntries(fields.map((field, index) => {
      const text = values[index];
      return [field, field === 'date' ? text : text === '' ? null : Number(text)];
    }));
  });
}

export async function loadFinlandHistory(siteId) {
  const [annual, monthly] = await Promise.all(['annual', 'monthly'].map(async period => {
    const csv = await request(historyPath(siteId, period), 'text');
    return parseHistory(csv);
  }));
  return { annual, monthly };
}

export const FINLAND_DATA_DOWNLOADS = Object.freeze({
  annual: dataUrl('history/finland_all_regions_annual.csv'),
  monthly: dataUrl('history/finland_all_regions_monthly.csv'),
  legacyCsv: dataUrl('history/finland_datacenter_suitability.csv'),
  legacyReport: dataUrl('history/finland_datacenter_report.md'),
});
