import { unknown, valueText } from './analysis-format.js';

export const factorDefinitions = [
  { key: 'climate', label: 'Outdoor cooling climate', tone: 'mint', explanation: 'Cooler outdoor conditions can reduce mechanical cooling demand.' },
  { key: 'renewables', label: 'Wind and solar', tone: 'amber', explanation: 'Estimates renewable energy potential near the location.' },
  { key: 'water', label: 'Water indicators', tone: 'water', explanation: 'Uses modeled water proximity and river flow to inform cooling assessment.' },
];

export const metricDefinitions = [
  { key: 'mean_air_temperature', label: 'Average air temperature', field: 'historical_mean_temp_c', unit: '°C' },
  { key: 'annual_solar', label: 'Annual sunlight', field: 'solar_ghi_kwh_m2_year', unit: 'kWh/m²/yr' },
  { key: 'wind_100m', label: 'Wind at 100 m', field: 'wind_speed_100m_ms', unit: 'm/s' },
  { key: 'scoring_water_proximity', label: 'Modeled water proximity', field: 'water_distance_km', unit: 'km' },
];

const numeric = value => Number.isFinite(value) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;

function measurementText(key, value, unit) {
  if (key === 'scoring_water_proximity') {
    if (value === 0) return 'Flagged at the modeled point';
    if (value === 20) return 'Beyond the 12 km survey';
  }
  return valueText(value, unit);
}

/** @returns {import('../../docs/site-analysis').LocationAnalysis} */
export function normalizeAnalysis(report, site) {
  const { ranking: row, meta } = report;
  const weights = row.insight?.effective_weights ?? meta?.weights;
  const rank = report.count > 1 ? numeric(row.rank) : null;
  const trend = row.trend ?? {};
  const adjusted = Number.isFinite(trend.p_value_fdr_bh) && typeof trend.significant_fdr05 === 'boolean';
  const metrics = metricDefinitions.map(({ key, field, unit }) => {
    const value = numeric(row.measurements?.[field]);
    return { key, value, unit, displayValue: measurementText(key, value, unit) };
  });
  const mapped = numeric(report.hydro?.nearest_surface_sample_km);
  metrics.push({
    key: 'mapped_water_sample', value: mapped, unit: 'km',
    displayValue: mapped === null ? unknown : valueText(mapped, 'km') + ' to a mapped ' + (report.hydro.nearest_surface_type ?? 'water') + ' sample',
  });

  return {
    id: row.site_id,
    name: site?.name ?? report.region?.hub_city ?? row.region,
    region: (report.region?.name ?? site?.region ?? row.region)?.split(' (')[0] ?? unknown,
    coordinatesSource: report.mode === 'region' ? 'regional_reference' : 'exact',
    coordinates: { latitude: row.lat, longitude: row.lon },
    score: {
      total: report.partial ? null : numeric(row.scores?.overall),
      rank,
      ofTotal: rank === null ? null : report.count,
      factors: factorDefinitions.map(({ key, label }) => {
        const score = numeric(row.scores?.[key]);
        const weight = numeric(weights?.[key]);
        const contribution = numeric(row.score_contributions?.[key]) ??
          (score !== null && weight !== null ? score * weight : null);
        return { key, label, score, weight, contribution };
      }),
    },
    metrics,
    trend: {
      slopePerDecade: numeric(trend.slope_c_per_decade),
      slope95CI: trend.slope_95ci_c_per_decade?.length === 2 &&
        trend.slope_95ci_c_per_decade.every(Number.isFinite) ? trend.slope_95ci_c_per_decade : null,
      isSignificant: boolean(adjusted ? trend.significant_fdr05 : trend.significant_p05),
      significanceBasis: adjusted ? 'fdr' : typeof trend.significant_p05 === 'boolean' ? 'unadjusted' : null,
      pValue: numeric(trend.p_value),
      pAdjusted: numeric(trend.p_value_fdr_bh),
    },
  };
}

export function sourceLabel(report) {
  return { region: 'Regional sample', point: 'Exact point', archive: 'Archived point' }[report?.mode] ?? 'Data unavailable';
}

export function comparableScores(a, b) {
  if (!a || !b || a.partial || b.partial || !Number.isFinite(a.ranking.scores?.overall) ||
    !Number.isFinite(b.ranking.scores?.overall)) return false;
  const signature = ({ ranking, meta }) => {
    const weights = ranking.insight?.effective_weights ?? meta?.weights ?? {};
    return JSON.stringify([
      meta?.country ?? 'fi',
      meta?.scoring_mode,
      meta?.historical_period ?? null,
      meta?.scenario_period ?? null,
      ...factorDefinitions.map(({ key }) => weights[key]),
      [...(ranking.data_quality?.ranking_metrics_used ?? [])].sort(),
      ranking.extra_metrics?.wind_source_used ?? 'merra2',
    ]);
  };
  return signature(a) === signature(b);
}
