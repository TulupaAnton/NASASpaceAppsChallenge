const PRECISION = 100_000;
const text = new TextDecoder();

export function decodeFinlandGeometry(bytes) {
  if (text.decode(bytes.subarray(0, 4)) !== 'TFG1') {
    throw new Error('Unrecognized Finland geometry format');
  }

  let offset = 4;
  function unsigned() {
    let value = 0;
    let shift = 0;
    while (offset < bytes.length && shift < 28) {
      const byte = bytes[offset++];
      value += (byte & 127) * (1 << shift);
      if (byte < 128) return value;
      shift += 7;
    }
    throw new Error('Incomplete Finland geometry data');
  }

  function delta() {
    const value = unsigned();
    return value % 2 ? -(value + 1) / 2 : value / 2;
  }

  function group(readItem) {
    const count = unsigned();
    if (count > bytes.length - offset) throw new Error('Invalid Finland geometry group');
    return Array.from({ length: count }, readItem);
  }

  // Each ring starts at (0, 0); following vertices store signed differences
  // in 1e-5 degree units, preserving the source coordinate precision.
  function ring() {
    let x = 0;
    let y = 0;
    return group(() => {
      x += delta();
      y += delta();
      return [x / PRECISION, y / PRECISION];
    });
  }

  function region() {
    const length = unsigned();
    if (offset + length > bytes.length) throw new Error('Incomplete region name');
    const name = text.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return { name, polygons: group(() => group(ring)) };
  }

  const regionData = group(region);
  const rings = group(ring);
  if (offset !== bytes.length) throw new Error('Unexpected trailing Finland geometry data');
  return { regionData, rings };
}

export async function loadFinlandGeometry(source = "assets/finland-geometry.bin") {
  const url = source;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Finland geometry request failed');
  return decodeFinlandGeometry(new Uint8Array(await response.arrayBuffer()));
}
