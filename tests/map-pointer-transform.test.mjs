import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { countries } from '../app/lib/countries.js';
import { collectRegions, findRegion } from '../public/legacy/projection.js';
import { decodeFinlandGeometry } from '../public/legacy/finland-geometry.js';

const source = fs.readFileSync(new URL('../app/lib/map-view.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export function createMapView', 'function createMapView');

for (const [id, point] of [['fi', [26.1, 65.5]], ['mn', [105, 47.3]], ['ca', [-112, 57]]]) {
  for (const dpr of [1, 2]) test(`${id}: animated canvas scale preserves arbitrary picking, resize and drag at DPR ${dpr}`, () => {
    const config = countries[id];
    const geometry = id === 'fi'
      ? decodeFinlandGeometry(fs.readFileSync(new URL('../public/legacy/assets/finland-geometry.bin', import.meta.url)))
      : JSON.parse(fs.readFileSync(new URL('../public' + config.geometry, import.meta.url)));
    const regions = collectRegions(geometry.regionData), bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of geometry.rings) for (const coord of ring) {
      const [x, y] = config.project(...coord);
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
    }
    let width = 1854, height = 927, scale = 1, left = 0, top = 0, pose = {}, notifyResize, now = 0, next = 0;
    const queue = new Map(), handlers = {}, picked = [];
    const context2D = new Proxy({
      translate(x, y) { pose.x = x; pose.y = y; }, scale(k) { pose.k = k; },
      createLinearGradient() { return { addColorStop() {} }; },
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const canvas = { style: {}, get clientWidth() { return width; }, get clientHeight() { return height; },
      getContext: () => context2D, getBoundingClientRect: () => ({ left, top, width: width * scale, height: height * scale }),
      addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener() {}, setPointerCapture() {} };
    const layer = { bitmap: {}, x: 0, y: 0, width: 1280, height: 720 };
    const assets = { image: {}, bounds, sites: [], borders: layer, zoomBorders: layer, highlight: () => undefined,
      projection: { width: 1280, height: 720, unproject: config.unproject }, regionAt: (lon, lat) => findRegion(regions, lon, lat),
      select: ([longitude, latitude], region) => ({ longitude, latitude, region }) };
    const context = { IMAGE_WIDTH: 1280, IMAGE_HEIGHT: 720, window: { devicePixelRatio: dpr }, comparisonColors: [],
      performance: { now: () => now }, ResizeObserver: class { constructor(fn) { notifyResize = fn; } observe() {} disconnect() {} },
      requestAnimationFrame: fn => { queue.set(++next, fn); return next; }, cancelAnimationFrame: id => queue.delete(id) };
    vm.createContext(context); vm.runInContext(source + '\nglobalThis.createMapView=createMapView;', context);
    const view = context.createMapView(canvas, {}, assets, site => picked.push(site), () => {}, () => true);
    function frame() { now += 16; const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(fn => fn(now)); }
    function pointer(type, x, y) { handlers[type]({ type, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y }); }
    function click() {
      const [x, y] = config.project(...point);
      const screenX = left + (pose.x + x * pose.k) * width * scale / (canvas.width / dpr);
      const screenY = top + (pose.y + y * pose.k) * height * scale / (canvas.height / dpr);
      const count = picked.length;
      pointer('pointerdown', screenX, screenY); pointer('pointerup', screenX, screenY);
      assert.equal(picked.length, count + 1, 'visible land point must remain selectable');
      assert.ok(Math.abs(picked.at(-1).longitude - point[0]) < 1e-7);
      assert.ok(Math.abs(picked.at(-1).latitude - point[1]) < 1e-7);
    }
    view.enter(true); frame(); click();
    // Reproduce ResizeObserver's first callback after scale(1.12) starts.
    scale = 1.12; left = -width * .05; top = -height * .06;
    notifyResize(); frame();
    assert.equal(canvas.width, width * dpr, 'visual animation must not enlarge the logical canvas');
    assert.equal(canvas.height, height * dpr);
    click();
    scale = 1; left = top = 0; // CSS transforms end without a layout resize notification.
    click();
    width = 1600; height = 900; notifyResize(); frame();
    assert.equal(canvas.width, width * dpr); assert.equal(canvas.height, height * dpr); click();
    view.zoom(1.4); frame();
    pointer('pointerdown', 800, 450); pointer('pointermove', 850, 475); pointer('pointerup', 850, 475); frame();
    click(); view.destroy();
  });
}
