import assert from 'node:assert/strict';
import test from 'node:test';
import { regionReport } from '../server/v6/catalog.js';
import { analyzeExactPoint } from '../server/v6/exact-point.js';
import { comparableScores, normalizeAnalysis } from '../app/lib/site-analysis.js';
import metadata from '../public/legacy/data/metadata.json' with { type: 'json' };

test('all bundled regions and the archived site supply the new analysis panel', async () => {
  for (const id of [...Object.keys(metadata.regions), 'rauma']) {
    const report = await regionReport(id);
    const analysis = normalizeAnalysis(report);
    assert.equal(analysis.score.factors.length, 3);
    if (report.partial) {
      assert.equal(analysis.score.total, null, id + ': incomplete reports must not invent a score');
    } else {
      assert.ok(Number.isFinite(analysis.score.total), id + ': screening score');
      assert.ok(analysis.score.factors.every(factor => Number.isFinite(factor.contribution)));
    }
    assert.equal(analysis.metrics.length, 5);
    assert.equal(report.chart.historical_monthly.length, 240);
    assert.equal(report.chart.scenario_monthly.length, 120);
    assert.equal(report.chart.monthly_climatology.length, 12);
    assert.ok(report.chart.historical_monthly.every(row => Number.isFinite(row.seasonal_trend_c)));
  }
  assert.equal(await regionReport('unknown-region'), null);
});

test('comparison rejects reports with different periods, weights or incomplete scores', async () => {
  const report = await regionReport('fi_uusimaa');
  assert.equal(comparableScores(report, structuredClone(report)), true);
  const changedPeriod = structuredClone(report);
  changedPeriod.meta.historical_period = ['2015-01', '2024-12'];
  assert.equal(comparableScores(report, changedPeriod), false);
  const changedWeights = structuredClone(report);
  const weights = changedWeights.ranking.insight?.effective_weights ?? changedWeights.meta.weights;
  weights.climate += .1;
  assert.equal(comparableScores(report, changedWeights), false);
  assert.equal(comparableScores(report, { ...report, partial: true }), false);
});

test('exact-point calculations honor each historical window and forecast horizon', async t => {
  // Provider fixtures exercise the real engine without depending on live weather services.
  const parameter = Object.fromEntries([
    'T2M', 'T2M_MAX_AVG', 'ALLSKY_SFC_SW_DWN', 'CLRSKY_SFC_SW_DWN',
    'RH2M', 'T2MWET', 'PRECTOTCORR', 'WS10M', 'WS50M',
  ].map(key => [key, {}]));
  for (let year = 1984; year <= 2024; year++) for (let month = 1; month <= 12; month++) {
    const date = String(year) + String(month).padStart(2, '0');
    const temperature = 7 + 10 * Math.sin((month - 3) * Math.PI / 6) + (year - 1984) * .04;
    const values = [temperature, temperature + 4, 2.5, 4, 70, temperature - 2, 1, 4, 6];
    Object.keys(parameter).forEach((key, i) => { parameter[key][date] = values[i]; });
  }
  let nasaRequests = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    let data;
    if (url.hostname === 'power.larc.nasa.gov') {
      nasaRequests++;
      data = { properties: { parameter } };
    } else if (url.hostname === 'globalwindatlas.info') {
      data = url.pathname.includes('temporal')
        ? { annual_ts: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, crosstable: 1 })) }
        : { area_means: [{ sel_perc: 100, val: url.pathname.includes('powerDensity') ? 300 : 7 }] };
    } else if (url.pathname.endsWith('/elevation')) {
      data = { elevation: url.searchParams.get('latitude').split(',').map(() => 30) };
    } else if (url.pathname.endsWith('/flood')) {
      data = url.searchParams.get('latitude').split(',').map(() => ({ daily: { river_discharge: [2, 3, 2] } }));
    } else throw new Error('Unexpected provider: ' + url.hostname);
    return Response.json(data);
  });
  for (const [startYear, endYear, horizonYears] of [[2005, 2024, 10], [2015, 2024, 5], [1984, 2024, 20]]) {
    const report = await analyzeExactPoint({ lat: 60.1699, lon: 24.9384, startYear, endYear, horizonYears });
    assert.deepEqual(report.meta.historical_period, [`${startYear}-01`, `${endYear}-12`]);
    assert.deepEqual(report.meta.scenario_period, [`${endYear + 1}-01`, `${endYear + horizonYears}-12`]);
    assert.equal(report.point_charts.historical_monthly.length, (endYear - startYear + 1) * 12);
    assert.equal(report.point_charts.scenario_monthly.length, horizonYears * 12);
    assert.equal(report.point_ranking.rank, null);
    assert.ok(Number.isFinite(report.point_ranking.scores.overall));
  }
  assert.equal(nasaRequests, 1, 'changing periods reuses raw inputs, not previously calculated results');
});
