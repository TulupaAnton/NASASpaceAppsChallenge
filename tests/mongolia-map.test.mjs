import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMongolia, unprojectMongolia } from '../app/lib/mongolia-projection.js';
import { comparableScores, normalizeAnalysis } from '../app/lib/site-analysis.js';
import mongoliaReferences from '../public/mongolia/sites.json' with { type: 'json' };
import snapshots from '../server/v6/data/mongolia/power.json' with { type: 'json' };
import { analyzeMongoliaPoint, coordinateInMongolia, mongoliaRegionReport } from '../server/v6/mongolia.js';

test('all 22 Mongolian reference sites are selectable and report comparable Mongolian scores', async () => {
  const reports = [];
  assert.equal(mongoliaReferences.length, 22);
  for (const { code, point, name, region } of mongoliaReferences) {
    const [lon, lat] = unprojectMongolia(...projectMongolia(...point));
    assert.ok(Math.abs(lon - point[0]) < 1e-7 && Math.abs(lat - point[1]) < 1e-7, name);
    assert.ok(await coordinateInMongolia(lat, lon), name);
    const report = mongoliaRegionReport(`mn_${code.toLowerCase()}`);
    reports.push(report);
    assert.equal(report.region.name, region);
    assert.equal(report.chart.historical_monthly.length, 240);
    assert.equal(report.chart.scenario_monthly.length, 120);
    const { score } = normalizeAnalysis(report);
    assert.ok(Number.isFinite(score.total));
    assert.deepEqual(score.factors.map(factor => factor.weight), [.25, .6, .15]);
    assert.equal(report.hydro, null);
  }
  assert.ok(reports.every(report => comparableScores(report, reports[0])));
  assert.equal(await coordinateInMongolia(60.17, 24.94), false);
});

test('live Mongolian reports use NASA POWER and respect the requested period', async t => {
  const sample = snapshots['1'];
  const { parameters, elevationM, point: [lon, lat] } = sample;
  const fetchMock = t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname === 'power.larc.nasa.gov') {
      assert.equal(Number(url.searchParams.get('longitude')), lon);
      assert.equal(url.searchParams.get('start'), '2015');
      assert.equal(url.searchParams.get('end'), '2024');
      return Response.json({ properties: { parameter: parameters }, geometry: { coordinates: [lon, lat, elevationM] } });
    }
    if (url.hostname === 'flood-api.open-meteo.com') {
      return Response.json([{ daily: { river_discharge: [12.5, 13.0] } }]);
    }
    if (url.hostname === 'api.open-meteo.com') {
      return Response.json({ elevation: new Array(49).fill(100) });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const report = await analyzeMongoliaPoint({ lat, lon, startYear: 2015, endYear: 2024, horizonYears: 5 });
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.equal(report.meta.country, 'mn');
  assert.equal(report.partial, false);
  assert.equal(report.point_charts.historical_monthly.length, 120);
  assert.equal(report.point_charts.scenario_monthly.length, 60);
  assert.equal(report.point_ranking.extra_metrics.wind_source_used, 'merra2');
  assert.equal(report.point_ranking.extra_metrics.water_distance_km, 0);
  assert.equal(report.point_ranking.extra_metrics.water_discharge_m3s, 12.75);
});
