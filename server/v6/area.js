import { destination, distanceKm } from '../../app/lib/geo.js';
import { getCatalog, regionReport, regions } from './catalog.js';
import { containsFinland, finlandRegions } from './finland.js';
import { fetchNasaPowerMonthly } from './exact-point.js';

const metricKeys = ['temperature', 'solar', 'wind'];
const bearings = [0, 90, 180, 270, 45, 135, 225, 315];
const dateKeys = Array.from({ length: 240 }, (_, index) =>
  `${2005 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`);

const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const finite = values => values.filter(Number.isFinite);

function summarize(samples, property) {
  const values = finite(samples.map(sample => sample.metrics[property]));
  return {
    mean: average(values), count: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}

function combineSeries(samples, property) {
  const maps = samples.map(sample => new Map(sample.chart[property].map(row => [row.date ?? row.month, row])));
  const keys = [...new Set(maps.flatMap(map => [...map.keys()]))].sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
  const fields = property === 'historical_monthly' ? ['t2m_c'] : ['solar_kwh_m2', 'wind_speed_ms'];
  return keys.map(key => {
    const values = maps.map(map => map.get(key));
    return {
      [property === 'historical_monthly' ? 'date' : 'month']: key,
      ...Object.fromEntries(fields.map(field => {
        // Keep each series on the same samples over time. Gaps stay visible.
        const available = finite(values.map(row => row?.[field]));
        return [field, available.length === values.length ? average(available) : null];
      })),
    };
  });
}

async function bundledSamples(lat, lon, radius, wind) {
  const sites = getCatalog(wind).ranking.filter(row => distanceKm(lat, lon, row.lat, row.lon) <= radius);
  return Promise.all(sites.map(async row => {
    const { chart } = await regionReport(row.site_id, wind);
    const m = row.measurements;
    return {
      lat: row.lat, lon: row.lon, name: regions[row.site_id].name.split(' (')[0],
      metrics: { temperature: m.historical_mean_temp_c, solar: m.solar_ghi_kwh_m2_year, wind: m.wind_speed_100m_ms },
      chart: {
        ...chart,
        monthly_climatology: chart.monthly_climatology.map(({ month, solar_kwh_m2, wind_speed_100m_ms }) => ({
          month, solar_kwh_m2, wind_speed_ms: wind_speed_100m_ms,
        })),
      },
    };
  }));
}

function parameterValue(series, date) {
  const value = series?.[date.replace('-', '')];
  return Number.isFinite(value) && value > -900 ? value : null;
}

function monthlyNasa(parameters) {
  const months = dateKeys.map(date => {
    const [year, month] = date.split('-').map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const solar = parameterValue(parameters.ALLSKY_SFC_SW_DWN, date);
    return {
      date, month, days,
      t2m_c: parameterValue(parameters.T2M, date),
      solar: solar === null ? null : solar * days,
      wind: parameterValue(parameters.WS50M, date),
    };
  });
  const weightedMean = field => months.every(row => Number.isFinite(row[field]))
    ? months.reduce((sum, row) => sum + row[field] * row.days, 0) / months.reduce((sum, row) => sum + row.days, 0)
    : null;

  return {
    metrics: {
      temperature: weightedMean('t2m_c'),
      solar: months.every(row => Number.isFinite(row.solar)) ? months.reduce((sum, row) => sum + row.solar, 0) / 20 : null,
      wind: weightedMean('wind'),
    },
    chart: {
      historical_monthly: months.map(({ date, t2m_c }) => ({ date, t2m_c })),
      monthly_climatology: Array.from({ length: 12 }, (_, index) => {
        const calendarMonth = months.filter(row => row.month === index + 1);
        const solar = finite(calendarMonth.map(row => row.solar));
        const wind = finite(calendarMonth.map(row => row.wind));
        return {
          month: index + 1,
          solar_kwh_m2: solar.length === 20 ? average(solar) : null,
          wind_speed_ms: wind.length === 20 ? average(wind) : null,
        };
      }),
    },
  };
}

async function liveSamples(lat, lon, radius, signal) {
  const geometry = await finlandRegions();
  const planned = [{ lat, lon }, ...bearings.map(bearing => destination(lat, lon, radius * .72, bearing))]
    .filter(point => containsFinland(geometry, point.lat, point.lon)).slice(0, 5);
  const samples = [];
  const deadline = AbortSignal.timeout(25_000);
  const workSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  // Bound upstream fan-out. Adjacent coordinate requests can share a native POWER grid cell.
  for (const point of planned) {
    if (workSignal.aborted) break;
    try {
      const { parameters } = await fetchNasaPowerMonthly(point.lat, point.lon, workSignal, false);
      const entry = monthlyNasa(parameters);
      if (entry.chart.historical_monthly.some(row => Number.isFinite(row.t2m_c))) samples.push({ ...entry, ...point });
    } catch {
      if (workSignal.aborted) break;
    }
  }
  return { samples, planned: planned.length };
}

export async function areaReport({ lat, lon, radius, source, wind, signal }) {
  let samples, planned;
  if (source === 'live') ({ samples, planned } = await liveSamples(lat, lon, radius, signal));
  else {
    samples = await bundledSamples(lat, lon, radius, wind);
    planned = samples.length;
  }

  return {
    source, radius, center: { lat, lon }, samples: samples.map(({ chart, metrics, ...point }) => point),
    coverage: { planned, used: samples.length },
    period: ['2005-01', '2024-12'],
    windHeight: source === 'live' ? 50 : 100,
    metrics: Object.fromEntries(metricKeys.map(key => [key, summarize(samples, key)])),
    chart: {
      historical_monthly: combineSeries(samples, 'historical_monthly'),
      monthly_climatology: combineSeries(samples, 'monthly_climatology'),
    },
  };
}
