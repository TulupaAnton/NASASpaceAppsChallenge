'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { coordinates } from '../lib/format';
import { annualTemperatures, months, resourceKey } from '../lib/chart-data';
import { deltaText, percentText, probabilityText, significanceText, slopeText, unknown, valueText } from '../lib/analysis-format';
import { factorDefinitions, normalizeAnalysis, sourceLabel } from '../lib/site-analysis';
import {
  DEFAULT_TIME_RANGE, getAnalysisReport, isDefaultTimeRange, selectionKey, siteLabel, timeRangeKey,
} from '../lib/sites';
import Comparison from './Comparison';
import DashboardChart from './DashboardChartLazy';
import Disclosure from './Disclosure';
import { Icon } from './Icon';

const HISTORY_PRESETS = [
  { label: '2005–2024', startYear: 2005, endYear: 2024 },
  { label: '1984–2024', startYear: 1984, endYear: 2024 },
  { label: '2015–2024', startYear: 2015, endYear: 2024 },
];
const HORIZON_OPTIONS = [5, 10, 15, 20];
const ALL_YEARS = Array.from({ length: 2024 - 1984 + 1 }, (_, i) => 1984 + i);

function TimeWindowControls({ timeRange, onChange }) {
  const { startYear, endYear, horizonYears } = timeRange;
  const activePreset = HISTORY_PRESETS.find(
    preset => preset.startYear === startYear && preset.endYear === endYear,
  );

  return <section className="card time-controls" aria-label="Time range and forecast horizon">
    <div className="time-controls-row">
      <span className="time-controls-label">History</span>
      <div className="toggle" role="group" aria-label="Historical period presets">
        {HISTORY_PRESETS.map(preset => (
          <button
            type="button"
            key={preset.label}
            aria-pressed={activePreset?.label === preset.label}
            onClick={() => onChange({ ...timeRange, startYear: preset.startYear, endYear: preset.endYear })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="time-selects">
        <label>
          <span className="sr-only">Start year</span>
          <select
            aria-label="From year"
            value={startYear}
            onChange={event => onChange({ ...timeRange, startYear: Number(event.target.value) })}
          >
            {ALL_YEARS.filter(y => y <= endYear - 2).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <span aria-hidden="true">–</span>
        <label>
          <span className="sr-only">End year</span>
          <select
            aria-label="To year"
            value={endYear}
            onChange={event => onChange({ ...timeRange, endYear: Number(event.target.value) })}
          >
            {ALL_YEARS.filter(y => y >= startYear + 2).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
    </div>
    <div className="time-controls-row">
      <span className="time-controls-label">Forecast</span>
      <div className="toggle" role="group" aria-label="Forecast horizon">
        {HORIZON_OPTIONS.map(years => (
          <button
            type="button"
            key={years}
            aria-pressed={horizonYears === years}
            onClick={() => onChange({ ...timeRange, horizonYears: years })}
          >
            {years}y
          </button>
        ))}
      </div>
      <span className="chart-note time-controls-span">
        {endYear - startYear + 1}y history · {endYear + 1}–{endYear + horizonYears} scenario
      </span>
    </div>
  </section>;
}

function rankVerdict(rank, count, customWindow) {
  if (customWindow && rank === null) {
    return 'Cohort rank disabled for custom time windows (calibrated only for 2005–2024, 10y).';
  }
  if (rank === null || !count) return 'Site estimate · Unranked';
  if (rank <= count / 3) return 'Near the top of the regional ranking';
  if (rank <= count * 2 / 3) return 'Middle of the regional ranking';
  return 'Lower in the regional ranking';
}

function ScoreSummary({ analysis, report, customWindow }) {
  const { total, rank, ofTotal, factors } = analysis.score;
  const spec = useMemo(() => ({
    type: 'bar', title: 'How the factors build the score', unit: 'points',
    axisLabel: 'Score points out of 100', horizontal: true, compact: true, stacked: true,
    labels: ['Contributions'], limits: { min: 0, max: 100 },
    series: factors.map((factor, index) => ({
      label: factor.label, tone: factorDefinitions[index].tone, data: [factor.contribution], stack: 'score',
    })),
  }), [factors]);
  const available = total !== null;
  const knownFactors = factors.filter(factor => factor.contribution !== null && factor.weight !== null);
  const strongest = knownFactors.reduce((best, factor) => !best || factor.contribution > best.contribution ? factor : best, null);
  const limiting = knownFactors.reduce((worst, factor) =>
    !worst || factor.weight * 100 - factor.contribution > worst.weight * 100 - worst.contribution ? factor : worst, null);

  return <section className="card score-overview" aria-label="Site overview">
    <div className="overview-head">
      <div>
        <h2>Screening score</h2>
        {available ? <>
          <div className="score-head">
            <strong>{valueText(total)}<small> / 100</small></strong>
            {rank !== null && <span className="rank">Rank {rank} of {ofTotal}</span>}
          </div>
          <p className="overview-verdict">{rankVerdict(rank, ofTotal, customWindow)}</p>
        </> : <p className="overview-verdict">Score unavailable · Incomplete site data</p>}
      </div>
      <div className="overview-source">
        <span className="scope-title">{sourceLabel(report)}</span>
        <p className="mono">{coordinates(analysis.coordinates.latitude, analysis.coordinates.longitude)}</p>
      </div>
    </div>

    <dl className="factor-legend">
      {factors.map(({ key, label, contribution }, index) => (
        <div key={key} data-tone={factorDefinitions[index].tone}>
          <dt><i aria-hidden="true" />{label}</dt>
          <dd>{contribution === null ? unknown : deltaText(contribution, 'points')}</dd>
          <dd className="factor-explanation">{factorDefinitions[index].explanation}</dd>
        </div>
      ))}
    </dl>
    {available && knownFactors.length === factors.length && <DashboardChart spec={spec} />}
    {available && strongest && <p className="overview-reasons">
      <strong>{strongest.label}</strong> contribute most to the score.
      {limiting && limiting !== strongest && <> <strong>{limiting.label}</strong> limit the score most.</>}
    </p>}
  </section>;
}

function Toggle({ label, options, current, change }) {
  return <div className="toggle" role="group" aria-label={label}>
    {options.map(([value, text]) => (
      <button type="button" key={value} aria-pressed={current === value} onClick={() => change(value)}>{text}</button>
    ))}
  </div>;
}

function Temperature({ report, analysis }) {
  const [kind, setKind] = useState('observed');
  const historical = kind === 'observed';
  const monthly = historical ? report.chart.historical_monthly : report.chart.scenario_monthly;
  const spec = useMemo(() => {
    const observations = annualTemperatures(monthly ?? []);
    const fitted = historical
      ? new Map(annualTemperatures((monthly ?? []).map(row => ({ ...row, t2m_c: row.seasonal_trend_c })))
        .map(row => [row.year, row.temperature]))
      : new Map();
    const series = [{
      label: historical ? 'Historical estimate' : 'Scenario', data: observations.map(row => row.temperature),
      tone: historical ? 'mint' : 'muted', fill: historical, dash: historical ? undefined : [5, 4],
    }];
    if ([...fitted.values()].some(Number.isFinite)) series.push({
      label: 'Fitted trend', tone: 'mint', dash: [5, 4], data: observations.map(row => fitted.get(row.year) ?? null),
    });
    return {
      type: 'line', title: historical ? 'Observed annual air temperature' : 'Scenario annual air temperature',
      labels: observations.map(row => String(row.year)), unit: '°C', axisLabel: 'Air temperature (°C)',
      series, tickLimit: 6,
    };
  }, [historical, monthly]);
  const trend = analysis.trend;
  const mean = analysis.metrics[0];

  return <section className="detail-section">
    <div className="chart-heading">
      <h3><Icon name="temp" /> Annual air temperature</h3>
      <Toggle label="Temperature view" options={[[ 'observed', 'Observed' ], ['scenario', 'Scenario']]} current={kind} change={setKind} />
    </div>
    <p className="chart-note">
      {historical ? <>Historical mean <strong>{mean.displayValue}</strong></> : 'Illustrates how temperatures could change if the historical pattern continues.'}
    </p>
    {historical && <p className="chart-note">
      Trend <strong>{slopeText(trend.slopePerDecade)}</strong> · {significanceText(trend.isSignificant)}
      {spec.series.length > 1 && <> · Dashed line shows the fitted trend</>}
    </p>}
    {spec.series[0].data.some(Number.isFinite)
      ? <DashboardChart key={kind} spec={spec} />
      : <p className="chart-placeholder">Annual temperature data unavailable.</p>}
  </section>;
}

function Energy({ report, analysis }) {
  const [kind, setKind] = useState('solar');
  const solar = kind === 'solar';
  const rows = report.chart.monthly_climatology;
  const spec = useMemo(() => {
    const values = (rows ?? []).map(month => month[resourceKey(kind)]);
    const peak = values.reduce((best, value, i) => Number.isFinite(value) && (best === -1 || value > values[best]) ? i : best, -1);
    return {
      type: 'bar', title: solar ? 'Monthly sunlight' : 'Monthly wind at 100 m',
      unit: solar ? 'kWh/m²' : 'm/s', axisLabel: solar ? 'Sunlight (kWh/m² per month)' : 'Wind at 100 m (m/s)',
      labels: (rows ?? []).map(month => months[month.month - 1]), markers: false, zero: true, preferred: peak,
      peakLabel: true,
      series: [{ label: solar ? 'Sunlight' : 'Wind at 100 m', tone: 'amber', data: values, peak }],
    };
  }, [kind, rows, solar]);
  const metric = analysis.metrics[solar ? 1 : 2];

  return <section className="detail-section">
    <div className="chart-heading">
      <h3><Icon name="sun" /> Energy resources by month</h3>
      <Toggle label="Energy resource" options={[[ 'solar', 'Solar' ], [ 'wind', 'Wind' ]]} current={kind} change={setKind} />
    </div>
    <p className="chart-note">{solar ? 'Annual sunlight' : 'Average wind at 100 m'} <strong>{metric.displayValue}</strong>
    </p>
    {!solar && report.ranking.extra_metrics?.wind_source_used === 'merra2' && (
      <p className="chart-note">Wind estimate from MERRA-2 because Global Wind Atlas was unavailable.</p>
    )}
    {spec.preferred >= 0 ? <DashboardChart key={kind} spec={spec} /> : <p className="chart-placeholder">Monthly data unavailable.</p>}
  </section>;
}

function Method({ analysis, report, legacy }) {
  const { trend } = analysis;
  const years = period => period?.length === 2 ? period[0].slice(0, 4) + '–' + period[1].slice(0, 4) : unknown;

  return <Disclosure label="Method & statistics">
    <p>The screening score weighs outdoor cooling climate, renewable resources, and modeled water indicators. A build decision also depends on grid capacity, fiber connectivity, land, and permits.</p>
    <dl className="method-grid">
      <div><dt>Historical record</dt><dd>{years(report.meta?.historical_period)}</dd></div>
      <div><dt>Scenario period</dt><dd>{years(report.meta?.scenario_period)}</dd></div>
      <div><dt>Historical slope</dt><dd>{slopeText(trend.slopePerDecade)}</dd></div>
      <div><dt>95% slope interval</dt><dd>{trend.slope95CI ? trend.slope95CI.map(value => value.toFixed(2)).join(' to ') + ' °C per decade' : unknown}</dd></div>
      <div><dt>Unadjusted test</dt><dd>{probabilityText(trend.pValue)}</dd></div>
      <div><dt>FDR-adjusted test</dt><dd>{probabilityText(trend.pAdjusted)}</dd></div>
      <div><dt>Trend result at 5%</dt><dd>{significanceText(trend.isSignificant)}{trend.significanceBasis && (trend.significanceBasis === 'fdr' ? ' · Adjusted across regions' : ' · Single-site test')}</dd></div>
      <div><dt>Mapped water sample</dt><dd>{analysis.metrics[4].displayValue}</dd></div>
    </dl>
    <p>The mapped sample is a separate reference layer. The score uses modeled water proximity and flow. Neither distance establishes water access for a project.</p>
    <table className="method-table">
      <thead><tr><th scope="col">Factor</th><th scope="col">Score / 100</th><th scope="col">Weight</th><th scope="col">Points</th></tr></thead>
      <tbody>{analysis.score.factors.map(factor => <tr key={factor.key}>
        <th scope="row">{factor.label}</th><td>{valueText(factor.score)}</td><td>{percentText(factor.weight)}</td><td>{valueText(factor.contribution)}</td>
      </tr>)}</tbody>
    </table>
    <a className="text-button" href={legacy}>Regional report &amp; CSV downloads <Icon name="upRight" /></a>
  </Disclosure>;
}

export default function Analysis({ site, onChooseSite, shortlist, onAdd, onRemove }) {
  const [tab, setTab] = useState('site');
  const [timeRange, setTimeRange] = useState(DEFAULT_TIME_RANGE);
  const [request, setRequest] = useState(null);
  const [result, setResult] = useState(null);
  const panel = useRef(null);
  const exact = request?.site === site ? request.exact : site.index === undefined;
  const attempt = request?.site === site ? request.attempt : 0;
  const rangeKey = timeRangeKey(timeRange);
  const customWindow = !isDefaultTimeRange(timeRange);
  const added = shortlist.some(candidate => selectionKey(candidate) === selectionKey(site));

  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [site, tab]);
  useEffect(() => {
    const node = panel.current;
    const footer = node?.parentElement?.querySelector('.footer');
    if (!footer) return;
    function fitFooter() {
      node.style.setProperty('--analysis-footer-height', footer.offsetHeight + 'px');
    }
    const observer = new ResizeObserver(fitFooter);
    fitFooter();
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    getAnalysisReport(site, exact, signal, timeRange).then(
      report => { if (!signal.aborted) setResult({ site, exact, attempt, rangeKey, report }); },
      error => { if (!signal.aborted) setResult({ site, exact, attempt, rangeKey, error: error.message }); },
    );
    return () => controller.abort();
  }, [site, exact, attempt, rangeKey, timeRange]);

  const current = result?.site === site && result.exact === exact && result.attempt === attempt && result.rangeKey === rangeKey ? result : null;
  const report = current?.report;
  const analysis = useMemo(() => report ? normalizeAnalysis(report, site) : null, [report, site]);
  const legacy = '/legacy/index.html?' + new URLSearchParams({
    lat: site.latitude, lon: site.longitude,
    ...(site.index === undefined ? {} : { marker: site.index }),
  });
  const load = useExact => setRequest({ site, exact: useExact, attempt: attempt + 1 });

  return <section className="analysis-panel" aria-label="Site analysis" ref={panel}>
    <header className="site-heading">
      <p className="eyebrow"><span className="signal-dot" /> Data center site analysis</p>
      <h1>{siteLabel(site)}</h1>
      <p>{analysis?.region ?? site.region}, Finland</p>
    </header>

    <div className="analysis-navigation">
      <div className="toggle" role="group" aria-label="Analysis view">
        <button type="button" aria-pressed={tab === 'site'} onClick={() => setTab('site')}>Site</button>
        <button type="button" aria-pressed={tab === 'compare'} onClick={() => setTab('compare')}>Compare ({shortlist.length})</button>
      </div>
      <button type="button" className="back-button add-site" disabled={added || shortlist.length >= 3}
        title={!added && shortlist.length >= 3 ? 'Remove a comparison site before adding another' : undefined}
        onClick={() => { onAdd({ ...site, exact, report }); setTab('compare'); }}>
        <Icon name="plus" />{added ? 'Added to comparison' : 'Add to comparison'}
      </button>
    </div>

    <TimeWindowControls timeRange={timeRange} onChange={setTimeRange} />

    {tab === 'compare' && <Comparison candidates={shortlist} remove={onRemove} leader={report?.leader} onChooseSite={onChooseSite} timeRange={timeRange} />}
    {tab === 'site' && analysis && <>
      <ScoreSummary analysis={analysis} report={report} customWindow={customWindow} />
      <Disclosure label="Measurements and charts">
        <Temperature report={report} analysis={analysis} />
        <Energy report={report} analysis={analysis} />
        <section className="detail-section">
          <h3>Modeled water proximity</h3>
          <p>{analysis.metrics[3].displayValue}</p>
        </section>
      </Disclosure>
      <Method analysis={analysis} report={report} legacy={legacy} />
    </>}
    {tab === 'site' && !current && <p className="card" role="status">{exact || customWindow ? 'Analyzing selected coordinates…' : 'Loading regional sample…'}</p>}
    {tab === 'site' && current?.error && <div className="card" role="status">
      <p>{current.error}</p><button className="text-button" onClick={() => load(exact)}>Retry</button>
    </div>}
    {tab === 'site' && (site.index !== undefined || customWindow) && <div className="analysis-tools">
      {customWindow && site.index !== undefined ? (
        <button className="text-button" onClick={() => { setTimeRange(DEFAULT_TIME_RANGE); load(false); }}>
          View default regional sample (2005–2024) <Icon name="right" />
        </button>
      ) : site.index !== undefined && (
        <button className="text-button" onClick={() => load(!exact)}>
          {exact ? 'View regional sample' : 'Analyze exact coordinates'} <Icon name="right" />
        </button>
      )}
    </div>}
  </section>;
}
