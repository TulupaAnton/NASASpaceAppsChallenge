'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { annualTemperatures, months } from '../lib/chart-data';
import { coordinates, number } from '../lib/format';
import { comparisonColors, getAreaReport, getExactReport, getSiteReport, selectionKey, siteLabel } from '../lib/sites';
import { areaMetrics, RadiusPicker } from './AreaAnalysis';

const ComparisonChart = dynamic(() => import('./ComparisonChart'), { ssr: false });
const scoreMetric = { key: 'score', title: 'V6 siting score', unit: 'points' };

const modes = [
  ['reference', 'Site references (bundled)'],
  ['point', 'Exact points (live)'],
  ['area', 'Areas (bundled references)'],
  ['live-area', 'Areas (live NASA POWER)'],
];

const measurementKeys = {
  temperature: 'historical_mean_temp_c',
  solar: 'solar_ghi_kwh_m2_year',
  wind: 'wind_speed_100m_ms',
};

function loadComparison(site, wind, mode, radius, signal) {
  if (mode === 'point') return getExactReport(site, wind, signal);
  if (mode === 'area' || mode === 'live-area') return getAreaReport(site, radius, mode === 'area' ? 'bundled' : 'live', wind, signal);
  return getSiteReport(site, wind, signal);
}

function summaryValue(report, key) {
  if (key === 'score') return report?.ranking?.scores?.overall;
  return report?.metrics?.[key]?.mean ?? report?.ranking?.measurements?.[measurementKeys[key]];
}

function comparableScores(reports, mode) {
  if (mode !== 'reference' && mode !== 'point') return false;
  if (reports.some(report => report?.partial || !Number.isFinite(summaryValue(report, 'score')))) return false;
  const signature = report => {
    const weights = report.ranking.insight?.effective_weights ?? report.meta?.weights ?? {};
    const indicators = [...(report.ranking.data_quality?.ranking_metrics_used ?? [])].sort();
    const wind = report.ranking.extra_metrics?.wind_source_used ?? report.ranking.sources?.wind?.split(' (')[0];
    return JSON.stringify([[weights.climate, weights.renewables, weights.water], indicators, wind]);
  };
  return new Set(reports.map(signature)).size === 1;
}

function basis(report, mode) {
  if (mode === 'reference') return report?.mode === 'archive'
    ? 'Archived point data'
    : report?.ranking?.region ? report.ranking.region.split(' (')[0] + ' reference' : 'Regional reference';
  if (mode === 'point') return 'Exact coordinates';
  if (!report) return 'Area samples';
  return `${report.coverage.used} ${report.coverage.used === 1 ? 'sample' : 'samples'}` +
    (report.source === 'live' ? ` of ${report.coverage.planned} planned` : '');
}

function ComparisonPlot({ reports, candidates, metric }) {
  const { labels, datasets, hasValues } = useMemo(() => {
    const chartRows = reports.map(report => metric.key === 'temperature'
      ? annualTemperatures(report?.chart?.historical_monthly ?? [])
      : report?.chart?.monthly_climatology ?? []);
    const years = [...new Set(chartRows.flatMap(rows => rows.map(row => row.year)))].filter(Boolean).sort();
    const readMonthly = row => metric.key === 'solar' ? row?.solar_kwh_m2 : row?.wind_speed_ms ?? row?.wind_speed_100m_ms;
    const labels = metric.key === 'score' ? candidates.map((_, index) => String.fromCharCode(65 + index))
      : metric.key === 'temperature' ? years.map(String) : months;
    const datasets = metric.key === 'score' ? [{
      label: 'Siting score', data: reports.map(report => summaryValue(report, 'score')),
      siteLabels: candidates.map(siteLabel),
      backgroundColor: comparisonColors, borderRadius: 5, maxBarThickness: 58,
    }] : chartRows.map((rows, index) => {
      const values = metric.key === 'temperature'
        ? years.map(year => rows.find(row => row.year === year)?.temperature ?? null)
        : months.map((_, month) => readMonthly(rows.find(row => row.month === month + 1)) ?? null);
      return {
        label: siteLabel(candidates[index]), data: values, borderColor: comparisonColors[index],
        backgroundColor: comparisonColors[index], borderWidth: 2.5, pointRadius: 2,
        pointHoverRadius: 5, spanGaps: false,
      };
    });
    return { labels, datasets, hasValues: datasets.filter(dataset => dataset.data.some(Number.isFinite)).length >= (metric.key === 'score' ? 1 : 2) };
  }, [reports, candidates, metric]);
  return hasValues ? <ComparisonChart labels={labels} datasets={datasets} metric={metric} />
    : <p className="chart-placeholder">At least two sites need data for this chart.</p>;
}

