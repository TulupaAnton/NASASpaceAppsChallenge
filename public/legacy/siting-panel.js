import { finlandRegionId, loadFinlandRegion, loadFinlandCatalog, finlandHistoryCsvUrl, loadFinlandHistory } from './finland-data.js';
import { loadCachedPoint } from './point-api.js';

const one = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const two = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const powerVariables = [
  ['T2M', 'Mean air temperature at 2 m', '°C'],
  ['T2M_MAX_AVG', 'Average daily high at 2 m', '°C'],
  ['T2M_MAX', 'Maximum air temperature at 2 m', '°C'],
  ['T2MWET', 'Wet-bulb temperature at 2 m', '°C'],
  ['RH2M', 'Relative humidity at 2 m', '%'],
  ['WS10M', 'Wind speed at 10 m', 'm/s'],
  ['WS50M', 'Wind speed at 50 m', 'm/s'],
  ['ALLSKY_SFC_SW_DWN', 'All-sky surface solar irradiation', 'kWh/m²/day'],
  ['CLRSKY_SFC_SW_DWN', 'Clear-sky surface solar irradiation', 'kWh/m²/day'],
  ['PRECTOTCORR', 'Corrected precipitation rate', 'mm/day'],
];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const xIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>';
const arrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4"/></svg>';
const external = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 14 14 6M7 6h7v7"/></svg>';
const target = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.6"/><path d="M10 1.5v3m0 11v3M1.5 10h3m11 0h3"/></svg>';

function safe(value = '') {
  const symbols = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, char => symbols[char]);
}

const finite = Number.isFinite;
const num = (v, unit = '', formatter = one) => finite(v) ? `${formatter.format(v)}${unit ? ` ${unit}` : ''}` : '—';
const sign = (v, unit = '') => finite(v) ? `${v > 0 ? '+' : ''}${num(v, unit, two)}` : '—';
const coords = (lat, lon, digits = 5) => finite(lat) && finite(lon)
  ? `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'} · ${Math.abs(lon).toFixed(digits)}° ${lon < 0 ? 'W' : 'E'}` : 'Coordinates unavailable';
const timeSpan = (values = []) => [values[0]?.slice(0, 4), values[1]?.slice(0, 4)].filter(Boolean).join('–') || '—';
const list = (items = []) => items.map(x => `<li>${safe(typeof x === 'string' ? x : x.text)}</li>`).join('');

function pointData(raw, mode) {
  const input = raw.point_input ?? {};
  const row = raw.point_ranking;
  if (!row || !raw.point_charts) return null;
  return {
    mode, partial: raw.partial === true, chart: raw.point_charts, count: raw.total_ranked,
    meta: raw.frontend?.meta ?? raw.meta ?? {},
    ranking: {
      ...row, lat: input.lat ?? row.lat, lon: input.lon ?? row.lon,
      extra_metrics: { ...row.extra_metrics, ...input.extra_metrics }, sources: row.sources ?? input.sources,
      water: input.water ?? row.water,
    },
  };
}

const regionData = data => data?.ranking ? { ...data, mode: 'regional', count: data.meta?.ranked_sites } : null;
function kind(data) {
  if (data?.partial) return 'Archived point · Water unavailable';
  if (data?.mode === 'cached') return 'Archived point analysis';
  if (data?.mode === 'online') return 'API point analysis';
  return 'Regional reference';
}

function rows(items) {
  return `<dl class="sp-rows">${items.map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join('')}</dl>`;
}

function bars(scores = {}) {
  const fields = [['Climate', 'climate'], ['Renewables', 'renewables'], ['Water', 'water']];
  return `<div class="sp-bars">${fields.filter(([, key]) => finite(scores[key])).map(([name, key]) => {
    const value = Math.max(0, Math.min(100, scores[key]));
    return `<div class="sp-bar sp-${key}"><div><span>${name}</span><b>${num(value)}</b></div><i><i style="width:${value}%"></i></i></div>`;
  }).join('')}</div>`;
}

function statusFor(row) {
  const water = row.water ?? {};
  const extra = row.extra_metrics ?? {};
  const source = String(water.source ?? extra.water_source ?? row.sources?.water ?? '');
  if (/fallback|assum|default/i.test(source) || water.status === 'fallback') return 'Water indicators include modeled fallback values.';
  return '';
}

