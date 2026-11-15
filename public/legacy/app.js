import { IMAGE_WIDTH, IMAGE_HEIGHT, project, unproject, collectRegions, findRegion } from './projection.js';

import { loadFinlandGeometry } from './finland-geometry.js';
import { createSitingPanel } from './siting-panel.js';
import { referenceSites } from './reference-sites.js';
import { CACHED_POINTS, createPointApi } from './point-api.js';

const params = new URLSearchParams(location.search);
const byId = id => document.getElementById(id);
const experience = byId('experience');
const video = byId('flight');
const map = byId('map');
const playButton = byId('center-play');
const sitePicker = byId('site-picker');
const apiBase = document.querySelector('meta[name="finland-point-api"]')?.content.trim();
const sitingPanel = createSitingPanel(byId('point-panel'), {
  pointApi: apiBase ? createPointApi({ baseUrl: apiBase }) : undefined,
  onClose() {
    selected = null;
    sitePicker.value = '';
    schedule();
  },
});
const ctx = map.getContext('2d');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fadeDuration = 680;

// These values are local state and can be imported by future integrations.
export let latitude = null;
export let longitude = null;

const places = [
  ...referenceSites,
  { name: 'Inari', region: 'Lappi', point: [27.0288, 68.9050] },
  ...CACHED_POINTS.map(point => ({
    name: point.name, region: 'Satakunta', point: [point.longitude, point.latitude], archived: true,
  })),
].map(place => ({ ...place, xy: project(...place.point) }));

let phase = 'flight';
let openingMap = false;
let retryMap = false;
let assetsTask;
let selected = null;
let cameraAnimation = null;
let request = 0;
let resolution = 1;
let width = 1;
let height = 1;
let view = { x: 0, y: 0, k: 1 };
let baseZoom = 1;
let markerStarted = 0;
let pointerPoint = null;
let keyboardTarget = false;
let handoffStarted = null;
const pointers = new Map();
let gesture = null;

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

function mapAssets() {
  if (!assetsTask) {
    assetsTask = Promise.all([
      loadImage('assets/finland-satellite.webp'),
      loadFinlandGeometry(),
    ]).then(([image, { regionData, rings }]) => {
      const outline = new Path2D();
      const coast = new Path2D();
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const ring of rings) {
        const pixels = ring.map(point => project(...point));
        const [firstX, firstY] = pixels[0];
        const large = pixels.some(([x,y]) => Math.abs(x-firstX)>9 || Math.abs(y-firstY)>9);
        const path = large ? outline : coast;
        path.moveTo(firstX, firstY);
        for (const [index, [x,y]] of pixels.entries()) {
          if (index) path.lineTo(x,y);
          bounds[0] = Math.min(bounds[0], x);
          bounds[1] = Math.min(bounds[1], y);
          bounds[2] = Math.max(bounds[2], x);
          bounds[3] = Math.max(bounds[3], y);
        }
        path.closePath();
      }
      return { image, regions: collectRegions(regionData), outline, coast, bounds };
    }).catch(error => {
      assetsTask = undefined;
      throw error;
    });
  }
  return assetsTask;
}

let assets = null;
let initialView;

async function openMap(skipFlight = false) {
  if (openingMap || phase === 'map') return;
  openingMap = true;
  const restoreFocus = document.activeElement === playButton;
  video.pause();
  playButton.hidden = true;
  try {
    assets = await mapAssets();
  } catch {
    retryMap = true;
    playButton.title = 'Retry loading the map';
    playButton.setAttribute('aria-label', playButton.title);
    playButton.hidden = false;
    return;
  } finally {
    openingMap = false;
  }
  phase = 'map';
  resize(true);
  if (!skipFlight && !motion.matches && !video.error) {
    view = flightView();
    handoffStarted = performance.now();
    cameraAnimation = {
      start: handoffStarted + fadeDuration * .7,
      duration: 950,
      from: { ...view },
      to: bounded(initialView),
    };
  }
  experience.dataset.phase = phase;
  map.tabIndex = 0;
  map.removeAttribute('aria-hidden');
  video.setAttribute('aria-hidden', 'true');
  schedule();
  if (restoreFocus) map.focus({ preventScroll: true });
}

