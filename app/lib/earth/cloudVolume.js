export const CLOUD_DURATION = 5.5;
export const CLOUD_EXIT_DURATION = 4.5;
export const CLOUD_BOTTOM = 2;
export const CLOUD_TOP = 4.8;
export const CLOUD_STEPS = 48;
export const CLOUD_EXTINCTION = 7;

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (value, start, end) => { const t = clamp((value - start) / (end - start)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export function getCloudFrame(progress) {
  const p = clamp(progress), t = p * p * p * (p * (p * 6 - 15) + 10);
  return { altitude: mix(8, 3.5, t), travel: mix(-2.8, 1.4, t), progress: p };
}

export function getCloudExitFrame(progress) {
  const p = clamp(progress), t = p * p * p * (p * (p * 6 - 15) + 10);
  return { altitude: mix(3.5, 1.1, t), travel: mix(1.4, 2.8, t), progress: p };
}

// The renderer and numerical checks use this same deterministic density noise.
export function createCloudNoise(size = 64) {
  const data = new Uint8Array(size * size * size);
  let seed = 20261115;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = (seed >>> 0) >>> 24;
  }
  return { data, size };
}

function noiseAt(volume, point) {
  const { data, size } = volume;
  const base = point.map(Math.floor), f = point.map((v, i) => v - base[i]);
  const wrap = v => ((v % size) + size) % size;
  const at = (x, y, z) => data[wrap(base[0] + x) + size * (wrap(base[1] + y) + size * wrap(base[2] + z))] / 255;
  return mix(mix(mix(at(0, 0, 0), at(1, 0, 0), f[0]), mix(at(0, 1, 0), at(1, 1, 0), f[0]), f[1]),
    mix(mix(at(0, 0, 1), at(1, 0, 1), f[0]), mix(at(0, 1, 1), at(1, 1, 1), f[0]), f[1]), f[2]);
}

export function sampleCloudDensity(volume, point, time = 0) {
  const p = [point[0] + time * .025, point[1], point[2] + time * .012];
  const fbm = q => .57 * noiseAt(volume, q) + .29 * noiseAt(volume, q.map(v => v * 2.03 + 13.7))
    + .14 * noiseAt(volume, q.map(v => v * 4.11 + 27.2));
  const weather = fbm(p.map(v => v * .48));
  const detail = fbm(p.map(v => v * 1.6));
  const shape = smooth(weather * .7 + detail * .3, .45, .72);
  const core = 1 - smooth(Math.hypot(point[0], point[2] - 1.4), .65, 2.5);
  const height = smooth(point[1], CLOUD_BOTTOM, CLOUD_BOTTOM + .35) * (1 - smooth(point[1], CLOUD_TOP - .65, CLOUD_TOP));
  return Math.max(shape, core * 1.4) * height;
}

// Beer–Lambert visibility through the exact field uploaded to the GPU.
export function cloudVisibility(volume, progress, x, y, aspect = 16 / 9) {
  return cloudVisibilityAtFrame(volume, getCloudFrame(progress), x, y, aspect);
}

export function cloudVisibilityAtFrame(volume, frame, x, y, aspect = 16 / 9) {
  const ray = [x * aspect * .384, -1, y * .384 + .22];
  const length = Math.hypot(...ray); ray.forEach((v, i) => { ray[i] = v / length; });
  const start = Math.max(0, (frame.altitude - CLOUD_TOP) / -ray[1]);
  const end = Math.max(0, (frame.altitude - CLOUD_BOTTOM) / -ray[1]);
  const step = Math.max(0, end - start) / CLOUD_STEPS;
  let opticalDepth = 0;
  for (let i = 0; i < CLOUD_STEPS; i++) {
    const distance = start + (i + .5) * step;
    opticalDepth += sampleCloudDensity(volume, [ray[0] * distance, frame.altitude + ray[1] * distance,
      frame.travel + ray[2] * distance]) * step * CLOUD_EXTINCTION;
  }
  return Math.exp(-opticalDepth);
}
