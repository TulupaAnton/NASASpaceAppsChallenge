export const unknown = '[unknown]';
const oneDecimal = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'negative' });
const signedOne = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const signedTwo = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });

export const valueText = (value, unit = '') => Number.isFinite(value) ? oneDecimal.format(value) + (unit ? ' ' + unit : '') : unknown;
export const deltaText = (value, unit = '') => Number.isFinite(value) ? signedOne.format(value) + (unit ? ' ' + unit : '') : unknown;
export const slopeText = value => Number.isFinite(value) ? signedTwo.format(value) + ' °C per decade' : unknown;
export const significanceText = value => value === true ? 'Confirmed' : value === false ? 'Not confirmed' : unknown;
export const percentText = value => Number.isFinite(value) ? Math.round(value * 100) + '%' : unknown;

export function probabilityText(value) {
  if (!Number.isFinite(value)) return unknown;
  if (value < .001) return 'p < 0.001';
  const rounded = value.toFixed(3);
  if (rounded === '0.050' && value < .05) return 'p < 0.050';
  return 'p = ' + rounded;
}
