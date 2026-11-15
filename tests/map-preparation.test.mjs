import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { getCountry } from '../app/lib/countries.js';
import { createMapProjection } from '../app/lib/map-projections.js';
import { countrySites, selection } from '../app/lib/sites.js';
import { collectRegions, findRegion } from '../public/legacy/projection.js';
const root = new URL('../', import.meta.url);

function context2D(onTranslate = () => {}) {
  const methods = { translate: onTranslate, scale(k) { methods.k = k; },
    measureText: text => ({ width: text.length * 6 }), createLinearGradient: () => ({ addColorStop() {} }) };
  return new Proxy(methods, { get: (target, key) => target[key] ?? (() => {}) });
}

async function prepare(code) {
  const config = getCountry(code);
  const geometry = JSON.parse(fs.readFileSync(new URL('public' + config.geometry, root)));
  const context = { getCountry, createMapProjection, countrySites, selection, collectRegions, findRegion,
    loadFinlandGeometry() { throw new Error('Non-Finnish maps must load their own geometry'); },
    Image: class { async decode() {} }, Path2D: class { moveTo() {} lineTo() {} closePath() {} addPath() {} },
    document: { createElement: () => ({ getContext: () => context2D() }) },
    fetch: async url => { assert.equal(url, config.geometry); return { ok: true, json: async () => geometry }; } };
  const source = ['app/lib/map-artwork.js', 'app/lib/map-assets.js'].map(file => fs.readFileSync(new URL(file, root), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/\bexport /g, '').replaceAll('import.meta.url', "'http://localhost/map-assets.js'")).join('\n');
  vm.createContext(context); vm.runInContext(source + '\nglobalThis.loadMap=loadMap;', context);
  const promise = context.loadMap(code);
  assert.equal(promise, context.loadMap(code.toUpperCase()), 'normalized country IDs share a preparation cache');
  return promise;
}

for (const code of ['ca', 'mn']) test(`${code}: artwork, projection and selections use the same country after the merge`, async () => {
  const assets = await prepare(code);
  assert.equal(assets.country, code);
  for (const site of countrySites[code]) {
    assert.equal(assets.regionAt(...site.point), site.region);
    assert.deepEqual(assets.projection.project(...site.point), site.xy);
    const picked = assets.select(site.point, site.region, site);
    assert.equal(picked.country, code);
    assert.equal(picked.siteId, site.siteId);
    assert.ok(picked.siteId.startsWith(code + '_'));
  }
  let pose = {}, queue = new Map(), now = 0, id = 0;
  const handlers = {}, ctx = context2D((x, y) => { pose = { x, y }; });
  const canvas = { style: {}, getContext: () => ctx, getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener() {}, setPointerCapture() {} };
  const context = { IMAGE_WIDTH: 1280, IMAGE_HEIGHT: 720, comparisonColors: [], selection,
    unproject() { throw new Error('The merged map must use its own inverse projection'); },
    window: { devicePixelRatio: 1 }, performance: { now: () => now }, ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => { queue.set(++id, fn); return id; }, cancelAnimationFrame: key => queue.delete(key) };
  const source = fs.readFileSync(new URL('app/lib/map-view.js', root), 'utf8').replace(/^import .*;\n/gm, '')
    .replace('export function createMapView', 'function createMapView');
  vm.createContext(context); vm.runInContext(source + '\nglobalThis.createMapView=createMapView;', context);
  const chosen = [];
  const view = context.createMapView(canvas, {}, assets, site => chosen.push(site), () => {}, () => true);
  function frame() { now += 16; const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(fn => fn(now)); pose.k = ctx.k; }
  view.prepareReveal(); frame(); await view.whenPainted(); view.finishReveal(); frame();
  view.zoom(1.4); frame();
  const site = assets.sites[0], [px, py] = site.xy;
  for (const type of ['pointerdown', 'pointerup']) handlers[type]({ type, button: 0, pointerId: 1, pointerType: 'mouse',
    clientX: pose.x + px * pose.k, clientY: pose.y + py * pose.k });
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].country, code);
  assert.equal(chosen[0].siteId, site.siteId);
  view.destroy();
});
