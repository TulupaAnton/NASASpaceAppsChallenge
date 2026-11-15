// Verify real pointer picks against the pixels drawn by Canvas2D; no screenshots.
import assert from 'node:assert/strict';
import { countries } from '../../app/lib/countries.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1854, height: 927 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // These checks measure picking, not upstream availability or daily quotas.
  await page.context().route('**/api/point', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: '{"error":"External providers are disabled in this pointer regression test"}' }));
  await page.addInitScript(() => {
    for (const Type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const method of ['drawElements', 'drawArrays']) Type.prototype[method] = () => {};
    }
    window.pickProbe = { events: [], pose: {} };
    window.addEventListener('datax:location-selected', event => window.pickProbe.events.push(event.detail));
    const proto = CanvasRenderingContext2D.prototype;
    const translate = proto.translate, scale = proto.scale, transform = proto.setTransform;
    proto.setTransform = function (...args) {
      if (this.canvas.classList.contains('map')) window.pickProbe.dpr = args[0];
      return transform.apply(this, args);
    };
    proto.translate = function (x, y) {
      if (this.canvas.classList.contains('map')) window.pickProbe.pose = { x, y };
      return translate.call(this, x, y);
    };
    proto.scale = function (x, y) {
      if (this.canvas.classList.contains('map')) window.pickProbe.pose.k = x;
      return scale.call(this, x, y);
    };
  });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:3000/');
  await page.waitForSelector('.earth-opening[data-intro-stage="ready"]', { timeout: 45000 });
  await page.locator('#country-search').fill('Finland');
  await page.getByRole('button', { name: 'Finland', exact: true }).click();
  await page.getByRole('button', { name: 'Skip intro', exact: true }).click();
  await page.waitForSelector('main[data-view="map"]');

  for (const [id, point] of [['fi', [26.1, 65.5]], ['ca', [-112, 57]], ['fi', [26.1, 65.5]]]) {
    if (await page.locator('main').getAttribute('data-country') !== id.toUpperCase()) {
      await page.getByRole('group', { name: 'Map country', exact: true })
        .getByRole('button', { name: countries[id].name, exact: true }).click();
      await page.waitForSelector(`main[data-country="${id.toUpperCase()}"][data-switching="false"]`);
    }
    await page.waitForTimeout(1000);
    const click = await page.evaluate(xy => {
      const canvas = document.querySelector('canvas.map'), rect = canvas.getBoundingClientRect(), probe = window.pickProbe;
      const width = canvas.width / probe.dpr, height = canvas.height / probe.dpr;
      return { x: rect.left + (probe.pose.x + xy[0] * probe.pose.k) * rect.width / width,
        y: rect.top + (probe.pose.y + xy[1] * probe.pose.k) * rect.height / height,
        width, height, cssWidth: rect.width, cssHeight: rect.height, before: probe.events.length };
    }, countries[id].project(...point));
    assert.equal(click.width, click.cssWidth, 'completed CSS transition must not leave an enlarged bitmap');
    assert.equal(click.height, click.cssHeight);
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(before => window.pickProbe.events.length > before, click.before);
    const selected = await page.evaluate(before => window.pickProbe.events[before], click.before);
    assert.equal(selected.country, id);
    assert.equal(selected.index, undefined, 'this must be an arbitrary point, not a reference marker');
    assert.ok(Math.abs(selected.longitude - point[0]) < .02, id + ': longitude drifted after switching');
    assert.ok(Math.abs(selected.latitude - point[1]) < .02, id + ': latitude drifted after switching');
    console.log(JSON.stringify({ country: id, expected: point, selected: [selected.longitude, selected.latitude] }));
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
