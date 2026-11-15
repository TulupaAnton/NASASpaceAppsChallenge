// Reproject the bundled NASA Blue Marble texture into the Mongolia map's grid.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { unprojectMongolia } from '../app/lib/mongolia-projection.js';
import { IMAGE_HEIGHT, IMAGE_WIDTH } from '../public/legacy/projection.js';

const input = new URL('../public/earth/earth-day.jpg', import.meta.url);
const output = new URL('../public/mongolia/satellite.webp', import.meta.url);
const { data, info } = await sharp(await readFile(input))
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const scale = 2;
const width = IMAGE_WIDTH * scale;
const height = IMAGE_HEIGHT * scale;
const pixels = Buffer.alloc(width * height * 3);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const point = unprojectMongolia((x + .5) / scale, (y + .5) / scale);
    if (!point) continue;
    const [lon, lat] = point;
    const u = Math.max(0, Math.min(info.width - 1.001, (lon + 180) / 360 * info.width - .5));
    const v = Math.max(0, Math.min(info.height - 1.001, (90 - lat) / 180 * info.height - .5));
    const row = Math.floor(v), column = Math.floor(u);
    const fx = u - column, fy = v - row;
    const top = (row * info.width + column) * 3;
    const bottom = top + info.width * 3;
    const index = (y * width + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
      const upper = data[top + channel] * (1 - fx) + data[top + 3 + channel] * fx;
      const lower = data[bottom + channel] * (1 - fx) + data[bottom + 3 + channel] * fx;
      pixels[index + channel] = Math.round(upper * (1 - fy) + lower * fy);
    }
  }
}

await sharp(pixels, { raw: { width, height, channels: 3 } })
  .webp({ quality: 86 }).toFile(fileURLToPath(output));
