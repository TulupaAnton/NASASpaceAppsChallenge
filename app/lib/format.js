const formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 1, signDisplay: 'negative' });
export const number = (value, unit = '') => Number.isFinite(value)
  ? `${formatter.format(value)}${unit ? ` ${unit}` : ''}`
  : '—';

export const coordinates = (lat, lon) => `${lat.toFixed(3)}° N  /  ${lon.toFixed(3)}° E`;
export const regionName = name => name?.split(' (')[0];
