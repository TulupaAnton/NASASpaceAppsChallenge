// Technical interaction checks only: no screenshots or live provider requests.
import assert from 'node:assert/strict';
import { countrySites } from '../../app/lib/sites.js';
import { buildPointReport } from '../../server/v6/exact-point.js';
import snapshots from '../../server/v6/data/canada/power.json' with { type: 'json' };
import water from '../../server/v6/data/canada/water.json' with { type: 'json' };

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Bypass the 3D opening; preserve real Canvas2D map preparation and input.
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.includes('webgl') ? null : context.call(this, type, ...args);
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('canvas.map')) {
        const { a, e, f } = this.getTransform();
        window.mapPose = { k: a, x: e, y: f };
      }
      return draw.apply(this, args);
    };
  });
  await page.route('**/api/point', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const site = countrySites.ca.find(site => Math.abs(site.point[0] - body.lon) < .001);
    assert.ok(site, 'custom-period queries must keep the selected reference coordinates');
    const code = site.siteId.slice(3).toUpperCase(), snapshot = snapshots[code];
    const report = buildPointReport({ ...body, params: snapshot.parameters, requireComplete: true,
      terrain: { elevationM: snapshot.elevationM, slopeDeg: null, source: 'Bundled test fixture' }, water: water[code] });
    report.meta.country = 'ca';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) });
  });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:3000/');
  await page.waitForSelector('.country-landing:not([inert])');
  await page.locator('#country-search').fill('Canada');
  await page.getByRole('button', { name: 'Canada', exact: true }).click();
  await page.waitForSelector('main[data-country="CA"][data-view="map"]');
  await page.locator('canvas.map').focus();
  await page.keyboard.press('Enter');
  await page.locator('.score-overview').waitFor();
  const period = page.getByRole('region', { name: 'Data period', exact: true });
  assert.equal(await period.locator('.data-period-reading').count(), 2);
  assert.match(await period.innerText(), /2005–2024/);

  async function changePreset() {
    await period.getByRole('button', { name: 'Change dates' }).click();
    await period.getByLabel('Historical data', { exact: true }).selectOption('1');
    await period.getByLabel('Temperature projection', { exact: true }).selectOption('5');
  }
  await changePreset();
  assert.equal(requests.length, 0, 'editing must not trigger calculations');
  await period.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.match(await period.innerText(), /2005–2024/);

  await period.getByRole('button', { name: 'Change dates' }).click();
  await period.getByLabel('Historical data', { exact: true }).selectOption('-1');
  await period.getByRole('combobox', { name: /^Start year/ }).selectOption('2015');
  assert.equal(await period.getByRole('combobox', { name: /^End year/ }).locator('option')
    .evaluateAll(options => options.some(option => option.value === '2016')), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.analysis-panel').count(), 1, 'Escape must close the editor without leaving analysis');
  assert.equal(requests.length, 0);

  await changePreset();
  await period.getByRole('button', { name: 'Apply dates' }).click();
  await page.locator('.score-overview').waitFor();
  assert.equal(requests.length, 1);
  assert.deepEqual([requests[0].startYear, requests[0].endYear, requests[0].horizonYears], [2015, 2024, 5]);
  assert.match(await period.innerText(), /2015–2024/);
  assert.match(await period.innerText(), /2025–2029/);
  assert.equal(await period.locator('.data-period-reading').count(), 2);
  await page.getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Back to map', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const target = await page.evaluate(xy => {
    const canvas = document.querySelector('canvas.map'), rect = canvas.getBoundingClientRect(), pose = window.mapPose;
    return { x: rect.left + (pose.x + xy[0] * pose.k) * rect.width / canvas.width,
      y: rect.top + (pose.y + xy[1] * pose.k) * rect.height / canvas.height };
  }, countrySites.ca.find(site => site.name === 'Edmonton').xy);
  await page.mouse.click(target.x, target.y);
  await page.locator('.score-overview').waitFor();
  await page.getByRole('button', { name: 'Add to comparison', exact: true }).click();
  await page.getByRole('heading', { name: 'Compare trends', exact: true }).waitFor();
  await page.getByRole('combobox', { name: /^Chart metric/ }).selectOption('projection');
  await changePreset();
  await period.getByRole('button', { name: 'Apply dates' }).click();
  await page.getByRole('heading', { name: 'Compare trends', exact: true }).waitFor();
  console.log(JSON.stringify({ periodRequests: requests.map(({ lon, startYear, endYear, horizonYears }) => ({ lon, startYear, endYear, horizonYears })) }));
  assert.equal(requests.length, 2, 'reuse the first site report only when its applied dates match');
  assert.equal(requests[1].lon, snapshots.AB.point[0]);
  assert.deepEqual([requests[1].startYear, requests[1].endYear, requests[1].horizonYears], [2015, 2024, 5]);
  assert.equal(await page.getByRole('combobox', { name: /^Chart metric/ }).inputValue(), 'projection');
  assert.match(await period.innerText(), /These dates apply to every site/);

  await page.getByRole('group', { name: 'Analysis view' }).getByRole('button', { name: 'Site', exact: true }).click();
  await page.locator('.score-overview').waitFor();
  assert.equal(requests.length, 3, 'returning to Site loads its newly applied period');
  assert.equal(requests[2].horizonYears, 5);
  assert.equal(await period.locator('.data-period-reading').count(), 2);
  await page.getByRole('group', { name: 'Analysis view' }).getByRole('button', { name: /^Compare/ }).click();
  await page.getByRole('heading', { name: 'Compare trends', exact: true }).waitFor();

  await period.getByRole('button', { name: 'Change dates' }).click();
  await period.getByRole('button', { name: 'Use default dates' }).click();
  await period.getByRole('button', { name: 'Apply dates' }).click();
  await page.getByRole('heading', { name: 'Compare trends', exact: true }).waitFor();
  assert.match(await period.innerText(), /2005–2024/);
  assert.equal(await page.locator('.footer, .map-caption').count(), 0);
  assert.equal(await page.locator('.topbar a.credits').count(), 1);
  assert.deepEqual(errors, []);
  console.log('Passed: draft/cancel/Escape, minimum history span, Apply dates, averages, comparison report reuse, projection choice and reset.');
} finally { await browser.close(); }