function makeChart(targetNode, {title, labels, ticks, series, unit = '', split, small = false, axisLabels}) {
  const count = labels.length;
  const values = series.flatMap(x => x.values.filter(finite));
  if (count < 2 || !values.length) {
    targetNode.innerHTML = '<p class="sp-dim">Series unavailable in this dataset.</p>';
    return;
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * .09, (high === low ? 1 : 0));
  const min = low - padding;
  const max = high + padding;
  const width = small ? 360 : 647, height = small ? 150 : 234;
  const left = 43, right = width - 13, top = 13, bottom = height - 26;
  const px = i => left + (right - left) * i / (count - 1);
  const py = v => bottom - (bottom - top) * (v - min) / (max - min);
  const steps = [0, 1, 2, 3, 4].map(n => {
    const value = min + (max - min) * n / 4;
    const y = py(value).toFixed(1);
    return `<path class="sp-grid" d="M${left} ${y}H${right}"/><text x="${left - 7}" y="${y}" text-anchor="end" dominant-baseline="middle">${num(value)}</text>`;
  }).join('');
  const axis = ticks.map(i => `<text x="${px(i).toFixed(1)}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}">${safe(axisLabels?.(i) ?? labels[i])}</text>`).join('');
  const paths = series.map(item => {
    let line = false;
    const path = item.values.map((value, i) => {
      if (!finite(value)) { line = false; return ''; }
      const prefix = line ? 'L' : 'M';
      line = true;
      return `${prefix}${px(i).toFixed(1)} ${py(value).toFixed(1)}`;
    }).join('');
    return `<path class="sp-line sp-tone-${item.tone}" d="${path}"${item.dashed ? ' stroke-dasharray="6 5"' : ''}/>`;
  }).join('');
  const future = Number.isFinite(split) ? `<rect class="sp-future" x="${px(split)}" y="${top}" width="${right-px(split)}" height="${bottom-top}"/><path class="sp-divider" d="M${px(split)} ${top}V${bottom}"/>` : '';
  const legend = series.map(item => `<span><i class="sp-tone-${item.tone}${item.dashed ? ' sp-dash' : ''}"></i>${safe(item.name)}</span>`).join('');
  targetNode.innerHTML = `<figure class="sp-figure${small ? ' sp-small' : ''}"><figcaption>${legend}${unit ? `<b>${safe(unit)}</b>` : ''}</figcaption>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${safe(title)}" preserveAspectRatio="xMidYMid meet"><title>${safe(title)}</title>${future}${steps}${paths}${axis}<path class="sp-cursor" stroke-dasharray="3 3" data-guide/><g data-dots></g></svg>
    <label class="sp-chart-control"><span data-chart-label></span><input type="range" min="0" max="${count - 1}" step="1" aria-label="${safe(title)} data point"></label>
    <p class="sp-chart-readout" data-chart-readout></p></figure>`;
  const svg = targetNode.querySelector('svg');
  const input = targetNode.querySelector('input');
  const guide = targetNode.querySelector('[data-guide]');
  const dots = targetNode.querySelector('[data-dots]');
  const label = targetNode.querySelector('[data-chart-label]');
  const readout = targetNode.querySelector('[data-chart-readout]');
  function seek(index) {
    const x = px(index);
    input.value = index;
    input.setAttribute('aria-valuetext', labels[index]);
    guide.setAttribute('d', `M${x} ${top}V${bottom}`);
    dots.innerHTML = series.filter(item => finite(item.values[index])).map(item =>
      `<circle class="sp-tone-${item.tone}" cx="${x}" cy="${py(item.values[index])}" r="3.2"/>`).join('');
    label.textContent = labels[index];
    readout.textContent = series.filter(item => finite(item.values[index])).map(item =>
      `${item.name}: ${num(item.values[index], unit, two)}`).join(' · ');
  }
  seek(Number.isFinite(split) ? Math.floor(split) : count - 1);
  input.addEventListener('input', () => seek(Number(input.value)));
  svg.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const rect = svg.getBoundingClientRect();
    const local = (event.clientX - rect.left) * width / rect.width;
    seek(Math.max(0, Math.min(count - 1, Math.round((local - left) / (right - left) * (count - 1)))));
  });
}

