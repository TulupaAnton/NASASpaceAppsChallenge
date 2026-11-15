const radians = Math.PI / 180;
const earthKm = 6371.0088;

export function distanceKm(lat, lon, otherLat, otherLon) {
  const halfLat = (otherLat - lat) * radians / 2;
  const halfLon = (otherLon - lon) * radians / 2;
  const a = Math.sin(halfLat) ** 2 + Math.cos(lat * radians) * Math.cos(otherLat * radians) * Math.sin(halfLon) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function destination(lat, lon, km, bearing) {
  const phi = lat * radians;
  const angle = km / earthKm;
  const direction = bearing * radians;
  const nextLat = Math.asin(Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(direction));
  const nextLon = lon + Math.atan2(
    Math.sin(direction) * Math.sin(angle) * Math.cos(phi),
    Math.cos(angle) - Math.sin(phi) * Math.sin(nextLat),
  ) / radians;
  return { lat: nextLat / radians, lon: ((nextLon + 540) % 360) - 180 };
}

export const areaRadii = [50, 100, 150, 200];
