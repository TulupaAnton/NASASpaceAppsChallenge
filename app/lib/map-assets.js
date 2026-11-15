import { loadFinlandGeometry } from '../../public/legacy/finland-geometry';
import { collectRegions, findRegion, IMAGE_HEIGHT, IMAGE_WIDTH } from '../../public/legacy/projection';
import { countries } from './countries';
import { countrySites } from './sites';

const pending = new Map();

function addRing(path, ring, project, bounds) {
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

function regionLookup(regionData) {
  const cells = new Map();
  const cellIndex = value => Math.floor(value * 2);
  for (const region of collectRegions(regionData)) {
    for (const polygon of region.polygons) {
      const [west, south, east, north] = polygon.bounds.map(cellIndex);
      for (let x = west; x <= east; x++) {
        for (let y = south; y <= north; y++) {
          const key = x * 512 + y;
          let cell = cells.get(key);
          if (!cell) cells.set(key, cell = []);
          if (cell.at(-1)?.name !== region.name) cell.push({ name: region.name, polygons: [] });
          cell.at(-1).polygons.push(polygon);
        }
      }
    }
  }
  return (longitude, latitude) => {
    const cell = cells.get(cellIndex(longitude) * 512 + cellIndex(latitude));
    return cell ? findRegion(cell, longitude, latitude) : null;
  };
}

function rasterize([west, north, east, south], precision, draw) {
  const x = Math.floor(west) - 4;
  const y = Math.floor(north) - 4;
  const width = Math.ceil(east) + 4 - x;
  const height = Math.ceil(south) + 4 - y;
  const bitmap = document.createElement('canvas');
  bitmap.width = width * precision;
  bitmap.height = height * precision;
  const context = bitmap.getContext('2d');
  context.setTransform(precision, 0, 0, precision, -x * precision, -y * precision);
  draw(context);
  return { bitmap, x, y, width, height };
}

function prepareMap(image, { rings, regionData }, { id, project, unproject }) {
  const country = new Path2D();
  const outline = new Path2D();
  const islands = new Path2D();
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    const ringPath = new Path2D();
    addRing(ringPath, ring, project, bounds);
    const [startX, startY] = ring[0];
    const major = ring.some(([x, y]) => Math.abs(x - startX) > .16 || Math.abs(y - startY) > .16);
    country.addPath(ringPath);
    (major ? outline : islands).addPath(ringPath);
  }

  const allRegions = new Path2D();
  const paths = new Map();
  for (const region of regionData) {
    const path = new Path2D();
    for (const polygon of region.polygons) {
      for (const ring of polygon) addRing(path, ring, project);
    }
    allRegions.addPath(path);
    paths.set(region.name, path);
  }

  const cutout = rasterize(bounds, 2, ctx => {
    ctx.clip(country, 'evenodd');
    ctx.drawImage(image, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  });

  function borderLayer(scale) {
    return rasterize(bounds, 2, ctx => {
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
    const path = paths.get(name);
    highlightLayer = path ? rasterize(bounds, 2, ctx => {
      ctx.fillStyle = 'rgba(255, 175, 94, .30)';
      ctx.fill(path, 'evenodd');
      ctx.lineWidth = 1.05;
      ctx.strokeStyle = '#ffbf77e0';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }) : undefined;
    return highlightLayer;
  }

  return {
    country: id, sites: countrySites[id], unproject,
    image, bounds, cutout, borders, zoomBorders, highlight, regionAt: regionLookup(regionData),
  };
}

async function loadCountryGeometry(country) {
  const folder = country === 'ca' ? 'canada' : 'mongolia';
  const response = await fetch(`/${folder}/geometry.json`);
  if (!response.ok) throw new Error(`${countries[country].name} boundaries could not be loaded.`);
  return response.json();
}

export function loadMap(country) {
  if (!pending.has(country)) {
    const config = countries[country];
    const image = new Image();
    image.src = config.satellite;
    const geometry = country === 'fi'
      ? loadFinlandGeometry('/legacy/assets/finland-geometry.bin')
      : loadCountryGeometry(country);
    const task = Promise.all([image.decode(), geometry])
      .then(([, data]) => prepareMap(image, data, config))
      .catch(error => {
        pending.delete(country);
        throw error;
      });
    pending.set(country, task);
  }
  return pending.get(country);
}