function sectionsOverview(data) {
  const row = data.ranking, s = row.scores ?? {}, m = row.measurements ?? {}, e = row.extra_metrics ?? {};
  const insight = row.insight ?? {};
  const weight = insight.effective_weights ?? data.meta?.weights ?? {};
  const scoreWeights = ['climate', 'renewables', 'water'].filter(key => finite(weight[key]))
    .map(key => `${key[0].toUpperCase() + key.slice(1)} ${one.format(weight[key] * 100)}%`).join(' · ');
  const source = Object.entries(row.sources ?? {}).map(([key, value]) => `<dt>${safe(key)}</dt><dd>${safe(value)}</dd>`).join('');
  const sensitivity = row.sensitivity ?? {};
  const featureRows = [
    ['Scenario mean air temperature', num(m.scenario_mean_temp_c, '°C')],
    ['Cooling pressure (scenario)', num(m.scenario_avg_cooling_pressure_dd10, 'DD10/year')],
    ['Warmest-month average daily high', num(m.scenario_avg_warmest_month_maxavg_c, '°C')],
    ['Annual solar irradiation', num(m.solar_ghi_kwh_m2_year, 'kWh/m²')],
    ['Clear-sky annual solar', num(e.clrsky_solar_ghi_kwh_m2_year, 'kWh/m²')],
    ['Solar loss from clouds', num(e.cloud_solar_loss_pct, '%')],
    ['Wind speed at 100 m', num(m.wind_speed_100m_ms, 'm/s')],
    ['Wind density at 100 m', num(m.wind_power_density_w_m2, 'W/m²')],
    ['Wind speed at 50 m', num(e.ws50m_mean_ms, 'm/s')],
    ['Wind speed at 10 m', num(e.ws10m_mean_ms, 'm/s')],
    ['Terrain elevation', num(e.elevation_m, 'm')],
    ['Terrain slope', num(m.slope_deg, '°')],
    ['Annual precipitation', num(e.prectotcorr_mm_year, 'mm')],
    ['Relative humidity', num(e.rh2m_mean_pct, '%')],
    ['Wet-bulb temperature', num(e.t2mwet_mean_c, '°C')],
    ['Highest recorded monthly peak', num(e.t2m_max_abs_c, '°C')],
  ];
  const waterDistance = m.water_distance_km ?? row.water?.water_distance_km ?? e.water_distance_km;
  const waterFlow = m.water_discharge_m3s ?? row.water?.water_discharge_m3s ?? e.water_discharge_m3s;
  const waterNote = statusFor(row);
  const terrainFallback = /fallback|assum|default/i.test(row.sources?.terrain ?? '');
  const waterDisplay = waterDistance === 20 ? 'None detected within 12 km' : num(waterDistance, 'km');
  const waterBody = `<section class="sp-section">
      <h3>Water and terrain</h3>
      ${rows([['Distance to detected water', waterDisplay], ['Estimated river discharge', num(waterFlow, 'm³/s')], ['Terrain elevation', num(e.elevation_m, 'm')], ['Terrain slope', num(m.slope_deg, '°')]])}
      <p>${safe(finite(waterDistance) || finite(waterFlow) ? 'Water indicators estimate proximity and streamflow. Water rights, usable volume and flood exposure need separate checks.' : 'This analysis has no water indicators.')}</p>
      ${waterNote ? `<p>${safe(waterNote)}</p>` : ''}
      ${terrainFallback ? '<p>Terrain uses a fallback estimate because the elevation source was unavailable.</p>' : ''}
    </section>`;
  return `<div class="sp-report-grid">
    ${data.partial ? `<section class="sp-section"><h3>Archived observations</h3><p>Water measurements are unavailable for this archive point. A comparable overall score and rank are unavailable.</p></section>` : `<section class="sp-section">
      <h3>Overall score</h3><div class="sp-big"><b>${num(s.overall)}<small> / 100</small></b><span>${finite(data.count) && data.count > 1 ? `Rank ${safe(row.rank)} of ${safe(data.count)}` : 'Single-point physical reference'}</span></div>
      ${bars(s)}
      ${rows([['Cooling', num(s.cooling)], ['Summer heat', num(s.summer_heat)], ['Solar', num(s.solar)], ['Wind', num(s.wind)], ['Water proximity', num(s.water_distance)], ['Water discharge', num(s.water_discharge)], ['Rank across alternate weights', finite(sensitivity.best_rank) && data.count > 1 ? `${sensitivity.best_rank}–${sensitivity.worst_rank}` : '—']])}
      <p>${safe(scoreWeights)}</p>
      <p>DD10 measures temperature pressure above 10 °C. Lower was favored in the screening.</p>
    </section>`}
    ${waterBody}
    <section class="sp-section sp-wide">
      <h3>Climate and resource measurements</h3><div class="sp-details-grid">${rows(featureRows.slice(0, 8))}${rows(featureRows.slice(8))}</div>
    </section>
    <section class="sp-section sp-wide">
      <h3>What the screening shows</h3><p>The score describes relative climate and resource indicators. A build decision also needs grid and backup power, land, permits, flood exposure and cost checks.</p>
      <div class="sp-reason-grid">
        ${insight.strengths?.length ? `<div><h4>Strengths</h4><ul>${list(insight.strengths)}</ul></div>` : ''}
        ${insight.limitations?.length ? `<div><h4>Limitations</h4><ul>${list(insight.limitations)}</ul></div>` : ''}
        ${insight.mandatory_checks?.length ? `<div><h4>Further checks</h4><ul>${list(insight.mandatory_checks)}</ul></div>` : ''}
      </div>
    </section>
    <section class="sp-section sp-wide">
      <h3>Data and methodology</h3>
      <dl class="sp-sources">${source}</dl>
      <p>${safe(data.meta?.score_type ?? '')}</p>
      <p>${safe(data.meta?.calibration_status ?? '')}</p>
      ${Array.isArray(data.meta?.assumptions) ? `<details><summary>Model assumptions</summary><ul>${list(data.meta.assumptions)}</ul></details>` : ''}
      <div class="sp-downloads"></div>
    </section>
  </div>`;
}

