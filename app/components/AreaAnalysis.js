'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { annualTemperatures, months } from '../lib/chart-data';
import { areaRadii } from '../lib/geo';
import { number } from '../lib/format';
import { getAreaReport, selectionKey } from '../lib/sites';

const TemperatureChart = dynamic(() => import('./TemperatureChart'), { ssr: false });
const SeasonalChart = dynamic(() => import('./SeasonalChart'), { ssr: false });

export const areaMetrics = [
  { key: 'temperature', title: 'Air temperature', unit: '°C' },
  { key: 'solar', title: 'Annual sunlight', unit: 'kWh/m²' },
  { key: 'wind', title: 'Wind speed', unit: 'm/s' },
];

export function RadiusPicker({ radius, onRadius }) {
  return <label className="wind-picker field"><span>Radius</span>
    <select value={radius} onChange={event => onRadius(Number(event.target.value))}>
      {areaRadii.map(km => <option key={km} value={km}>{km} km</option>)}
    </select>
  </label>;
}

function AreaCharts({ report }) {
  const [resource, setResource] = useState('solar');
  const yearly = useMemo(() => annualTemperatures(report.chart.historical_monthly), [report]);
  const key = resource === 'solar' ? 'solar_kwh_m2' : 'wind_speed_ms';
  const valid = report.chart.monthly_climatology.filter(month => Number.isFinite(month[key]));
  const peak = valid.reduce((best, month) => !best || month[key] > best[key] ? month : best, null);
  return <div className="chart-grid">
    <section className="card chart-card">
      <h2>Area average by year</h2>
      <p className="chart-note">Air temperature (°C), 2005–2024</p>
      {yearly.some(row => Number.isFinite(row.temperature))
        ? <TemperatureChart rows={yearly} modeled={false} />
        : <p className="chart-placeholder">Annual temperature series unavailable.</p>}
    </section>
    <section className="card chart-card">
      <div className="chart-heading">
        <h2>Resources by month</h2>
        <div className="toggle" role="group" aria-label="Area resource">
          <button aria-pressed={resource === 'solar'} onClick={() => setResource('solar')}>Solar</button>
          <button aria-pressed={resource === 'wind'} onClick={() => setResource('wind')}>Wind</button>
        </div>
      </div>
      <p className="chart-note">{resource === 'solar' ? 'Sunlight (kWh/m²)' : `Wind at ${report.windHeight} m (m/s)`}</p>
      {peak ? <>
        <SeasonalChart rows={report.chart.monthly_climatology} kind={resource} peakMonth={peak.month} windHeight={report.windHeight} windKey="wind_speed_ms" />
        <p className="chart-note">Peak month <strong>{months[peak.month - 1]}</strong></p>
      </> : <p className="chart-placeholder">Monthly resource data unavailable.</p>}
    </section>
  </div>;
}

export default function AreaAnalysis({ site, wind, radius, onRadius }) {
  const [source, setSource] = useState('bundled');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${selectionKey(site)}:${radius}:${source}:${wind}:${attempt}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    getAreaReport(site, radius, source, wind, controller.signal).then(
      report => { if (!controller.signal.aborted) setResult({ key, report }); },
      error => { if (!controller.signal.aborted) setResult({ key, error: error.message }); },
    );
    return () => controller.abort();
  }, [site, radius, source, wind, key]);

  const report = current?.report;
  return <>
    <section className="card area-controls">
      <div className="chart-heading"><h2>Analyze an area around this point</h2></div>
      <div className="filter-row">
        <RadiusPicker radius={radius} onRadius={onRadius} />
        <label className="wind-picker field"><span>Data source</span>
          <select value={source} onChange={event => setSource(event.target.value)}>
            <option value="bundled">Bundled references</option>
            <option value="live">Live NASA POWER</option>
          </select>
        </label>
      </div>
      <p className="chart-note">{source === 'bundled'
        ? 'Averages the reference sites whose coordinates fall within the circle.'
        : 'Samples up to five Finnish locations in the circle. Nearby samples can share a NASA grid cell.'}</p>
    </section>

    {!current && <p className="card" role="status">{source === 'live' ? 'Fetching NASA POWER samples…' : 'Finding bundled references…'}</p>}
    {current?.error && <div className="card" role="status">
      <p>{current.error}</p><button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </div>}
    {report?.coverage.used === 0 && <p className="card" role="status">No bundled references are inside this circle. Try a larger radius or choose live NASA POWER.</p>}
    {report?.coverage.used > 0 && <>
      <section className="card">
        <div className="chart-heading">
          <h2>Area averages</h2>
          <span className="scope-title">{report.coverage.used} {report.coverage.used === 1 ? 'sample' : 'samples'}</span>
        </div>
        <div className="area-metrics">
          {areaMetrics.map(({ key, title, unit }) => {
            const m = report.metrics[key];
            return <div key={key}>
              <p>{title}{key === 'wind' ? ` at ${report.windHeight} m` : ''}</p>
              <strong>{number(m.mean, unit)}</strong>
              <p>{m.count > 1 ? `Sample range ${number(m.min)}–${number(m.max)} ${unit}` : m.count ? 'One available sample' : 'No complete sample'}</p>
              {m.count > 0 && m.count < report.coverage.used && <p>Based on {m.count} of {report.coverage.used} samples</p>}
            </div>;
          })}
        </div>
        {report.coverage.used === 1 && <p className="chart-note">This area is represented by one sample. Increase the radius or try a different source for broader coverage.</p>}
        {report.coverage.used < report.coverage.planned && <p className="chart-note">Fetched {report.coverage.used} of {report.coverage.planned} planned samples.</p>}
        <details className="area-samples">
          <summary>Locations used</summary>
          <ul>{report.samples.map(sample => <li key={`${sample.lat},${sample.lon}`}>
            {sample.name ? sample.name + ' · ' : ''}{sample.lat.toFixed(3)}° N, {sample.lon.toFixed(3)}° E
          </li>)}</ul>
        </details>
      </section>
      <AreaCharts report={report} />
      <p className="decision-note">Area views summarize climate and energy measurements. The v6 siting score is available for individual reference sites.</p>
    </>}
  </>;
}
