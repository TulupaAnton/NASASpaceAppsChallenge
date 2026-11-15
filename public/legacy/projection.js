const radians = Math.PI / 180;
const polar = 0.996647189335;
const lens = 0.34432761328966527;
const mapCamera = [0.49330378031942257, 0.24273555263058783, 1.1758124135301897];
const right = [-0.44150585279174515, 0.8972583696743285, 0];
const up = [-0.812794706630921, -0.39994457808841805, 0.4235671131360794];

export const IMAGE_WIDTH = 1280;
export const IMAGE_HEIGHT = 720;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const forward = mapCamera.map(value => -value / Math.hypot(...mapCamera));

export function project(lon, lat) {
  const phi = lat * radians;
  const lambda = lon * radians;
  const p = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi) * polar];
  const ray = p.map((value, index) => value - mapCamera[index]);
  const magnitude = IMAGE_HEIGHT / (2 * lens * dot(ray, forward));
  return [IMAGE_WIDTH / 2 + dot(ray, right) * magnitude, IMAGE_HEIGHT / 2 - dot(ray, up) * magnitude];
}

export function unproject(x, y) {
  const sx = (x - IMAGE_WIDTH / 2) * 2 * lens / IMAGE_HEIGHT;
  const sy = (IMAGE_HEIGHT / 2 - y) * 2 * lens / IMAGE_HEIGHT;
  const o = [mapCamera[0], mapCamera[1], mapCamera[2] / polar];
  const d = forward.map((value, index) => (value + right[index] * sx + up[index] * sy) / (index === 2 ? polar : 1));
  const a = dot(d, d);
  const b = dot(o, d);
  const discriminant = b * b - a * (dot(o, o) - 1);
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  const [px, py, pz] = o.map((value, index) => value + t * d[index]);
  return [Math.atan2(py, px) / radians, Math.asin(Math.max(-1, Math.min(1, pz))) / radians];
}

export function collectRegions(data) {
  return data.map(region => ({
    name: region.name,
    polygons: region.polygons.map(rings => {
      const outer = rings[0];
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of outer) {
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
      return { rings, bounds };
    }),
  }));
}

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

export function findRegion(regions, lon, lat) {
  for (const region of regions) {
    for (const { rings, bounds } of region.polygons) {
      if (lon < bounds[0] || lat < bounds[1] || lon > bounds[2] || lat > bounds[3]) continue;
      if (insideRing(lon, lat, rings[0]) && !rings.slice(1).some(ring => insideRing(lon, lat, ring))) return region.name;
    }
  }
  return null;
}