function showHistory(node, data, plotMode, setMode) {
  const { chart, ranking, meta } = data;
  const history = chart.historical_monthly ?? [], scenario = chart.scenario_monthly ?? [];
  const decades = chart.scenario_year_blocks ?? [];
  const trend = ranking.trend ?? {}, v = ranking.validation ?? {};
  const held = v.heldout_monthly ?? [];
  const ci = trend.slope_95ci_c_per_decade ?? [];
  const p = finite(trend.p_value)
    ? `${trend.p_value < .001 ? 'p < 0.001' : `p = ${trend.p_value.toFixed(3)}`} · ${trend.significant_p05 ? 'Significant at 5%' : 'Not significant at 5%'}` : 'Significance unavailable';
  node.innerHTML = `<div class="sp-report-grid">
    <section class="sp-section sp-wide">
      <div class="sp-section-head"><div><h3>Historical climate and scenario</h3><p>${safe(timeSpan(meta?.historical_period ?? [history[0]?.date, history.at(-1)?.date]))} historical · ${safe(timeSpan(meta?.scenario_period ?? [scenario[0]?.date,scenario.at(-1)?.date]))} scenario</p></div>
      <label class="sp-field"><span>Temperature view</span><select data-mode><option value="temp">Monthly temperature</option><option value="anomaly">Monthly anomaly</option></select></label></div>
      <div data-climate></div><p>The future series extends the historical fit as an illustrative scenario. It is separate from the historical record.</p>
    </section>
    <section class="sp-section">
      <h3>Historical warming trend</h3><div class="sp-big"><b>${safe(sign(trend.slope_c_per_decade,'°C/decade'))}</b></div>
      <p>${safe(p)}</p>
      ${rows([['95% slope interval', ci.length ? `${sign(ci[0])} to ${sign(ci[1])} °C/decade` : '—'], ['Historical months', num(trend.n_months)]])}
      <p>${safe(trend.method ?? '')}</p>
    </section>
    <section class="sp-section"><h3>Annual modeled temperatures</h3><div data-years></div></section>
    <section class="sp-section sp-wide"><h3>Annual cooling pressure</h3><div data-cooling></div><p>Degree-days above 10 °C, estimated from modeled monthly mean temperatures.</p></section>
    <section class="sp-section sp-wide"><h3>Held-out validation</h3>
      ${rows([['Training period', timeSpan(v.train_period)], ['Testing period', timeSpan(v.test_period)], ['Trend model · mean absolute error', num(v.monthly_mae_trend_c,'°C',two)], ['Seasonal baseline · mean absolute error', num(v.monthly_mae_seasonal_baseline_c,'°C',two)]])}
      ${typeof v.trend_better_than_seasonal_baseline === 'boolean' ? `<p>${v.trend_better_than_seasonal_baseline ? 'The trend model had lower error than the seasonal baseline.' : 'The seasonal baseline was at least as accurate as the trend model.'}</p>` : ''}
      <div data-held></div>
    </section>
  </div>`;
  const select = node.querySelector('[data-mode]');
  const all = [...history, ...scenario];
  const yearTicks = (arr, years = 1) => arr.reduce((out, row, i) => {
    if (!i || row.date?.endsWith('-01') && Number(row.date.slice(0, 4)) % years === 0) out.push(i);
    return out;
  }, []);
  function drawHistory(mode) {
    const suffix = mode === 'anomaly' ? 'anomaly_c' : 't2m_c';
    const fit = mode === 'anomaly' ? 'deseasonalized_trend_c' : 'seasonal_trend_c';
    const pad = (rows, key, offset) => all.map((_, i) => rows[i - offset]?.[key]);
    makeChart(node.querySelector('[data-climate]'), {
      title: mode === 'anomaly' ? 'Monthly temperature anomalies' : 'Monthly air temperature',
      labels: all.map(row => row.date), ticks: yearTicks(all, 5), unit: '°C',
      split: history.length && scenario.length ? history.length - .5 : undefined,
      series: [
        { name: mode === 'anomaly' ? 'Historical anomaly' : 'Historical NASA POWER', tone: 'mint', values: pad(history,suffix,0) },
        { name:'Historical fitted trend', tone:'silver', values: pad(history,fit,0) },
        { name:'Illustrative scenario', tone:'gold', dashed: true, values: pad(scenario,suffix,history.length) },
      ],
    });
  }
  select.value = plotMode;
  drawHistory(plotMode);
  select.addEventListener('change', () => { setMode(select.value); drawHistory(select.value); });
  makeChart(node.querySelector('[data-years]'), {
    title: 'Scenario annual mean temperature', unit: '°C', small:true,
    labels:decades.map(row => row.start_month?.slice(0,4)), ticks:decades.map((_,i) => i).filter(i => i % 2 === 0 || i === decades.length - 1),
    series:[{name:'Scenario annual mean',tone:'gold',dashed:true,values:decades.map(row=>row.mean_temp_c)}],
  });
  makeChart(node.querySelector('[data-cooling]'), {
    title: 'Scenario annual cooling pressure above 10 °C', unit: 'DD10',
    labels: decades.map(row => row.start_month?.slice(0,4)), ticks: decades.map((_,i) => i).filter(i => i % 2 === 0 || i === decades.length - 1),
    series: [{name:'Scenario cooling pressure',tone:'gold',dashed:true,values:decades.map(row=>row.cooling_pressure_dd10)}],
  });
  makeChart(node.querySelector('[data-held]'), {
    title:'Held-out historical temperature validation', unit:'°C',
    labels:held.map(row=>row.date),ticks:yearTicks(held),
    series:[
      {name:'Held-out historical values',tone:'mint',values:held.map(row=>row.observed_c)},
      {name:'Trend model',tone:'gold',values:held.map(row=>row.model_c)},
      {name:'Seasonal baseline',tone:'silver',dashed:true,values:held.map(row=>row.seasonal_baseline_c)},
    ],
  });
}

