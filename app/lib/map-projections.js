import { IMAGE_WIDTH, IMAGE_HEIGHT, project, unproject } from '../../public/legacy/projection.js';

// Canada uses the same spherical Lambert conformal conic transform for the
// raster, boundary paths and hit testing. All angles at the interface are degrees.
export function createMapProjection(definition) {
  if (!definition) return { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, project, unproject };
  if (definition.type !== 'lambert-conformal-conic') throw new Error('Unsupported map projection');
  const rad = Math.PI / 180;
  const { width, height, parallels, latitude, longitude, scale, translate } = definition;
  const [p1, p2] = parallels.map(value => value * rad);
  const tangent = phi => Math.tan(Math.PI / 4 + phi / 2);
  const n = Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(tangent(p2) / tangent(p1));
  const factor = Math.cos(p1) * tangent(p1) ** n / n;
  const rho0 = factor / tangent(latitude * rad) ** n;
  return {
    width, height,
    project(lon, lat) {
      const theta = n * (lon - longitude) * rad;
      const rho = factor / tangent(lat * rad) ** n;
      return [translate[0] + scale * rho * Math.sin(theta), translate[1] - scale * (rho0 - rho * Math.cos(theta))];
    },
    unproject(x, y) {
      const dx = (x - translate[0]) / scale;
      const dy = rho0 + (y - translate[1]) / scale;
      const rho = Math.hypot(dx, dy);
      if (!rho) return [longitude, 90];
      return [longitude + Math.atan2(dx, dy) / (n * rad), (2 * Math.atan((factor / rho) ** (1 / n)) - Math.PI / 2) / rad];
    },
  };
}
