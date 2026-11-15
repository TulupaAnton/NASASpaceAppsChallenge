import { getCountry } from './countries.js';
import { prepareMapArtwork } from './map-artwork.js';

self.onmessage = async ({ data: code }) => {
  try {
    const config = getCountry(code);
    const [imageResponse, geometryResponse] = await Promise.all([fetch(config.image), fetch(config.geometry)]);
    if (!imageResponse.ok || !geometryResponse.ok) throw new Error('Unable to load country map');
    const [image, geometry] = await Promise.all([createImageBitmap(await imageResponse.blob()), geometryResponse.json()]);
    const artwork = prepareMapArtwork(image, geometry, () => new OffscreenCanvas(1, 1));
    const transfers = [image];
    async function pixels(layer) {
      // Resolve the deferred canvas commands here, away from the animation thread.
      const bitmap = await createImageBitmap(layer.bitmap);
      layer.bitmap.width = layer.bitmap.height = 1;
      transfers.push(bitmap);
      return { ...layer, bitmap };
    }
    const [cutout, borders, zoomBorders] = await Promise.all([
      pixels(artwork.cutout), pixels(artwork.borders), pixels(artwork.zoomBorders),
    ]);
    const highlights = new Map();
    for (const name of artwork.regionNames) highlights.set(name, await pixels(artwork.highlight(name)));
    self.postMessage({ image, geometry, bounds: artwork.bounds, cutout, borders, zoomBorders, highlights }, transfers);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