function showSeason(node, data) {
  const input = data.chart.monthly_climatology ?? [];
  const extra = data.ranking.extra_metrics ?? {};
  const supportsWater = Array.isArray(extra.water_monthly_m3s);
  const series = (key, name, tone = 'mint') => ({ name, tone, values: input.map(row => row[key]) });
  const plots = [
    ['Air temperature','°C', [series('mean_t2m_c','Mean temperature'),series('mean_t2m_max_avg_c','Average daily high','gold'),{name:'Wet-bulb temperature',tone:'silver',values:extra.t2mwet_monthly_c ?? []}]],
    ['Solar irradiation','kWh/m²', [series('solar_kwh_m2','Monthly irradiation','gold')]],
    ['Wind at 100 m','m/s', [series('wind_speed_100m_ms','Mean wind speed')]],
    ['Relative humidity','%', [{name:'Average relative humidity',tone:'blue',values:extra.rh2m_monthly_pct ?? []}]],
  ];
  if (supportsWater) plots.push(['River discharge','m³/s',[{name:'Mean discharge',tone:'blue',values:extra.water_monthly_m3s}]]);
  node.innerHTML = `<div class="sp-report-grid">${plots.map(([title],i) => `<article class="sp-section"><h3>${title}</h3><div data-plot="${i}"></div></article>`).join('')}</div>`;
  plots.forEach(([title,unit,series],i) => makeChart(node.querySelector(`[data-plot="${i}"]`),
    {title,unit,series,labels:months,ticks:[0,2,4,6,8,11],small:true}));
}

