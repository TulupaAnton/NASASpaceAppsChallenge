import assert from 'node:assert/strict';

const origin = new URL(process.env.BOREAL_BASE_URL || 'http://localhost:3000');
const args = new Set(process.argv.slice(2));
const capital = { country: 'mn', lat: 47.9186, lon: 106.9147 };

async function request(path, data, status = 200) {
  const response = await fetch(new URL(path, origin), data ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  } : undefined);
  const body = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(body).slice(0, 350)}`);
  return body;
}

const sites = await request('/mongolia/sites.json');
assert.equal(sites.length, 22);
assert.equal(new Set(sites.map(site => site.code)).size, 22);
const rankings = [];

for (const site of sites) {
  const id = 'mn_' + site.code;
  const report = await request('/api/regions/' + id);
  assert.equal(report.count, 22);
  assert.equal(report.ranking.site_id, id);
  assert.equal(report.region.name, site.region);
  assert.equal(report.region.reference, site.name);
  assert.equal(report.partial, false);
  assert.equal(report.meta.country, 'mn');
  assert.equal(report.ranking.extra_metrics.wind_source_used, 'merra2');
  assert.equal(report.chart.historical_monthly.length, 240);
  assert.equal(report.chart.scenario_monthly.length, 120);
  assert.equal(report.chart.monthly_climatology.length, 12);
  assert.deepEqual(report.meta.weights, { climate: .30, renewables: .70, water: 0 });
  assert.equal(report.ranking.scores.water, null);
  assert.ok(Number.isFinite(report.ranking.scores.overall));
  assert.ok(report.leader.site_id.startsWith('mn_'));
  rankings.push(report.ranking);
  const [lon, lat] = site.point;
  const area = await request('/api/area', { lat, lon, country: 'mn', radius: 50 });
  assert.equal(area.windHeight, 100);
  assert.ok(area.samples.some(sample => sample.name === site.name));
}

for (const row of rankings) {
  assert.equal(row.rank, 1 + rankings.filter(other => other.scores.overall > row.scores.overall).length);
}

const empty = await request('/api/area', { country: 'mn', lat: 43.23, lon: 99.48, radius: 50 });
assert.equal(empty.coverage.used, 0);
assert.equal(empty.metrics.temperature.mean, null);
const finland = await request('/api/regions/fi_uusimaa');
assert.equal(finland.count, 19);
assert.equal((await request('/api/regions/rauma?wind=merra2')).mode, 'archive');
assert.ok((await request('/api/area', { lat: finland.ranking.lat, lon: finland.ranking.lon, radius: 100 })).coverage.used >= 1);

if (args.has('--with-canada')) {
  const canada = await request('/api/regions/ca_on');
  assert.equal(canada.count, 13);
  assert.equal(canada.meta.country, 'ca');
  assert.ok((await request('/api/area', { country: 'ca', lat: canada.ranking.lat, lon: canada.ranking.lon, radius: 100 })).coverage.used >= 1);
}

await request('/api/regions/mn_missing', undefined, 404);
await request('/api/regions/mn_1?wind=gwa', undefined, 400);
await request('/api/point', { ...capital, wind: 'gwa' }, 400);
await request('/api/point', { country: 'mn', lat: 43.6532, lon: -79.3832 }, 400);
await request('/api/point', { country: 'mn', lat: 51, lon: 100.5 }, 400);
await request('/api/area', { ...capital, radius: 75 }, 400);
await request('/api/area', { ...capital, country: 'invalid', radius: 100 }, 400);
await request('/api/area', { ...capital, radius: 100, wind: 'gwa' }, 400);

console.log('Passed: 22 Mongolia references and areas, ranks, empty areas, water and foreign point rejection, legacy routes.');

if (args.has('--live')) {
  const center = { ...capital, lat: 47.87, lon: 106.86 };
  const point = await request('/api/point', center);
  assert.equal(point.meta.country, 'mn');
  assert.equal(point.point_charts.historical_monthly.length, 240);
  assert.equal(point.point_ranking.scores.water, null);
  assert.ok(Number.isFinite(point.point_ranking.scores.overall));
  assert.equal(point.cohort.compared, 22);
  assert.equal(point.point_ranking.lat, center.lat);

  const area = await request('/api/area', { ...capital, radius: 100, source: 'live' });
  assert.equal(area.windHeight, 50);
  assert.ok(area.coverage.used > 0 && area.coverage.used <= area.coverage.planned && area.coverage.planned <= 5);
  assert.ok(Number.isFinite(area.metrics.temperature.mean));
  console.log(`Passed: live Mongolia point and live area (${area.coverage.used}/${area.coverage.planned} samples).`);
}