function play() {
  video.muted = true;
  video.play().catch(() => {
    if (phase === 'flight' && !openingMap) playButton.hidden = false;
  });
}

video.addEventListener('playing', () => { playButton.hidden = true; });
video.addEventListener('ended', () => { void openMap(); });
video.addEventListener('error', () => { void openMap(); });
playButton.addEventListener('click', () => {
  if (retryMap) void openMap();
  else play();
});
motion.addEventListener('change', () => {
  if (motion.matches && phase === 'flight') {
    void openMap();
    return;
  }
  if (motion.matches) {
    finishHandoff();
    if (cameraAnimation) {
      view = cameraAnimation.to;
      cameraAnimation = null;
    }
  }
  schedule();
});

function finishHandoff(settle = true) {
  if (handoffStarted === null) return;
  handoffStarted = null;
  if (cameraAnimation) {
    if (settle) view = cameraAnimation.to;
    cameraAnimation = null;
  }
}

function flightView() {
  const fit = width <= height ? Math.min : Math.max;
  const k = fit(width / IMAGE_WIDTH, height / IMAGE_HEIGHT);
  return { x: (width - IMAGE_WIDTH * k) / 2, y: (height - IMAGE_HEIGHT * k) / 2, k };
}

function bounded(target) {
  const k = clamp(target.k, baseZoom, baseZoom * 6);
  const remainingX = width - IMAGE_WIDTH * k;
  const remainingY = height - IMAGE_HEIGHT * k;
  return {
    x: remainingX > 0 ? remainingX / 2 : clamp(target.x, remainingX, 0),
    y: remainingY > 0 ? remainingY / 2 : clamp(target.y, remainingY, 0),
    k,
  };
}

function resize(reset = false) {
  const center = imageAt(width / 2, height / 2);
  const scale = view.k / baseZoom;
  const box = map.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return;
  width = box.width;
  height = box.height;
  resolution = Math.min(window.devicePixelRatio || 1, 2.25);
  map.width = Math.max(1, Math.round(width * resolution));
  map.height = Math.max(1, Math.round(height * resolution));

  const [west, north, east, south] = assets.bounds;
  const margin = Math.min(60, width * 0.095, height * 0.075);
  const cover = Math.max(width / IMAGE_WIDTH, height / IMAGE_HEIGHT);
  baseZoom = Math.min(cover, (width - 2 * margin) / (east - west), (height - 2 * margin) / (south - north));
  initialView = {
    x: width / 2 - (west + east) / 2 * baseZoom,
    y: height / 2 - (north + south) / 2 * baseZoom,
    k: baseZoom,
  };
  const k = baseZoom * scale;
  view = bounded(reset ? initialView : { x: width / 2 - center[0] * k, y: height / 2 - center[1] * k, k });
  cameraAnimation = null;
  schedule();
}

new ResizeObserver(() => {
  if (phase !== 'map') return;
  const box = map.getBoundingClientRect();
  if (box.width === width && box.height === height) return;
  finishHandoff();
  resize();
}).observe(map);

const imageAt = (x, y) => [(x - view.x) / view.k, (y - view.y) / view.k];
const screenAt = ([x, y]) => [x * view.k + view.x, y * view.k + view.y];
const locationAt = (x, y) => unproject(...imageAt(x, y));

function pathTo(target, animate = true) {
  const finish = bounded(target);
  if (!animate || motion.matches) {
    view = finish;
    cameraAnimation = null;
  } else {
    cameraAnimation = { start: performance.now(), duration: 475, from: { ...view }, to: finish };
  }
  schedule();
}

function zoomAt(factor, x = width / 2, y = height / 2) {
  finishHandoff();
  const current = cameraAnimation?.to ?? view;
  const k = clamp(current.k * factor, baseZoom, baseZoom * 6);
  pathTo({ x: x - (x - current.x) * k / current.k, y: y - (y - current.y) * k / current.k, k });
}

function fitMap() {
  pathTo(initialView);
}

