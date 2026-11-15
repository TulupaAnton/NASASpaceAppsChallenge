'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { coordinates, number, regionName } from '../lib/format';
import { annualTemperatures, months, resourceKey } from '../lib/chart-data';
import { getExactReport, getSiteReport, selectionKey } from '../lib/sites';
import AreaAnalysis from './AreaAnalysis';
import Comparison from './Comparison';
import { Icon } from './Icon';

const loadingChart = () => <p className="chart-placeholder" role="status">Loading chart…</p>;
const TemperatureChart = dynamic(() => import('./TemperatureChart'), { ssr: false, loading: loadingChart });
const SeasonalChart = dynamic(() => import('./SeasonalChart'), { ssr: false, loading: loadingChart });
const scoreGroups = [
  ['Cooling climate', 'climate', 'mint'],
  ['Wind and solar', 'renewables', 'amber'],
  ['Water resources', 'water', 'blue'],
];
const historyText = {
  observed: ['Observed', 'historical_monthly'],
  modeled: ['Model scenario', 'scenario_monthly'],
};
const trendNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const noRows = [];

function Score({ report, onChooseSite }) {
  const { ranking, count, partial, leader } = report;
  const { scores, rank } = ranking;
  const weights = ranking.insight?.effective_weights ?? report.meta?.weights;
  const showLeader = leader && leader.site_id !== ranking.site_id;
  const gap = showLeader ? leader.scores.overall - scores?.overall : 0;

  return (
    <section className="card score-card">
      <div className="score-top">
        <div>
          <h2>Siting score</h2>
          {partial || !Number.isFinite(scores?.overall) ? (
            <p className="card-note">{report.mode === 'archive' ? 'This archived point has incomplete water data.' : 'This point has incomplete data.'} A total score is unavailable.</p>
          ) : (
            <div className="score-head">
              <strong>{number(scores.overall)}<small> / 100</small></strong>
              {Number.isFinite(rank) && count > 1 && <span className="rank">Rank {rank} of {count}</span>}
            </div>
          )}
        </div>
        {weights && <p className="score-explanation">Higher scores rank better. Each factor is scored out of 100, then weighted to calculate the total.</p>}
      </div>
      <dl className="scores">
        {scoreGroups.filter(([, key]) => Number.isFinite(scores?.[key])).map(([label, key, color]) => (
          <div className={'score-row ' + color} key={key}>
            <dt>{label} {Number.isFinite(weights?.[key]) && <span>{number(weights[key] * 100)}% weight</span>}</dt>
            <dd>{number(scores[key])} / 100</dd>
            <dd className="score-track" aria-hidden="true"><span style={{ width: Math.min(100, Math.max(0, scores[key])) + '%' }} /></dd>
          </div>
        ))}
      </dl>
      {showLeader && (
        <div className="leader">
          <div>
            <p>Highest-scoring region</p>
            <strong>{regionName(leader.region)} · {number(leader.scores.overall)} / 100</strong>
            {gap > 0 && <span className="leader-gap">{number(gap)} points higher</span>}
          </div>
          <button className="back-button" type="button" onClick={() => onChooseSite(leader.site_id)}>Explore this region <Icon name="right" /></button>
        </div>
      )}
    </section>
  );
}