export default function Comparison({ candidates, remove, wind, mode, onMode, radius, onRadius }) {
  const [selectedMetric, setSelectedMetric] = useState('temperature');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const key = [mode, radius, wind, attempt, ...candidates.map(selectionKey)].join(':');
  const count = candidates.length;
  const current = result?.key === key ? result : null;
  const isArea = mode.endsWith('area');
  const reports = current?.reports;

  useEffect(() => {
    if (count < 2) return;
    const controller = new AbortController();
    Promise.allSettled(candidates.map(site => loadComparison(site, wind, mode, radius, controller.signal)))
      .then(outcomes => {
        if (!controller.signal.aborted) setResult({
          key,
          reports: outcomes.map(item => item.status === 'fulfilled' ? item.value : null),
          errors: outcomes.map(item => item.status === 'rejected' ? item.reason.message : ''),
        });
      });
    return () => controller.abort();
  }, [candidates, count, key, mode, radius, wind]);

  const showScores = reports && comparableScores(reports, mode);
  const metrics = showScores ? [...areaMetrics, scoreMetric] : areaMetrics;
  const metric = metrics.find(item => item.key === selectedMetric) ?? metrics[0];
  const windHeight = mode === 'live-area' ? 50 : 100;
  const bestScore = showScores ? Math.max(...reports.map(report => summaryValue(report, 'score'))) : null;
  const bestSites = showScores ? candidates.filter((_, index) => summaryValue(reports[index], 'score') === bestScore) : [];

  return <>
    <section className="card compare-controls">
      <div className="chart-heading"><h2>Compare up to three locations</h2><span className="scope-title">{count} / 3</span></div>
      <p className="chart-note">Select places on the map or from the site menu, then add them with <strong>Add to comparison</strong>.</p>
      <div className="filter-row">
        <label className="wind-picker field"><span>Compare using</span>
          <select value={mode} onChange={event => onMode(event.target.value)}>
            {modes.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
          </select>
        </label>
        {isArea && <RadiusPicker radius={radius} onRadius={onRadius} />}
      </div>
      {isArea && <p className="chart-note">Each circle uses the same radius and data source. The results summarize samples from 2005–2024.</p>}
      {mode === 'point' && <p className="chart-note">Live point analysis uses the supplied v6 engine. Data availability varies by location.</p>}
      {count > 0 && <ol className="compare-sites">
        {candidates.map((site, index) => <li key={selectionKey(site)} style={{ '--candidate': comparisonColors[index] }}>
          <span className="candidate-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
          <div><b>{siteLabel(site)}</b><p>{coordinates(site.latitude, site.longitude)}</p></div>
          <button className="text-button" onClick={() => remove(site)} aria-label={`Remove ${siteLabel(site)} from comparison`}>Remove</button>
        </li>)}
      </ol>}
    </section>
    {count < 2 && <p className="card" role="status">Add at least two locations to see the comparison.</p>}
    {count >= 2 && !current && <p className="card" role="status">{mode.startsWith('live') || mode === 'point' ? 'Fetching live comparison data…' : 'Loading comparison…'}</p>}
    {current && <>
      <section className="card">
        <div className="chart-heading">
          <h2>Compare on the same scale</h2>
          <label className="wind-picker field"><span className="sr-only">Chart metric</span>
            <select value={metric.key} onChange={event => setSelectedMetric(event.target.value)}>
              {metrics.map(option => <option value={option.key} key={option.key}>{option.title}</option>)}
            </select>
          </label>
        </div>
        <p className="chart-note">
          {metric.key === 'temperature' ? 'Annual averages (°C)' : metric.key === 'solar' ? 'Typical monthly sunlight (kWh/m²)'
            : metric.key === 'wind' ? `Typical monthly wind at ${windHeight} m (m/s)` : '0–100 points. Higher scores rank better under the model.'}
        </p>
        <ComparisonPlot reports={reports} candidates={candidates} metric={metric} />
      </section>
      <section className="card">
        <h2>Side-by-side measurements</h2>
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead><tr><th scope="col">Metric</th>{candidates.map((site, index) =>
              <th scope="col" key={selectionKey(site)}><span style={{ color: comparisonColors[index] }}>{String.fromCharCode(65 + index)}</span> {siteLabel(site)}</th>,
            )}</tr></thead>
            <tbody>
              <tr><th scope="row">Data represented</th>{reports.map((report, index) => <td key={index}>{basis(report, mode)}</td>)}</tr>
              {metrics.map(({ key, title, unit }) => <tr key={key}>
                <th scope="row">{title}{key === 'wind' ? ` at ${windHeight} m` : ''}</th>
                {reports.map((report, index) => <td key={index}>{number(summaryValue(report, key), unit)}</td>)}
              </tr>)}
              {!isArea && <tr><th scope="row">Estimated distance to water</th>
                {reports.map((report, index) => {
                  const distance = report?.ranking?.measurements?.water_distance_km;
                  return <td key={index}>{distance === 20 ? 'Beyond 12 km survey' : number(distance, 'km')}</td>;
                })}
              </tr>}
            </tbody>
          </table>
        </div>
        {showScores && <p className="chart-note"><strong>{bestSites.map(siteLabel).join(' and ')}</strong> {bestSites.length > 1 ? 'tie for the highest score' : 'has the highest score'} in this comparison at {number(bestScore)} / 100.</p>}
        {!showScores && <p className="chart-note">{isArea
          ? 'Area averages compare climate and energy measurements. V6 scores apply to individual sites.'
          : 'A score comparison requires complete scores with the same inputs and weights.'}</p>}
        {reports.some(report => report?.coverage?.used === 0) && <p className="chart-note">A circle has no bundled references. Increase the radius or choose live NASA POWER.</p>}
        {current.errors.some(Boolean) && <div className="chart-note" role="status">
          {current.errors.map((error, index) => error && <p key={index}>{siteLabel(candidates[index])} · {error}</p>)}
          <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry comparison</button>
        </div>}
      </section>
    </>}
  </>;
}