function schedule() {
  if (!request && phase === 'map') request = requestAnimationFrame(draw);
}

function draw(now) {
  request = 0;
  if (phase !== 'map' || !assets) return;
  if (cameraAnimation) {
    const { start, duration, from, to } = cameraAnimation;
    const progress = clamp((now - start) / duration, 0, 1);
    const ease = handoffStarted === null ? 1 - (1 - progress) ** 3 : progress * progress * (3 - 2 * progress);
    view = {
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease,
      k: from.k + (to.k - from.k) * ease,
    };
    if (progress === 1) cameraAnimation = null;
  }
  const handoffProgress = handoffStarted === null ? 1 : clamp((now - handoffStarted - fadeDuration * .42) / 1050, 0, 1);
  if (handoffProgress === 1 && !cameraAnimation) handoffStarted = null;

  ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
  ctx.fillStyle = '#040708';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.k, view.k);
  ctx.drawImage(assets.image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  ctx.globalAlpha = handoffProgress;
  ctx.fillStyle = 'rgba(2, 12, 9, .07)';
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  ctx.fillStyle = 'rgba(224, 242, 177, .105)';
  ctx.fill(assets.outline, 'evenodd');
  ctx.fill(assets.coast, 'evenodd');
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(31, 30, 12, .76)';
  ctx.lineWidth = 3.8 / view.k;
  ctx.stroke(assets.outline);
  ctx.strokeStyle = 'rgba(244, 222, 154, .90)';
  ctx.lineWidth = 1.55 / view.k;
  ctx.stroke(assets.outline);
  ctx.strokeStyle = 'rgba(244, 222, 154, .76)';
  ctx.lineWidth = .84 / view.k;
  ctx.stroke(assets.coast);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = handoffProgress;
  drawLabels();
  ctx.restore();
  if (selected) {
    const [x,y] = screenAt(selected.xy);
    drawMarker(x,y,now);
  }
  if (pointerPoint || keyboardTarget) {
    const [x,y] = keyboardTarget ? [width / 2, height / 2] : [pointerPoint.x,pointerPoint.y];
    if (!selected || pointDistance(selected.xy, x, y) > 14) drawReticle(x,y);
  }
  if (cameraAnimation || handoffStarted !== null || (selected && !motion.matches && now - markerStarted < 520)) schedule();
}

function pointDistance(point, x, y) {
  const [px,py] = screenAt(point);
  return Math.hypot(px - x, py - y);
}

function nearbyPlace(x, y, tolerance) {
  let nearest;
  let minimum = tolerance;
  for (const place of places) {
    const distance = pointDistance(place.xy, x, y);
    if (distance < minimum) {
      minimum = distance;
      nearest = place;
    }
  }
  return nearest;
}

