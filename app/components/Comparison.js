'use client';

import { useEffect, useMemo, useState } from 'react';
import { annualTemperatures, months } from '../lib/chart-data';
import { coordinates } from '../lib/format';
import { deltaText, unknown, valueText } from '../lib/analysis-format';
import { comparableScores, factorDefinitions, metricDefinitions, normalizeAnalysis, sourceLabel } from '../lib/site-analysis';
import {
  comparisonColors, DEFAULT_TIME_RANGE, getAnalysisReport, isDefaultTimeRange, selectionKey, siteLabel, timeRangeKey,
} from '../lib/sites';
import DashboardChart from './DashboardChartLazy';
import Disclosure from './Disclosure';

const chartMetrics = [
  { key: 'temp', label: 'Air temperature', unit: '°C', axis: 'Annual air temperature (°C)' },
  { key: 'solar', label: 'Monthly sunlight', unit: 'kWh/m²', axis: 'Sunlight (kWh/m² per month)', field: 'solar_kwh_m2' },
  { key: 'wind', label: 'Wind at 100 m', unit: 'm/s', axis: 'Wind at 100 m (m/s)', field: 'wind_speed_100m_ms' },
];
const dash = [undefined, [7, 4], [2, 4]];
const letters = ['A', 'B', 'C'];
const detailFactors = [
  ['cooling', 'Cooling demand indicator', 0, 'cooling_within_climate', false],
  ['summer_heat', 'Summer heat indicator', 0, 'cooling_within_climate', true],
  ['solar', 'Solar resource', 1, 'solar_within_renewables', false],
  ['wind', 'Wind resource', 1, 'solar_within_renewables', true],
  ['water_distance', 'Modeled water proximity', 2, 'water_distance_within_water', false],
  ['water_discharge', 'River flow estimate', 2, 'water_distance_within_water', true],
];

function strongestInput(baseline, candidate, weights, factorIndex) {
  const before = baseline.ranking;
  const after = candidate.ranking;
  const leftWeights = before.insight?.effective_weights ?? baseline.meta?.weights ?? {};
  const rightWeights = after.insight?.effective_weights ?? candidate.meta?.weights ?? {};
  let largest;
  for (const [key, label, index, split, remainder] of detailFactors) {
    if (index !== factorIndex || !Number.isFinite(leftWeights[split]) || leftWeights[split] !== rightWeights[split]) continue;
    if (!Number.isFinite(before.scores[key]) || !Number.isFinite(after.scores[key])) continue;
    const change = (after.scores[key] - before.scores[key]) * weights[index].weight *
      (remainder ? 1 - leftWeights[split] : leftWeights[split]);
    if (!largest || Math.abs(change) > Math.abs(largest.change)) largest = { label, change };
  }
  return largest;
}

