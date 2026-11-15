// Spherical Lambert conformal conic for the Canada map (standard parallels 49°N and 77°N).
const rad = Math.PI / 180;
const centralMeridian = -96;
const first = 49 * rad;
const second = 77 * rad;
const tangent = phi => Math.tan(Math.PI / 4 + phi / 2);
const n = Math.log(Math.cos(first) / Math.cos(second)) / Math.log(tangent(second) / tangent(first));
const f = Math.cos(first) * tangent(first) ** n / n;
const originRadius = f / tangent(57 * rad) ** n;
const scale = 810;

export function projectCanada(lon, lat) {
  const theta = n * (lon - centralMeridian) * rad;
  const radius = f / tangent(lat * rad) ** n;
  return [640 + scale * radius * Math.sin(theta), 420 + scale * (radius * Math.cos(theta) - originRadius)];
}

export function unprojectCanada(x, y) {
  const east = (x - 640) / scale;
  const north = originRadius + (y - 420) / scale;
  const radius = Math.hypot(east, north);
  const lon = centralMeridian + Math.atan2(east, north) / n / rad;
  const lat = (2 * Math.atan((f / radius) ** (1 / n)) - Math.PI / 2) / rad;
  return lon >= -180 && lon <= 180 ? [lon, lat] : null;
}
