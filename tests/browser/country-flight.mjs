// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module, or
// install Playwright locally. No screenshots or visual assertions are used.
import assert from 'node:assert/strict';
import { countrySites } from '../../app/lib/sites.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const geometryRequests = new Set();
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (/geometry\.(json|bin)$/.test(pathname)) geometryRequests.add(pathname);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Isolate map-preparation stalls from software-WebGL rendering in headless
    // Chrome. The real Earth clock/camera and native Canvas2D map still run.
    for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (type) for (const method of ['drawElements', 'drawArrays']) type.prototype[method] = () => {};
    }
    window.flightProbe = { painted: false, firstPaintStage: null, bitmap: false, tasks: [], workerMaps: [], workerErrors: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.error) window.flightProbe.workerErrors.push(data.error);
          else window.flightProbe.workerMaps.push({ country: data.country, bitmap: data.image instanceof ImageBitmap });
        });
      }
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches?.('canvas.map')) {
        const { a, e, f } = this.getTransform();
        window.flightProbe.mapPose = { k: a, x: e, y: f };
      }
      if (this.canvas.matches?.('canvas.map') && !window.flightProbe.painted) {
        window.flightProbe.painted = true;
        window.flightProbe.firstPaintStage = document.querySelector('.earth-opening')?.dataset.introStage;
        window.flightProbe.bitmap = args[0] instanceof ImageBitmap;
      }
      return draw.apply(this, args);
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.flightProbe.tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask' });
    new MutationObserver(() => {
      const stage = document.querySelector('.earth-opening')?.dataset.introStage;
      if (stage === 'flying' && !window.flightProbe.flightStart) window.flightProbe.flightStart = performance.now();
      if (stage === 'leaving-clouds' && !window.flightProbe.flightEnd) window.flightProbe.flightEnd = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-intro-stage'] });
  });
  let releaseMap;
  const mapPermission = new Promise(resolve => { releaseMap = resolve; });
  if (process.env.SLOW_MAP) await page.context().route('**/canada/geometry.json', async route => {
    await mapPermission;
    await route.continue();
  });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:3000/');
  await page.waitForSelector('.earth-opening[data-intro-stage="ready"]', { timeout: 45000 });
  await page.locator('#country-search').fill('Canada');
  await page.getByRole('button', { name: 'Canada', exact: true }).click();
  if (process.env.SLOW_MAP) {
    await page.getByText('Loading Canada…', { exact: true }).waitFor();
    assert.notEqual(await page.locator('.earth-opening').getAttribute('data-intro-stage'), 'flying');
    releaseMap();
  }
  await page.waitForFunction(() => window.flightProbe.painted, null, { timeout: 30000 });
  const probe = await page.evaluate(() => window.flightProbe);
  console.log(JSON.stringify({ firstPaintStage: probe.firstPaintStage, bitmap: probe.bitmap, workerMaps: probe.workerMaps, workerErrors: probe.workerErrors, errors }));
  assert.notEqual(probe.firstPaintStage, 'flying', 'Canada must complete its first map paint before the flight starts');
  assert.equal(probe.bitmap, true, 'Canada must use fully rasterized worker bitmaps');
  assert.deepEqual(probe.workerErrors, []);
  assert.ok(probe.workerMaps.some(map => map.country === 'ca' && map.bitmap));
  assert.ok(probe.workerMaps.every(map => map.bitmap));
  assert.ok(probe.workerMaps.every(map => map.country === 'ca'), 'only Canada needs background worker preparation');
  assert.deepEqual([...geometryRequests].sort(), ['/canada/geometry.json', '/legacy/assets/finland-geometry.bin']);
  await page.waitForSelector('main[data-country="CA"][data-view="map"]', { timeout: 30000 });
  const flightTasks = await page.evaluate(() => {
    const p = window.flightProbe;
    return p.tasks.filter(task => task.start >= p.flightStart && task.start < p.flightEnd && task.duration > 100);
  });
  console.log(JSON.stringify({ flightTasksOver100ms: flightTasks }));
  assert.equal(flightTasks.length, 0, 'Map preparation must not block the active flight');
  assert.equal(await page.locator('.footer select').count(), 0);
  await page.waitForTimeout(1000);
  const reference = countrySites.ca.find(site => site.name === 'Edmonton');
  const target = await page.evaluate(([x, y]) => {
    const canvas = document.querySelector('canvas.map'), rect = canvas.getBoundingClientRect();
    const { x: tx, y: ty, k } = window.flightProbe.mapPose;
    return { x: rect.left + (tx + x * k) * rect.width / canvas.width,
      y: rect.top + (ty + y * k) * rect.height / canvas.height };
  }, reference.xy);
  await page.mouse.click(target.x, target.y);
  await page.locator('.analysis-panel .score-overview').waitFor();
  assert.equal(await page.locator('.footer select').count(), 0);
  assert.match(await page.locator('.analysis-panel').innerText(), /Edmonton/);
  assert.match(await page.locator('.analysis-panel').innerText(), /Canada/);
  const canadaResponse = await page.request.get(new URL('/api/regions/ca_ab', page.url()).href);
  assert.equal(canadaResponse.status(), 200);
  const canada = await canadaResponse.json();
  assert.equal(canada.meta.country, 'ca');
  assert.ok(Number.isFinite(canada.ranking.scores.overall));
  assert.ok(Number.isFinite(canada.ranking.extra_metrics.water_discharge_m3s));

  // Switch directly from Canadian analysis to Finland.
  const countries = page.getByRole('group', { name: 'Map country', exact: true });
  assert.deepEqual(await countries.getByRole('button').allTextContents(), ['Finland', 'Canada']);
  await countries.getByRole('button', { name: 'Finland', exact: true }).click();
  await page.waitForSelector('main[data-country="FI"][data-view="map"][data-switching="false"]');
  assert.equal(await page.locator('.footer select').count(), 0);
  assert.deepEqual(errors, []);
  // Replaying must restore the original Finland route as well.
  await page.getByRole('button', { name: 'Replay intro', exact: true }).click();
  await page.waitForSelector('.earth-opening[data-intro-stage="ready"]', { timeout: 45000 });
  await page.locator('#country-search').fill('Finland');
  await page.getByRole('button', { name: 'Finland', exact: true }).click();
  await page.waitForSelector('main[data-country="FI"][data-view="map"]', { timeout: 30000 });
  assert.equal(await page.locator('.footer select').count(), 0);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