function showPowerHistory(node, historical, initial, setVariable) {
  const { monthly } = historical;
  const options = powerVariables.map(([id, label]) => `<option value="${id}">${safe(label)} (${id})</option>`).join('');
  node.innerHTML = `<section class="sp-section">
    <div class="sp-section-head"><div><h3>NASA POWER monthly history</h3><p>${safe(timeSpan([monthly[0]?.date, monthly.at(-1)?.date]))} · Cleaned regional reference data</p></div>
    <label class="sp-field"><span>Climate variable</span><select data-variable>${options}</select></label></div>
    <div data-power-plot></div><p>These series use the regional reference data. Multiple sampling locations are combined for some regions.</p>
  </section>`;
  const control = node.querySelector('[data-variable]');
  const chart = node.querySelector('[data-power-plot]');
  control.value = initial;
  function draw() {
    const [id, label, unit] = powerVariables.find(([code]) => code === control.value);
    const ticks = monthly.reduce((indices, row, i) => {
      const date = row.date ?? '';
      if (i === 0 || date.slice(5, 7) === '01' && Number(date.slice(0, 4)) % 10 === 0) indices.push(i);
      return indices;
    }, []);
    makeChart(chart, { title: label, unit, series: [{name:label,tone:'mint',values:monthly.map(row=>row[id])}], labels:monthly.map(row=>row.date?.slice(0,7) ?? ''), ticks, axisLabels: index=>monthly[index].date.slice(0,4) });
  }
  draw();
  control.addEventListener('change', () => { setVariable(control.value); draw(); });
}

