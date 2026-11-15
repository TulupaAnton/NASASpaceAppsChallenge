import { createMapProjection } from './map-projections.js';

function addRing(path, ring, bounds, project) {
  for (const [index, point] of ring.entries()) {
    const [x, y] = project(...point);
    if (index) path.lineTo(x, y);
    else path.moveTo(x, y);
    if (bounds) {
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  path.closePath();
}

function rasterize([west, north, east, south], precision, draw, createCanvas) {
  const x = Math.floor(west) - 4;
  const y = Math.floor(north) - 4;
  const width = Math.ceil(east) + 4 - x;
  const height = Math.ceil(south) + 4 - y;
  const bitmap = createCanvas();
  bitmap.width = width * precision;
  bitmap.height = height * precision;
  const context = bitmap.getContext('2d');
  context.setTransform(precision, 0, 0, precision, -x * precision, -y * precision);
  draw(context);
  return { bitmap, x, y, width, height };
}

export function prepareMapArtwork(image, { rings, regionData, projection: definition }, createCanvas = () => document.createElement('canvas')) {
  const raster = (bounds, draw) => rasterize(bounds, 2, draw, createCanvas);
  const projection = createMapProjection(definition);
  const { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, project } = projection;
  const country = new Path2D();
  const outline = new Path2D();
  const islands = new Path2D();
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    const ringPath = new Path2D();
    addRing(ringPath, ring, bounds, project);
    const [startX, startY] = ring[0];
    const major = ring.some(([x, y]) => Math.abs(x - startX) > .16 || Math.abs(y - startY) > .16);
    country.addPath(ringPath);
    (major ? outline : islands).addPath(ringPath);
  }

  const allRegions = new Path2D();
  const paths = new Map();
  for (const region of regionData) {
    const path = new Path2D();
    const regionBounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of region.polygons) {
      for (const ring of polygon) addRing(path, ring, regionBounds, project);
    }
    allRegions.addPath(path);
    paths.set(region.name, { path, bounds: regionBounds });
  }

  const cutout = raster(bounds, ctx => {
    ctx.clip(country, 'evenodd');
    ctx.drawImage(image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  });

  function borderLayer(scale) {
    return raster(bounds, ctx => {
      ctx.fillStyle = 'rgba(106, 199, 169, .12)';
      ctx.fill(country, 'evenodd');
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = .67 / scale;
      ctx.strokeStyle = 'rgba(167, 229, 197, .52)';
      ctx.stroke(allRegions);
      ctx.lineWidth = .46 / scale;
      ctx.strokeStyle = '#9befbe92';
      ctx.stroke(islands);
      ctx.lineWidth = 2.3 / scale;
      ctx.strokeStyle = '#071411bc';
      ctx.stroke(outline);
      ctx.lineWidth = 1.15 / scale;
      ctx.strokeStyle = '#b7f3d6';
      ctx.stroke(outline);
    });
  }

  const borders = borderLayer(1);
  const zoomBorders = borderLayer(2.1);
  let highlightedName, highlightLayer;
  function highlight(name) {
    if (name === highlightedName) return highlightLayer;
    highlightedName = name;
    const region = paths.get(name);
    const path = region?.path;
    highlightLayer = path ? raster(region.bounds, ctx => {
      ctx.fillStyle = 'rgba(255, 175, 94, .30)';
      ctx.fill(path, 'evenodd');
      ctx.lineWidth = 1.05;
      ctx.strokeStyle = '#ffbf77e0';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }) : undefined;
    return highlightLayer;
  }

  return { bounds, cutout, borders, zoomBorders, highlight, regionNames: [...paths.keys()] };
}
