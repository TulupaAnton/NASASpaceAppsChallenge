// Equirectangular projection scaled at Mongolia's central latitude.
const xScale = 32 * Math.cos(46.8 * Math.PI / 180);
const yScale = 32;

export function projectMongolia(lon, lat) {
  return [640 + (lon - 103.5) * xScale, 360 - (lat - 46.8) * yScale];
}

export function unprojectMongolia(x, y) {
  return [103.5 + (x - 640) / xScale, 46.8 + (360 - y) / yScale];
}