function comparison(catalog, siteId) {
  const ranking = [...(catalog.ranking ?? [])].sort((a,b) => a.rank - b.rank);
  const water = ranking.some(row => finite(row.scores?.water));
  return `<section class="sp-section"><h3>Compare Finland’s ${ranking.length} regions</h3><p>Baseline regional rankings use Global Wind Atlas. An archived or online point may use a separate candidate set.</p>
    <div class="sp-table-wrap" tabindex="0" role="region" aria-label="Regional rankings table"><table><thead><tr><th scope="col">Rank</th><th scope="col">Region</th><th scope="col">Overall</th><th scope="col">Climate</th><th scope="col">Renewables</th>${water ? '<th scope="col">Water</th>' : ''}</tr></thead><tbody>
      ${ranking.map(row => `<tr${row.site_id === siteId ? ' class="sp-selected-row"' : ''}><td>${safe(row.rank)}</td><th scope="row">${safe(row.region)}</th><td>${num(row.scores?.overall)}</td><td>${num(row.scores?.climate)}</td><td>${num(row.scores?.renewables)}</td>${water ? `<td>${num(row.scores?.water)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div></section>`;
}

export function createSitingPanel(element, {pointApi, onClose} = {}) {
  element.classList.add('sp-panel');
  element.innerHTML = `<div class="sp-card">
    <div class="sp-card-head"><div class="sp-locator">${target}</div><div><p class="sp-kicker" data-kind></p><h1 data-title>Site analysis</h1></div><button type="button" class="sp-icon" aria-label="Close site analysis" data-close>${xIcon}</button></div>
    <p class="sp-coords" data-coords></p>
    <div data-score aria-live="polite"></div>
    <div class="sp-card-controls">
      <button type="button" class="sp-action" data-details disabled>Explore data ${arrow}</button></div>
    ${pointApi ? '<button type="button" class="sp-link-button" data-exact>Analyze exact point online</button>' : ''}
    <p class="sp-notice" data-notice role="status" hidden></p>
  </div>`;
  const dialog = document.createElement('dialog');
  dialog.className = 'sp-dialog';
  dialog.setAttribute('aria-labelledby', 'sp-report-title');
  dialog.innerHTML = `<div class="sp-report">
    <div class="sp-dialog-head"><div class="sp-locator">${target}</div><div><p class="sp-kicker" data-report-kind></p><h2 id="sp-report-title"></h2><p class="sp-coords" data-report-coords></p></div><button class="sp-icon" type="button" aria-label="Close detailed analysis" data-dialog-close>${xIcon}</button></div>
    <div class="sp-dialog-controls"><nav aria-label="Analysis views">
      <button type="button" data-view="summary" aria-pressed="true">Overview</button><button type="button" data-view="history" aria-pressed="false">Climate trend</button>
      <button type="button" data-view="season" aria-pressed="false">Seasonality</button><button type="button" data-view="power" aria-pressed="false">NASA POWER history</button><button type="button" data-view="compare" aria-pressed="false">Compare regions</button>
    </nav></div>
    <div class="sp-report-content" data-body tabindex="0" role="region" aria-label="Detailed site data"></div>
  </div>`;
  document.body.append(dialog);
  const get = (attr, node = element) => node.querySelector(`[data-${attr}]`);
  const reportBody = get('body', dialog);
  const viewButtons = [...dialog.querySelectorAll('[data-view]')];
  const details = get('details');
  const exact = get('exact');
  let point = null, data = null, view = 'summary', plotMode = 'temp', powerVariable = 'T2M';
  let version = 0, viewVersion = 0, controller;

  function message(text = '') {
    const notice = get('notice');
    notice.textContent = text;
    notice.hidden = !text;
  }

  function card() {
    get('kind').textContent = kind(data);
    get('title').textContent = point.name || point.region || 'Finland';
    get('coords').textContent = coords(point.latitude, point.longitude);
    details.disabled = !data;
    if (!data) return;
    const row = data.ranking, s = row.scores ?? {}, m = row.measurements ?? {};
    const subtitle = data.mode === 'regional'
      ? `${row.region} reference · ${coords(row.lat, row.lon, 2)}`
      : `Point data · ${coords(row.lat, row.lon, 4)}`;
    const score = data.partial ? '<p class="sp-notice">Overall score unavailable without water data.</p>' : `<div class="sp-card-score">
      <div><span>Overall score</span><b>${num(s.overall)}<small> / 100</small></b></div>
      <div><span>${data.count > 1 ? 'Cohort rank' : 'Scoring mode'}</span><b>${data.count > 1 ? `${safe(row.rank)}<small> / ${safe(data.count)}</small>` : '<small>Point reference</small>'}</b></div>
      </div>${bars(s)}`;
    const fallback = statusFor(row) || (/fallback/i.test(row.sources?.terrain ?? '') ? 'Terrain indicators use a fallback estimate.' : '');
    get('score').innerHTML = `<p class="sp-reference">${safe(subtitle)}</p>${score}
      <div class="sp-quick">
        <div><span>Cooling pressure</span><b>${num(m.scenario_avg_cooling_pressure_dd10,'DD10/yr')}</b></div>
        <div><span>Annual solar</span><b>${num(m.solar_ghi_kwh_m2_year,'kWh/m²')}</b></div>
        <div><span>Wind speed at 100 m</span><b>${num(m.wind_speed_100m_ms,'m/s')}</b></div>
        <div><span>Detected water</span><b>${m.water_distance_km === 20 ? 'Beyond survey' : num(m.water_distance_km,'km')}</b></div>
      </div>${fallback ? `<p class="sp-notice">${safe(fallback)}</p>` : ''}`;

  }

  async function report() {
    if (!dialog.open || !data) return;
    const current = ++viewVersion;
    const here = point;
    dialog.querySelector('#sp-report-title').textContent = here.name || here.region || 'Finland';
    get('report-kind',dialog).textContent = kind(data);
    get('report-coords',dialog).textContent = data.mode === 'regional'
      ? `${coords(here.latitude, here.longitude)} · Regional reference: ${coords(data.ranking.lat, data.ranking.lon, 2)}`
      : coords(here.latitude, here.longitude);
    viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    const siteId = here.siteId || finlandRegionId(here.region);
    if (view === 'summary') {
      reportBody.innerHTML = sectionsOverview(data);
      const links = reportBody.querySelector('.sp-downloads');
      if (siteId) {
        for (const [type, name] of [['annual','Regional annual history (CSV)'],['monthly','Regional monthly history (CSV)']]) {
          const href = finlandHistoryCsvUrl(siteId, type);
          if (href) links.insertAdjacentHTML('beforeend', `<a href="${safe(href)}" download>${name} ${external}</a>`);
        }
      }
      links.insertAdjacentHTML('beforeend', `<a href="data-package.html">Source archive and frontend guide ${external}</a>`);
    } else if (view === 'history') {
      showHistory(reportBody, data, plotMode, mode => { plotMode = mode; });
    } else if (view === 'season') {
      showSeason(reportBody, data);
    } else if (view === 'power') {
      if (!siteId) {
        reportBody.innerHTML = '<p role="status">Regional history is unavailable for this selection.</p>';
        return;
      }
      reportBody.innerHTML = '<p role="status">Loading NASA POWER history…</p>';
      try {
        const raw = await loadFinlandHistory(siteId);
        if (current === viewVersion && dialog.open) showPowerHistory(reportBody, raw, powerVariable, value => { powerVariable = value; });
      } catch {
        if (current === viewVersion && dialog.open) reportBody.innerHTML = '<p role="status">Regional climate history could not be loaded.</p>';
      }
    } else {
      reportBody.innerHTML = '<p role="status">Loading regional rankings…</p>';
      try {
        const catalog = await loadFinlandCatalog();
        if (current === viewVersion && dialog.open) reportBody.innerHTML = comparison(catalog, siteId);
      } catch {
        if (current === viewVersion && dialog.open) reportBody.innerHTML = '<p role="status">Regional rankings could not be loaded.</p>';
      }
    }
  }

  async function load(online = false) {
    const current = ++version, selected = point;
    viewVersion++;
    controller?.abort();
    controller = new AbortController();
    const {signal} = controller;
    if (exact) exact.disabled = online;
    if (online) message('Analyzing this point online…');
    else {
      data = null;
      message();
      card();
      get('score').innerHTML = '<p class="sp-loading">Loading site analysis…</p>';
      if (dialog.open) reportBody.textContent = 'Loading site analysis…';
    }
    try {
      let result;
      if (online) {
        const response = await pointApi.getPoint({
          latitude:selected.latitude, longitude:selected.longitude, includeBaseline:true,
        }, {signal});
        result = pointData(response,'online');
      } else {
        let archived;
        try {
          archived = await loadCachedPoint(selected.latitude,selected.longitude,{signal});
        } catch (error) {
          if (signal.aborted) return;
        }
        if (archived) result = pointData(archived,'cached');
        const id = selected.siteId || finlandRegionId(selected.region);
        if (!result && id) result = regionData(await loadFinlandRegion(id));
      }
      if (current !== version || signal.aborted) return;
      if (!result) throw new Error('Data unavailable');
      data = result;
      card();
      report();
      const used = data.ranking.extra_metrics?.wind_source_used;
      if (data.mode !== 'regional' && used === 'merra2') message('Wind estimate uses the NASA MERRA-2 fallback.');
      else message();
    } catch {
      if (current !== version || signal.aborted) return;
      if (online && data) message('The point service is unavailable. Showing the last loaded analysis.');
      else {
        get('score').innerHTML = '<button class="sp-link-button" type="button" data-retry>Retry loading the dataset</button>';
        get('retry').addEventListener('click', () => load());
        message('Data for this selection is unavailable.');
        if (dialog.open) reportBody.textContent = 'The selected dataset could not be loaded.';
      }
    } finally {
      if (current === version && exact) exact.disabled = false;
    }
  }

  function close() {
    controller?.abort();
    version++;
    viewVersion++;
    if (dialog.open) dialog.close();
    point = null;
    data = null;
    element.hidden = true;
  }

  get('close').addEventListener('click', () => {
    close();
    if (onClose) onClose();
    document.getElementById('map')?.focus({preventScroll:true});
  });
  get('dialog-close',dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  function openReport() {
    dialog.querySelector('#sp-report-title').textContent = point.name || point.region || 'Finland';
    if (!data) reportBody.textContent = 'Loading site analysis…';
    dialog.showModal();
    reportBody.scrollTop = 0;
    report();
  }
  details.addEventListener('click', openReport);
  viewButtons.forEach(button => button.addEventListener('click', () => {
    view = button.dataset.view;
    reportBody.scrollTop = 0;
    report();
  }));
  exact?.addEventListener('click', () => load(true));
  return {
    select(selection) {
      point = selection;
      data = null;
      view = 'summary';
      element.hidden = false;
      load();
    },
    close,
    openReport,
    getOpen: () => !element.hidden,
  };
}
