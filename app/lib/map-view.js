import { IMAGE_HEIGHT, IMAGE_WIDTH, project, unproject } from '../../public/legacy/projection';
import { comparisonColors, selection, selectionKey, sites } from './sites';
import { destination } from './geo';

const amber = '#ffc477';
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

export function createMapView(canvas, focusArea, assets, onPick, onMiss, reducedMotion) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const [west, north, east, south] = assets.bounds;
  const centerX = (west + east) / 2;
  const centerY = (north + south) / 2;
  let size, view, transition, zoomTarget, frame = 0, lastFrame, dirty = true, selected, hover, keyboard;
  let borders = 0, isolation = 0, active = false, revealing = false;
  let resolvePainted;
  const painted = new Promise(resolve => { resolvePainted = resolve; });
  let drag, pinch, gestureScale;
  let candidates = [], rings = [];
  const pointers = new Map();

  function flightView() {
    const videoWidth = size.width < 640 ? Math.max(size.width, 710) : size.width;
    const k = Math.min(videoWidth / IMAGE_WIDTH, size.height / IMAGE_HEIGHT);
    return { x: (size.width - IMAGE_WIDTH * k) / 2, y: (size.height - IMAGE_HEIGHT * k) / 2, k };
  }

  function fullScreenView() {
    const k = Math.max(size.width / IMAGE_WIDTH, size.height / IMAGE_HEIGHT) * 1.002;
    return { x: (size.width - IMAGE_WIDTH * k) / 2, y: (size.height - IMAGE_HEIGHT * k) / 2, k };
  }

  function fit() {
    const { width, height } = size;
    const mobile = width < 940;
    let left = 0, top = 0, availableWidth = width, availableHeight = height;
    if (selected && focusArea.clientWidth) {
      left = focusArea.offsetLeft;
      top = focusArea.offsetTop;
      availableWidth = focusArea.clientWidth;
      availableHeight = focusArea.clientHeight;
    }
    const usableHeight = availableHeight * (selected ? .87 : (mobile ? .69 : .83));
    const k = Math.min((availableWidth - 42) / (east - west), usableHeight / (south - north));
    const offsetY = selected ? -5 : (mobile ? 27 : 4);
    return {
      x: left + availableWidth / 2 - centerX * k,
      y: top + availableHeight / 2 - centerY * k + offsetY, k,
    };
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const { width, height } = bounds;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (size?.width === width && size.height === height && size.dpr === dpr) return;
    const previous = size;
    size = { width, height, dpr };
    zoomTarget = undefined;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (revealing) view = fullScreenView();
    else if (!active || !previous) view = active ? fit() : flightView();
    else if (transition) {
      view = { ...view, x: view.x + (width - previous.width) / 2, y: view.y + (height - previous.height) / 2 };
      animate(fit(), transition.toBorders, transition.toIsolation, 520);
    } else view = fit();
    keyboard = undefined;
    hover = undefined;
    schedule();
  }

  function schedule(repaint = true) {
    dirty ||= repaint;
    if (active && !frame) frame = requestAnimationFrame(draw);
  }

  function animate(to, toBorders, toIsolation, duration) {
    zoomTarget = undefined;
    if (reducedMotion()) {
      transition = undefined;
      view = to;
      borders = toBorders;
      isolation = toIsolation;
    } else {
      transition = {
        start: performance.now(), duration, from: { ...view }, to,
        fromBorders: borders, toBorders, fromIsolation: isolation, toIsolation,
      };
    }
    schedule();
  }

  function enter(skip, handoffDelay = 0) {
    if (active || !size) return;
    active = true;
    if (skip) view = fit();
    animate(fit(), 1, 0, skip ? 460 : 1120 / 1.5);
    if (!skip && transition) transition.start += handoffDelay;
  }

  function prepareReveal() {
    if (active || !size) return;
    active = true;
    revealing = true;
    view = fullScreenView();
    borders = 1;
    isolation = 0;
    schedule();
  }

  function finishReveal() {
    if (!revealing) return;
    revealing = false;
    animate(fit(), 1, 0, 1120 / 1.5);
  }

  function show(site) {
    if (site === selected || !active) return;
    const alreadyIsolated = !!selected && !!site;
    selected = site;
    keyboard = undefined;
    hover = undefined;
    canvas.style.cursor = '';
    if (alreadyIsolated) schedule();
    else animate(fit(), 1, site ? 1 : 0, 880);
  }

  function screen([x, y]) {
    return [view.x + x * view.k, view.y + y * view.k];
  }

  function fadePhotoEdges(width, height) {
    const { x, y, k } = view;
    const right = x + IMAGE_WIDTH * k;
    const bottom = y + IMAGE_HEIGHT * k;
    const feather = Math.min(52 / k, IMAGE_HEIGHT / 4);
    // Grow each feather from zero as its edge enters the viewport. Switching
    // on a full-width feather at the boundary produces a visible dark flash.
    const leftFade = Math.min(feather, Math.max(0, x / k));
    const rightFade = Math.min(feather, Math.max(0, (width - right) / k));
    const topFade = Math.min(feather, Math.max(0, y / k));
    const bottomFade = Math.min(feather, Math.max(0, (height - bottom) / k));
    const edges = [
      [leftFade > 0, 0, 0, leftFade, 0, 0, 0, leftFade, IMAGE_HEIGHT],
      [rightFade > 0, IMAGE_WIDTH, 0, IMAGE_WIDTH - rightFade, 0, IMAGE_WIDTH - rightFade, 0, rightFade, IMAGE_HEIGHT],
      [topFade > 0, 0, 0, 0, topFade, 0, 0, IMAGE_WIDTH, topFade],
      [bottomFade > 0, 0, IMAGE_HEIGHT, 0, IMAGE_HEIGHT - bottomFade, 0, IMAGE_HEIGHT - bottomFade, IMAGE_WIDTH, bottomFade],
    ];
    for (const [visible, x1, y1, x2, y2, ...rect] of edges) {
      if (!visible) continue;
      const fade = ctx.createLinearGradient(x1, y1, x2, y2);
      fade.addColorStop(0, '#000');
      fade.addColorStop(1, '#0000');
      ctx.fillStyle = fade;
      ctx.fillRect(...rect);
    }
  }

  function drawLayer({ bitmap, x, y, width, height }) {
    ctx.drawImage(bitmap, x, y, width, height);
  }

  function paintMap(width, height) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    if (isolation < 1) {
      ctx.globalAlpha = 1 - isolation;
      ctx.drawImage(assets.image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
      ctx.globalAlpha = borders * (1 - isolation);
      ctx.fillStyle = 'rgba(1, 12, 13, .29)';
      ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
      fadePhotoEdges(width, height);
    }

    if (isolation > 0) {
      ctx.globalAlpha = isolation;
      drawLayer(assets.cutout);
    }

    if (borders > 0) {
      const mix = smooth(clamp((view.k - 1.65) / .90, 0, 1));
      if (mix < 1) {
        ctx.globalAlpha = borders * (1 - mix);
        drawLayer(assets.borders);
      }
      if (mix > 0) {
        ctx.globalAlpha = borders * mix;
        drawLayer(assets.zoomBorders);
      }
      const highlight = selected && assets.highlight(selected.region);
      if (highlight) {
        ctx.globalAlpha = borders;
        drawLayer(highlight);
      }
    }
    ctx.restore();
  }

  function setContext(nextCandidates, area) {
    candidates = nextCandidates;
    const points = !area || !selected ? [] : area.compare ? candidates : [selected];
    rings = points.map(site => {
      const ring = new Path2D();
      for (let step = 0; step < 64; step++) {
        const point = destination(site.latitude, site.longitude, area.radius, step * 360 / 64);
        const [x, y] = project(point.lon, point.lat);
        if (step) ring.lineTo(x, y);
        else ring.moveTo(x, y);
      }
      ring.closePath();
      const index = candidates.findIndex(candidate => selectionKey(candidate) === selectionKey(site));
      return { ring, color: comparisonColors[index] ?? amber };
    });
    schedule();
  }

  function paintAreas() {
    if (!rings.length) return;
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);
    ctx.globalAlpha = borders * .72;
    ctx.lineWidth = 1.6 / view.k;
    ctx.setLineDash([5 / view.k, 4 / view.k]);
    for (const { ring, color } of rings) {
      ctx.strokeStyle = color;
      ctx.stroke(ring);
    }
    ctx.restore();
  }

  function paintCandidates() {
    candidates.forEach((site, index) => {
      const [x, y] = screen(site.xy);
      if (x < 0 || x > size.width || y < 0 || y > size.height) return;
      ctx.beginPath();
      ctx.arc(x + 9, y - 9, 9.5, 0, Math.PI * 2);
      ctx.fillStyle = comparisonColors[index];
      ctx.fill();
      ctx.fillStyle = '#081410';
      ctx.font = '600 11px "DM Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String.fromCharCode(65 + index), x + 9, y - 9);
    });
  }

  function paintPoints(width, height) {
    ctx.save();
    ctx.globalAlpha = borders;
    ctx.font = '600 11px "DM Sans", sans-serif';
    ctx.textBaseline = 'middle';
    const drawLabels = !selected && width >= 640;
    const showAllLabels = drawLabels && view.k >= fit().k * 1.4;
    const labels = [];
    for (const site of sites) {
      if (selected?.index === site.index) continue;
      const [x, y] = screen(site.xy);
      if (x < 0 || y < 0 || x > width || y > height) continue;
      ctx.beginPath();
      ctx.arc(x, y, site.major ? 3.05 : 2.15, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#a1cab9a8' : '#d9f4df';
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = '#051511';
      ctx.stroke();
      ctx.fill();

      if (!drawLabels || (!site.major && !showAllLabels)) continue;
      const labelWidth = ctx.measureText(site.name).width + 8;
      if (labels.some(label => Math.abs(y - label.y) < 14 && x < label.x + label.width && x + labelWidth > label.x)) continue;
      labels.push({ x, y, width: labelWidth });
      ctx.fillStyle = '#e4f6ea';
      ctx.lineWidth = 3;
      ctx.strokeText(site.name, x + 7, y);
      ctx.fillText(site.name, x + 7, y);
    }
    if (selected) {
      const [x, y] = screen(selected.xy);
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#ffbd6842';
      ctx.fill();
      ctx.strokeStyle = amber;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 3.7, 0, Math.PI * 2);
      ctx.fillStyle = amber;
      ctx.fill();
    }
    if (keyboard) {
      ctx.beginPath();
      ctx.arc(keyboard[0], keyboard[1], 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#deffef';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    paintCandidates();
    ctx.restore();
  }

  function draw(now) {
    frame = 0;
    if (!view) return;
    if (transition) {
      const { start, duration, from, to } = transition;
      const progress = clamp((now - start) / duration, 0, 1);
      const t = smooth(progress);
      view = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), k: lerp(from.k, to.k, t) };
      borders = lerp(transition.fromBorders, transition.toBorders, smooth(clamp((progress - .16) / .84, 0, 1)));
      isolation = lerp(transition.fromIsolation, transition.toIsolation, t);
      if (progress === 1) transition = undefined;
    }
    if (zoomTarget) {
      const elapsed = clamp(now - (lastFrame ?? now - 16), 1, 32);
      const rate = 1 - Math.exp(-elapsed / 44);
      const { x, y, k } = zoomTarget;
      view = { x: lerp(view.x, x, rate), y: lerp(view.y, y, rate), k: lerp(view.k, k, rate) };
      if (Math.hypot(view.x - x, view.y - y) < .2 && Math.abs(view.k - k) < .0005) {
        view = zoomTarget;
        zoomTarget = undefined;
      }
    }
    lastFrame = now;
    if (hover && !transition && !zoomTarget && !drag) {
      canvas.style.cursor = locate(hover, 8) ? 'crosshair' : '';
      hover = undefined;
    }
    if (dirty) {
      const { width, height, dpr } = size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintMap(width, height);
      paintAreas();
      paintPoints(width, height);
      dirty = false;
      if (resolvePainted) { resolvePainted(true); resolvePainted = undefined; }
    }
    if (transition || zoomTarget) schedule();
  }

  function relative(event) {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function locate([x, y], tolerance) {
    let nearest, distance = tolerance;
    for (const site of sites) {
      const [px, py] = screen(site.xy);
      const gap = Math.hypot(x - px, y - py);
      if (gap < distance) {
        nearest = site;
        distance = gap;
      }
    }
    if (nearest) return { point: nearest.point, region: nearest.region, site: nearest };
    const mapX = (x - view.x) / view.k;
    const mapY = (y - view.y) / view.k;
    if (mapX < west || mapX > east || mapY < north || mapY > south) return null;
    const point = unproject(mapX, mapY);
    const region = point && assets.regionAt(...point);
    return region ? { point, region } : null;
  }

  function pick(position, tolerance = 8) {
    const result = locate(position, tolerance);
    if (result) onPick(selection(result.point, result.region, result.site));
    else onMiss();
  }

  function constrain(next) {
    const marginX = size.width * .17;
    const marginY = size.height * .16;
    return {
      k: next.k,
      x: clamp(next.x, marginX - east * next.k, size.width - marginX - west * next.k),
      y: clamp(next.y, marginY - south * next.k, size.height - marginY - north * next.k),
    };
  }

  function stopCamera() {
    transition = undefined;
    zoomTarget = undefined;
    borders = 1;
    isolation = 0;
  }

  function zoom(factor, pivot) {
    if (!active || selected) return;
    const fitted = fit();
    if (factor === 1) {
      animate(fitted, 1, 0, 320);
      return;
    }
    const current = zoomTarget ?? view;
    const [x, y] = pivot ?? [size.width / 2, size.height / 2];
    const k = clamp(current.k * factor, fitted.k, fitted.k * 5);
    const target = k === fitted.k ? fitted : constrain({
      x: x - (x - current.x) * k / current.k, y: y - (y - current.y) * k / current.k, k,
    });
    stopCamera();
    if (reducedMotion()) view = target;
    else zoomTarget = target;
    schedule();
  }

  function midpoint([a, b]) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  function gap([a, b]) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  function startPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    const [x, y] = midpoint(pair);
    stopCamera();
    pinch = { distance: Math.max(gap(pair), 1), view, anchor: [(x - view.x) / view.k, (y - view.y) / view.k] };
    drag = undefined;
  }

  function pointerDown(event) {
    if (!active || event.button !== 0 || (selected && pointers.size)) return;
    keyboard = undefined;
    hover = undefined;
    zoomTarget = undefined;
    const position = relative(event);
    pointers.set(event.pointerId, position);
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 1) drag = { start: position, view, moved: false };
    else if (pointers.size === 2) startPinch();
    schedule();
  }

  function pointerMove(event) {
    if (!active) return;
    const position = relative(event);
    if (!pointers.has(event.pointerId)) {
      if (pointers.size === 0 && event.pointerType === 'mouse') {
        hover = position;
        schedule(false);
      }
      return;
    }
    pointers.set(event.pointerId, position);
    if (pinch) {
      const pair = [...pointers.values()].slice(0, 2);
      const [x, y] = midpoint(pair);
      const base = fit().k;
      const k = clamp(pinch.view.k * gap(pair) / pinch.distance, base, base * 5);
      const [anchorX, anchorY] = pinch.anchor;
      view = k === base ? fit() : constrain({ x: x - anchorX * k, y: y - anchorY * k, k });
    } else if (drag) {
      const dx = position[0] - drag.start[0];
      const dy = position[1] - drag.start[1];
      drag.moved ||= Math.hypot(dx, dy) > 5;
      if (!selected && drag.moved) {
        stopCamera();
        view = constrain({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy });
        canvas.style.cursor = 'grabbing';
      }
    }
    schedule();
  }

  function pointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    const position = relative(event);
    if (event.type === 'pointerup' && drag && !drag.moved && gap([position, drag.start]) < 8) {
      pick(position, event.pointerType === 'touch' ? 13 : 8);
    }
    if (pointers.size >= 2) startPinch();
    else {
      pinch = undefined;
      drag = pointers.size ? { start: [...pointers.values()][0], view, moved: true } : undefined;
    }
    canvas.style.cursor = '';
    schedule();
  }

  function leave() {
    hover = undefined;
    gestureScale = undefined;
    canvas.style.cursor = '';
  }

  function wheel(event) {
    if (!active || selected || !event.deltaY) return;
    if (!event.ctrlKey && Math.abs(event.deltaX) > 1.3 * Math.abs(event.deltaY)) return;
    if (event.cancelable) event.preventDefault();
    if (gestureScale !== undefined) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    const limit = event.ctrlKey ? 48 : 100;
    const delta = clamp(event.deltaY * units, -limit, limit);
    zoom(Math.exp(-delta / (event.ctrlKey ? 120 : 360)), relative(event));
  }

  function gestureStart(event) {
    if (!active || selected) return;
    event.preventDefault();
    gestureScale = event.scale || 1;
  }

  function gestureChange(event) {
    if (gestureScale === undefined) return;
    event.preventDefault();
    if (event.scale > 0 && event.scale !== gestureScale) {
      zoom(event.scale / gestureScale, relative(event));
      gestureScale = event.scale;
    }
  }

  function gestureEnd(event) {
    if (gestureScale === undefined) return;
    event.preventDefault();
    gestureScale = undefined;
  }

  function keyDown(event) {
    if (!active || event.ctrlKey || event.metaKey || event.altKey) return;
    const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (movement || event.key === 'Enter' || event.key === ' ') {
      keyboard ??= screen(sites[0].xy);
      if (movement) {
        const step = event.shiftKey ? 25 : 8;
        keyboard = keyboard.map((value, index) => clamp(value + movement[index] * step, 5, (index ? size.height : size.width) - 5));
      } else pick(keyboard);
      schedule();
    } else if (event.key === '+' || event.key === '=') zoom(1.35);
    else if (event.key === '-') zoom(1 / 1.35);
    else if (event.key === 'Home') zoom(1);
    else return;
    event.preventDefault();
  }

  function blur() {
    keyboard = undefined;
    schedule();
  }

  const handlers = {
    pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd,
    pointercancel: pointerEnd, lostpointercapture: pointerEnd, pointerleave: leave,
    wheel, gesturestart: gestureStart, gesturechange: gestureChange, gestureend: gestureEnd,
    keydown: keyDown, blur,
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  for (const [event, handler] of Object.entries(handlers)) {
    canvas.addEventListener(event, handler, event === 'wheel' || event.startsWith('gesture') ? { passive: false } : undefined);
  }
  return {
    enter, prepareReveal, finishReveal, show, zoom, setContext, whenPainted: () => painted,
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (resolvePainted) { resolvePainted(false); resolvePainted = undefined; }
      for (const [event, handler] of Object.entries(handlers)) canvas.removeEventListener(event, handler);
    },
  };
}