function TrendPlot({ candidates, reports }) {
  const [choice, setChoice] = useState('temp');
  const metric = chartMetrics.find(item => item.key === choice);
  const spec = useMemo(() => {
    const isTemp = metric.key === 'temp';
    const rows = reports.map(report => isTemp
      ? annualTemperatures(report?.chart.historical_monthly ?? [])
      : report?.chart.monthly_climatology ?? []);
    const years = [...new Set(rows.flatMap(series => series.map(row => row.year)))].sort();
    const series = rows.map((data, i) => {
      const values = new Map(data.map(row => isTemp ? [row.year, row.temperature] : [row.month, row[metric.field]]));
      return {
        label: letters[i] + ' · ' + siteLabel(candidates[i]), tone: comparisonColors[i], dash: dash[i],
        data: (isTemp ? years : months.map((_, month) => month + 1)).map(key => values.get(key) ?? null),
      };
    });
    return {
      type: 'line', title: metric.label + ' comparison', labels: isTemp ? years.map(String) : months,
      unit: metric.unit, axisLabel: metric.axis, series, markers: true, tickLimit: 6, zero: !isTemp,
    };
  }, [reports, candidates, metric]);
  const showChart = spec.series.filter(series => series.data.some(Number.isFinite)).length >= 2;

  return <section className="card">
    <div className="chart-heading">
      <h2>Compare trends</h2>
      <label className="chart-metric"><span className="sr-only">Chart metric</span>
        <select value={choice} onChange={event => setChoice(event.target.value)}>
          {chartMetrics.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
    </div>
    <ul className="plot-legend" aria-label="Chart series">
      {candidates.map((site, i) => <li key={selectionKey(site)} style={{ '--candidate': comparisonColors[i] }}>
        <span>{letters[i]}</span> {siteLabel(site)}
      </li>)}
    </ul>
    {showChart ? <DashboardChart key={choice} spec={spec} /> : <p className="chart-placeholder">At least two sites need data for this chart.</p>}
  </section>;
}

function deltaValue(metric, base, current) {
  if (!Number.isFinite(base?.value) || !Number.isFinite(current?.value) ||
    (metric.key === 'scoring_water_proximity' && (base.value === 20 || current.value === 20))) return unknown;
  return deltaText(current.value - base.value, metric.unit);
}

function Difference({ candidates, analyses, reports, differences }) {
  const baseline = analyses[0];
  const spec = useMemo(() => differences.some(item => item.factors) ? ({
    type: 'bar', title: 'Weighted score changes compared with A', horizontal: true,
    unit: 'points', axisLabel: 'Change from A (score points)', zero: true, labels: factorDefinitions.map(item => item.label),
    series: differences.filter(item => item.factors).map(({ index, factors }) => ({
      label: letters[index] + ' vs A', tone: comparisonColors[index], data: factors,
    })),
  }) : null, [differences]);

  return <section className="card">
    <h2>Differences from A</h2>
    <div className="delta-grid">
      {differences.map(({ index, factors }) => {
        const current = analyses[index];
        const strongest = factors?.reduce((best, change, i) => Math.abs(change) > Math.abs(factors[best]) ? i : best, 0);
        const input = factors && strongestInput(reports[0], reports[index], baseline.score.factors, strongest);
        return <section className="delta-card" key={selectionKey(candidates[index])}>
          <h3>{letters[index]} · {siteLabel(candidates[index])}</h3>
          {factors && Math.abs(factors[strongest]) > 0 && <p className="delta-driver">
            Largest score driver <strong>{factorDefinitions[strongest].label} {deltaText(factors[strongest], 'points')}</strong>
            {input && <> · {input.label} {deltaText(input.change, 'points')}</>}
          </p>}
          <dl className="delta-values">
            {metricDefinitions.map((metric, i) => <div key={metric.key}>
              <dt>{metric.label}</dt><dd>{deltaValue(metric, baseline?.metrics[i], current?.metrics[i])}</dd>
            </div>)}
          </dl>
        </section>;
      })}
    </div>
    {spec && <DashboardChart spec={spec} />}
  </section>;
}

function RawMeasurements({ candidates, analyses, reports }) {
  return <Disclosure label="View underlying measurements">
    <div className="delta-grid">
      {candidates.map((site, index) => <section className="delta-card" key={selectionKey(site)}>
        <h3>{letters[index]} · {siteLabel(site)}</h3>
        <p>{sourceLabel(reports[index])}</p>
        <dl className="delta-values">
          {metricDefinitions.map((metric, i) => <div key={metric.key}>
            <dt>{metric.label}</dt><dd>{analyses[index]?.metrics[i]?.displayValue ?? unknown}</dd>
          </div>)}
        </dl>
      </section>)}
    </div>
  </Disclosure>;
}

export default function Comparison({ candidates, remove, leader, onChooseSite, timeRange = DEFAULT_TIME_RANGE }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const rangeKey = timeRangeKey(timeRange);
  const key = [attempt, rangeKey, ...candidates.map(site => selectionKey(site) + ':' + site.exact)].join(':');
  const count = candidates.length;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    if (count < 2) return;
    const controller = new AbortController();
    const useCachedReport = isDefaultTimeRange(timeRange);
    Promise.allSettled(
      candidates.map(site => (useCachedReport && site.report)
        ? site.report
        : getAnalysisReport(site, site.exact, controller.signal, timeRange)),
    )
      .then(outcomes => {
        if (!controller.signal.aborted) setResult({
          key,
          reports: outcomes.map(item => item.status === 'fulfilled' ? item.value : null),
          errors: outcomes.map(item => item.status === 'rejected' ? item.reason.message : ''),
        });
      });
    return () => controller.abort();
  }, [candidates, count, key, timeRange]);

  const reports = current?.reports;
  const { analyses, differences, equal } = useMemo(() => {
    if (!reports) return { analyses: [], differences: [], equal: false };
    const analyses = reports.map((report, i) => report ? normalizeAnalysis(report, candidates[i]) : null);
    const baseline = analyses[0];
    const differences = analyses.slice(1).map((analysis, i) => {
      const index = i + 1;
      const comparable = comparableScores(reports[0], reports[index]);
      const gap = comparable ? analysis.score.total - baseline.score.total : null;
      const factors = comparable && analysis.score.factors.every((factor, j) => factor.contribution !== null &&
        baseline.score.factors[j].contribution !== null)
        ? analysis.score.factors.map((factor, j) => factor.contribution - baseline.score.factors[j].contribution)
        : null;
      return { index, gap, factors };
    });
    const scores = analyses.map(item => item?.score.total);
    const equal = differences.every(item => item.gap !== null) && Math.max(...scores) - Math.min(...scores) < 2;
    return { analyses, differences, equal };
  }, [reports, candidates]);

  return <>
    <section className="card compare-controls">
      <div className="chart-heading"><h2>Compare locations</h2><span className="scope-title">{count} / 3 · {timeRange.startYear}–{timeRange.endYear} (+{timeRange.horizonYears}y)</span></div>
      <p className="chart-note">Select locations on the map or use the site menu, then choose Add to comparison.</p>
      {leader && count < 3 && !candidates.some(site => site.siteId === leader.site_id) && (
        <button type="button" className="text-button compare-benchmark" onClick={() => onChooseSite(leader.site_id)}>
          Select regional benchmark · {leader.region?.split(' (')[0]} {valueText(leader.scores?.overall)} / 100
        </button>
      )}
      {count > 0 && <ol className="compare-sites">
        {candidates.map((site, i) => <li key={selectionKey(site)} style={{ '--candidate': comparisonColors[i] }}>
          <span className="candidate-letter" aria-hidden="true">{letters[i]}</span>
          <div>
            <strong>{siteLabel(site)}</strong>
            <p className="mono">{coordinates(site.latitude, site.longitude)}</p>
            {reports?.[i] && <p>{sourceLabel(reports[i])}{i === 0 ? ' · Baseline' : ''}</p>}
          </div>
          <button type="button" className="text-button" onClick={() => remove(site)} aria-label={`Remove ${siteLabel(site)} from comparison`}>Remove</button>
        </li>)}
      </ol>}
    </section>
    {count < 2 && <p className="card" role="status">Add at least two locations to compare them.</p>}
    {count >= 2 && !current && <p className="card" role="status">Loading comparison…</p>}
    {current && <>
      <section className="card comparison-verdict">
        <div className="chart-heading"><h2>{equal ? 'Essentially equal' : 'Score differences'}</h2>
          <span className="scope-title">A · Baseline</span></div>
        <p className="chart-note">{equal ? 'All selected scores are within 2 points.' : 'Differences use A as the baseline.'}</p>
        <ul>{differences.map(({ index, gap }) => <li key={index}>
          <strong>{letters[index]} · {siteLabel(candidates[index])}</strong>
          <span>{gap === null ? 'Scores unavailable or use different inputs'
            : `${deltaText(gap, 'points')}${!equal && Math.abs(gap) < 2 ? ' · Essentially equal to A' : ''}`}</span>
        </li>)}</ul>
      </section>
      <TrendPlot candidates={candidates} reports={reports} />
      <Difference candidates={candidates} analyses={analyses} reports={reports} differences={differences} />
      <RawMeasurements candidates={candidates} analyses={analyses} reports={reports} />
      {current.errors.some(Boolean) && <div className="card" role="status">
        {current.errors.map((error, i) => error && <p key={i}>{siteLabel(candidates[i])} · {error}</p>)}
        <button type="button" className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry comparison</button>
      </div>}
    </>}
  </>;
}
