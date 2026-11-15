const formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 1, signDisplay: 'negative' });
export const number = (value, unit = '') => Number.isFinite(value)
  ? `${formatter.format(value)}${unit ? ` ${unit}` : ''}`
  : '—';

export const coordinates = (lat, lon, digits = 3) =>
  `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? 'S' : 'N'}  /  ${Math.abs(lon).toFixed(digits)}° ${lon < 0 ? 'W' : 'E'}`;
export const regionName = name => name?.split(' (')[0];
