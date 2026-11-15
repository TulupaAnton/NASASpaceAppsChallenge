// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module, or
// install Playwright locally. No screenshots or visual assertions are used.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
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
          else window.flightProbe.workerMaps.push(data.image instanceof ImageBitmap);
        });
      }
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
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
  if (process.env.SLOW_MAP) await page.context().route('**/countries/ca/geometry.json', async route => {
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
  assert.deepEqual(probe.workerMaps, [true]);
  await page.waitForSelector('main[data-country="CA"][data-view="map"]', { timeout: 30000 });
  const flightTasks = await page.evaluate(() => {
    const p = window.flightProbe;
    return p.tasks.filter(task => task.start >= p.flightStart && task.start < p.flightEnd && task.duration > 100);
  });
  console.log(JSON.stringify({ flightTasksOver100ms: flightTasks }));
  assert.equal(flightTasks.length, 0, 'Map preparation must not block the active flight');
  await page.getByLabel('Choose a location', { exact: true }).selectOption({ label: 'Calgary' });
  assert.match(await page.locator('.map-caption').innerText(), /Alberta/);
  assert.equal(await page.locator('.analysis').count(), 0);
  assert.deepEqual(errors, []);
  // Replaying must restore the original Finland route as well.
  await page.getByRole('button', { name: 'Replay intro', exact: true }).click();
  await page.waitForSelector('.earth-opening[data-intro-stage="ready"]', { timeout: 45000 });
  await page.locator('#country-search').fill('Finland');
  await page.getByRole('button', { name: 'Finland', exact: true }).click();
  await page.waitForSelector('main[data-country="FI"][data-view="map"]', { timeout: 30000 });
  assert.equal(await page.getByLabel('Choose a reference site', { exact: true }).count(), 1);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