function Measurements({ report }) {
  const m = report.ranking.measurements ?? {};
  const values = [
    ['Average air temperature', number(m.historical_mean_temp_c, '°C'), 'Cooler air can reduce cooling demand.'],
    ['Annual sunlight', number(m.solar_ghi_kwh_m2_year, 'kWh/m²'), 'More sunlight increases solar potential.'],
    ['Wind speed at 100 m', number(m.wind_speed_100m_ms, 'm/s'), 'Stronger wind can support more generation.'],
    ['Estimated distance to water', m.water_distance_km === 20 ? 'Beyond 12 km survey' : number(m.water_distance_km, 'km'), 'Nearby water can support some cooling systems.'],
  ];

  return (
    <section className="card measurement-card">
      <h2>What affects this site?</h2>
      <dl className="measurements">
        {values.map(([label, value, meaning]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd><dd className="measurement-meaning">{meaning}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function Toggle({ label, options, current, onChange }) {
  return (
    <div className="toggle" role="group" aria-label={label}>
      {options.map(([value, text]) => (
        <button key={value} type="button" aria-pressed={current === value} onClick={() => onChange(value)}>{text}</button>
      ))}
    </div>
  );
}

function Temperature({ report }) {
  const [kind, setKind] = useState('observed');
  const monthly = report.chart[historyText[kind][1]] ?? noRows;
  const rows = useMemo(() => annualTemperatures(monthly), [monthly]);
  const period = rows.length ? rows[0].year + '–' + rows.at(-1).year : '';
  const trend = report.ranking.trend;
  const slope = trend?.slope_c_per_decade;
  const adjusted = Number.isFinite(trend?.p_value_fdr_bh);
  const significant = adjusted ? trend.significant_fdr05 : trend?.significant_p05;

  return (
    <section className="card chart-card">
      <div className="chart-heading">
        <h2><Icon name="temp" /> Annual air temperature</h2>
        <span className="unit">°C</span>
      </div>
      <div className="chart-toolbar">
        <p>{period}</p>
        <Toggle label="Temperature series" options={Object.entries(historyText).map(([value, [label]]) => [value, label])}
          current={kind} onChange={setKind} />
      </div>
      {rows.some(row => Number.isFinite(row.temperature))
        ? <TemperatureChart rows={rows} modeled={kind === 'modeled'} />
        : <p className="chart-placeholder">Temperature series unavailable.</p>}
      {kind === 'observed' && Number.isFinite(slope) && (
        <p className="chart-note" title={adjusted ? 'Trend test adjusted for the number of regions compared.' : undefined}>
          Estimated change <strong>{trendNumber.format(slope)} °C per decade.</strong>
          {' '}{significant === true
            ? 'The analysis detected a long-term trend.'
            : significant === false ? 'The evidence for a long-term trend is uncertain.' : ''}
        </p>
      )}
      {kind === 'modeled' && <p className="chart-note">Scenario assuming the historical trend and seasonal patterns continue.</p>}
    </section>
  );
}

function Seasonality({ report }) {
  const [kind, setKind] = useState('solar');
  const rows = report.chart.monthly_climatology ?? noRows;
  const key = resourceKey(kind);
  const peak = rows.reduce((best, row) => Number.isFinite(row[key]) && (!best || row[key] > best[key]) ? row : best, null);
  const unit = kind === 'solar' ? 'kWh/m²' : 'm/s';
  return (
    <section className="card chart-card">
      <div className="chart-heading">
        <h2><Icon name="sun" /> Solar and wind by month</h2>
        <span className="unit">{unit}</span>
      </div>
      <div className="chart-toolbar">
        <p>{kind === 'solar' ? 'Average monthly sunlight' : 'Average wind at 100 m'}</p>
        <Toggle label="Resource series" options={[['solar', 'Solar'], ['wind', 'Wind']]} current={kind} onChange={setKind} />
      </div>
      {peak ? <>
        <SeasonalChart rows={rows} kind={kind} peakMonth={peak.month} />
        <p className="chart-note">Highest monthly average <strong>{months[peak.month - 1]} · {number(peak[key], unit)}</strong>.</p>
      </> : <p className="chart-placeholder">Monthly resource data unavailable.</p>}
    </section>
  );
}

export default function Analysis({ site, onChooseSite, shortlist, onAdd, onRemove, onMapRadius }) {
  const [tab, setTab] = useState(site.index === undefined ? 'area' : 'site');
  const [radius, setRadius] = useState(100);
  const [compareMode, setCompareMode] = useState('reference');
  const added = shortlist.some(candidate => selectionKey(candidate) === selectionKey(site));
  const mapRadius = tab === 'area' || (tab === 'compare' && compareMode.endsWith('area')) ? radius : 0;
  useEffect(() => {
    onMapRadius(mapRadius ? { radius: mapRadius, compare: tab === 'compare' } : null);
    return () => onMapRadius(null);
  }, [mapRadius, tab, onMapRadius]);
  const [wind, setWind] = useState('gwa');
  const [exact, setExact] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const exactSite = useRef(null);
  const panel = useRef(null);
  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [site]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let local;
    const useExact = exact && exactSite.current === site;
    async function load() {
      try {
        local = await getSiteReport(site, wind, signal);
        if (signal.aborted) return;
        if (useExact) {
          const exactReport = await getExactReport(site, wind, signal);
          if (!signal.aborted) setResult({ site, wind, attempt, report: exactReport });
        } else setResult({ site, wind, attempt, report: local });
      } catch {
        if (!signal.aborted) setResult({ site, wind, attempt, report: local, error: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [site, wind, exact, attempt]);

  const current = result?.site === site && result.wind === wind && result.attempt === attempt ? result : null;
  const report = current?.report;
  const location = regionName(report?.region?.name) ?? site.region;
  const period = report?.meta?.historical_period?.map(date => date.slice(0, 4)).join('–');
  const legacy = '/legacy/index.html?' + new URLSearchParams({
    lat: site.latitude, lon: site.longitude, wind,
    ...(site.index === undefined ? {} : { marker: site.index }),
  });

  function requestExact() {
    exactSite.current = site;
    setExact(true);
    setAttempt(value => value + 1);
  }

  return (
    <section className="analysis-panel" aria-label="Site analysis" ref={panel}>
      <header className="site-heading">
        <p className="eyebrow"><span className="signal-dot" /> Data center site analysis</p>
        <h1>{site.name ?? location}</h1>
        <p>{site.name && site.name !== location ? location + ', Finland' : 'Finland'}</p>
      </header>

      <div className="analysis-navigation">
        <div className="toggle" role="group" aria-label="Analysis view">
          <button aria-pressed={tab === 'site'} onClick={() => setTab('site')}>Site</button>
          <button aria-pressed={tab === 'area'} onClick={() => setTab('area')}>Area</button>
          <button aria-pressed={tab === 'compare'} onClick={() => setTab('compare')}>Compare ({shortlist.length})</button>
        </div>
        <button className="back-button add-site" disabled={added || shortlist.length >= 3}
          title={!added && shortlist.length >= 3 ? 'Remove a comparison site before adding another' : undefined}
          onClick={() => { onAdd(site); setTab('compare'); }}>
          <Icon name="plus" />{added ? 'Added to comparison' : 'Add to comparison'}
        </button>
      </div>

      {tab === 'area' && <AreaAnalysis site={site} wind={wind} radius={radius} onRadius={setRadius} />}
      {tab === 'compare' && <Comparison candidates={shortlist} remove={onRemove} wind={wind}
        mode={compareMode} onMode={setCompareMode} radius={radius} onRadius={setRadius} />}

      {tab === 'site' && report && <>
        <div className="scope">
          <p className="scope-title">{{ region: 'Regional reference', archive: 'Archived point data', point: 'Point analysis' }[report.mode]}</p>
          {report.mode === 'region' && Number.isFinite(report.ranking.lat) && Number.isFinite(report.ranking.lon) &&
            <p>Data from {coordinates(report.ranking.lat, report.ranking.lon)}</p>}
          {period && <p className="scope-period">Climate record {period}</p>}
        </div>
        <Score report={report} onChooseSite={onChooseSite} />
        <Measurements report={report} />
        {Number.isFinite(report.hydro?.nearest_surface_sample_km) && (
          <p className="decision-note">Near this data reference, the closest mapped water sample is a {report.hydro.nearest_surface_type} at {number(report.hydro.nearest_surface_sample_km, 'km')}. This layer is for context and does not affect the score.</p>
        )}
        <div className="chart-grid">
          <Temperature report={report} />
          <Seasonality report={report} />
        </div>
        <p className="decision-note">Use the score to shortlist sites. A build decision also depends on grid capacity, fiber connectivity, land and permits.</p>
      </>}

      {tab === 'site' && !current && <div className="card" role="status">{exact && exactSite.current === site ? 'Analyzing selected coordinates…' : 'Loading site statistics…'}</div>}
      {tab === 'site' && current?.error && <div className="card" role="status">
        <p>{report ? 'Point service unavailable. Showing the bundled data.' : 'Site statistics could not be loaded.'}</p>
        <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      </div>}

      <div className="analysis-tools">
        <label className="wind-picker">
          <span>Wind dataset</span>
          <select value={wind} onChange={event => setWind(event.target.value)}>
            <option value="gwa">Global Wind Atlas</option>
            <option value="merra2">NASA MERRA-2</option>
          </select>
        </label>
        {tab === 'site' && <button className="text-button exact-button" onClick={requestExact} disabled={!current}>Analyze exact coordinates <Icon name="right" /></button>}
        {tab === 'site' && <a className="text-button" href={legacy}>Regional report &amp; CSV downloads <Icon name="upRight" /></a>}
      </div>
    </section>
  );
}