function drawLabels() {
  const font = width < 550 ? 10 : 12;
  const labels = [];
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${font}px "DM Sans",system-ui,sans-serif`;
  for (const place of places) {
    const [x,y] = screenAt(place.xy);
    if (x < -4 || x > width + 4 || y < -4 || y > height + 4) continue;
    ctx.beginPath();
    ctx.arc(x,y,place.major ? 3.3 : 2.7,0,2*Math.PI);
    ctx.fillStyle = place.siteId ? '#ffe1a0' : place.archived ? '#c0e8df' : '#f5f2de';
    ctx.strokeStyle = '#122017';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fill();
    if (selected && pointDistance(selected.xy, x, y) < 36) continue;
    const labelWidth = ctx.measureText(place.name).width + 12;
    const labelX = x + labelWidth > width - 4 ? x - labelWidth : x + 8;
    if (labelX < 4 || y < 10 || y > height - 10) continue;
    if (labels.some(label => Math.abs(label.y - y) < 16 && labelX < label.end && labelX + labelWidth > label.x)) continue;
    labels.push({ x: labelX, end: labelX + labelWidth, y });
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(10,20,14,.88)';
    ctx.strokeText(place.name, labelX, y);
    ctx.fillText(place.name, labelX, y);
  }
}

function drawReticle(x,y) {
  ctx.strokeStyle = '#f5deaa';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x,y,7,0,2*Math.PI);
  ctx.moveTo(x-12,y); ctx.lineTo(x-7,y);
  ctx.moveTo(x+7,y); ctx.lineTo(x+12,y);
  ctx.moveTo(x,y-12); ctx.lineTo(x,y-7);
  ctx.moveTo(x,y+7); ctx.lineTo(x,y+12);
  ctx.stroke();
}

function drawMarker(x, y, now) {
  if (x < 0 || x > width || y < 0 || y > height) return;
  const elapsed = motion.matches ? 1300 : Math.max(0, now - markerStarted);
  const bounce = elapsed >= 520 ? 1 : 1 - Math.cos(elapsed / 520 * Math.PI * 2.4) * (1 - elapsed / 520) ** 3;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.max(.1,bounce),Math.max(.1,bounce));
  ctx.beginPath();
  ctx.arc(0,0,8,0,2*Math.PI);
  ctx.fillStyle = '#1d271b';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffe09b';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0,0,3,0,2*Math.PI);
  ctx.fillStyle = '#ffe09b';
  ctx.fill();
  ctx.restore();

  const title = selected.name;
  if (!title) return;
  ctx.font = '600 12px "DM Sans",system-ui,sans-serif';
  const labelWidth = ctx.measureText(title).width + 21;
  const labelX = clamp(x - labelWidth / 2, 7, Math.max(7, width - labelWidth - 7));
  const labelY = y > 43 ? y - 39 : y + 16;
  ctx.globalAlpha = clamp(elapsed / 220, 0, 1);
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, labelWidth, 22, 5);
  ctx.fillStyle = '#14231beF';
  ctx.fill();
  ctx.strokeStyle = '#e0c987a8';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#f2e8c9';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, labelX + 10.5, labelY + 11.3);
  ctx.globalAlpha = 1;
}

function selectPoint(point, marker) {
  const region = marker?.region ?? findRegion(assets.regions, ...point);
  if (!region) return;
  [longitude, latitude] = point;
  selected = { name: marker?.name ?? '', xy: marker?.xy ?? project(...point) };
  markerStarted = performance.now();
  sitePicker.value = marker ? String(places.indexOf(marker)) : '';
  sitingPanel.select({ latitude, longitude, region, name: selected.name, siteId: marker?.siteId });
  schedule();
}

function selectAt(x, y, tolerance = 9) {
  const marker = nearbyPlace(x, y, tolerance);
  const point = marker?.point ?? locationAt(x, y);
  if (point) selectPoint(point, marker);
}

for (const place of [...places].sort((a, b) => a.name.localeCompare(b.name))) {
  const option = document.createElement('option');
  option.value = String(places.indexOf(place));
  option.textContent = place.name;
  sitePicker.append(option);
}
sitePicker.addEventListener('change', () => {
  if (phase !== 'map' || !sitePicker.value) return;
  const place = places[Number(sitePicker.value)];
  finishHandoff();
  fitMap();
  selectPoint(place.point, place);
});

function relative(event) {
  const origin = map.getBoundingClientRect();
  return { x: event.clientX - origin.left, y: event.clientY - origin.top };
}

function updateHover(point) {
  const coords = locationAt(point.x, point.y);
  pointerPoint = coords && findRegion(assets.regions,...coords) ? point : null;
  schedule();
}

function startPinch() {
  const [a,b] = [...pointers.values()];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  gesture = { kind:'pinch', distance: Math.hypot(a.x-b.x,a.y-b.y), k:view.k, anchor:imageAt(mx,my) };
}

map.addEventListener('pointerdown', event => {
  if (phase !== 'map' || (event.pointerType === 'mouse' && event.button !== 0)) return;
  finishHandoff(false);
  const p = relative(event);
  keyboardTarget = false;
  pointerPoint = null;
  cameraAnimation = null;
  pointers.set(event.pointerId,p);
  map.setPointerCapture(event.pointerId);
  if (pointers.size > 1) startPinch();
  else gesture = { kind:'pan', start:p, view:{ ...view }, moved:false };
  schedule();
});

map.addEventListener('pointermove', event => {
  if (phase !== 'map') return;
  const p = relative(event);
  if (!pointers.has(event.pointerId)) {
    if (!pointers.size && event.pointerType !== 'touch') updateHover(p);
    return;
  }
  pointers.set(event.pointerId,p);
  if (gesture?.kind === 'pinch' && pointers.size > 1) {
    const [a,b] = [...pointers.values()];
    const k = clamp(gesture.k * Math.hypot(a.x-b.x,a.y-b.y) / Math.max(1,gesture.distance), baseZoom, baseZoom*6);
    pathTo({ x:(a.x+b.x)/2-gesture.anchor[0]*k, y:(a.y+b.y)/2-gesture.anchor[1]*k, k },false);
    return;
  }
  if (gesture?.kind !== 'pan') return;
  const dx = p.x - gesture.start.x;
  const dy = p.y - gesture.start.y;
  if (Math.hypot(dx,dy)>5) gesture.moved = true;
  if (!gesture.moved) return;
  map.classList.add('is-dragging');
  pathTo({ x:gesture.view.x+dx, y:gesture.view.y+dy, k:gesture.view.k },false);
});

function endPointer(event, cancelled = false) {
  if (!pointers.has(event.pointerId)) return;
  const p = relative(event);
  if (!cancelled && pointers.size === 1 && gesture?.kind === 'pan' && !gesture.moved) {
    selectAt(p.x,p.y,event.pointerType === 'touch' ? 14 : 9);
  }
  pointers.delete(event.pointerId);
  if (pointers.size === 1) {
    gesture = { kind:'pan', start:[...pointers.values()][0], view:{...view}, moved:true };
  } else if (pointers.size === 0) {
    gesture = null;
    map.classList.remove('is-dragging');
    if (event.pointerType !== 'touch') updateHover(p);
  }
}
map.addEventListener('pointerup', event => endPointer(event));
map.addEventListener('pointercancel', event => endPointer(event,true));
map.addEventListener('lostpointercapture', event => endPointer(event,true));
map.addEventListener('pointerleave', () => {
  pointerPoint = null;
  schedule();
});
map.addEventListener('wheel', event => {
  event.preventDefault();
  const {x,y} = relative(event);
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  zoomAt(Math.exp(-clamp(delta, -325, 325)*.0028),x,y);
},{ passive:false });

const directions = { ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1] };
map.addEventListener('keydown', event => {
  if (phase !== 'map') return;
  const key = event.key;
  if (key in directions) {
    finishHandoff();
    const [dx,dy] = directions[key];
    const current = cameraAnimation?.to ?? view;
    if (current.k <= baseZoom * 1.002) {
      const k = baseZoom * 1.6;
      const center = imageAt(width / 2,height / 2);
      pathTo({ x:width/2-center[0]*k+dx*45, y:height/2-center[1]*k+dy*45, k });
    } else {
      pathTo({ x:current.x+dx*55, y:current.y+dy*55,k:current.k });
    }
  } else if (key === '+' || key === '=') zoomAt(1.48);
  else if (key === '-') zoomAt(1/1.48);
  else if (key === 'Home') {
    finishHandoff();
    fitMap();
  } else if (key === 'Enter' || key === ' ') {
    finishHandoff(false);
    selectAt(width/2,height/2);
  }
  else return;
  event.preventDefault();
  keyboardTarget = true;
  schedule();
});
map.addEventListener('blur', () => {keyboardTarget = false; schedule();});

void mapAssets().catch(() => {});
const point = [params.get('lon'), params.get('lat')];
if (point.every(value => value?.trim() && Number.isFinite(Number(value)))) {
  void openMap(true).then(() => {
    if (!assets) return;
    const coordinates = point.map(Number);
    const marker = params.has('marker') && places[Number(params.get('marker'))];
    const match = marker && marker.point.every((value, index) => value === coordinates[index]);
    selectPoint(coordinates, match ? marker : undefined);
    if (selected) sitingPanel.openReport();
  });
} else if (motion.matches) void openMap(true);
else play();
