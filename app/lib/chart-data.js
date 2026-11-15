export const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const resourceKey = kind => kind === 'solar' ? 'solar_kwh_m2' : 'wind_speed_100m_ms';

export function annualTemperatures(monthly) {
  const years = new Map();
  for (const { date, t2m_c } of monthly) {
    if (typeof date !== 'string' || !Number.isFinite(t2m_c)) continue;
    const [year, month] = date.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    if (!years.has(year)) years.set(year, new Map());
    years.get(year).set(month, t2m_c);
  }

  return [...years.entries()].sort(([a], [b]) => a - b).map(([year, values]) => {
    if (values.size !== 12) return { year, temperature: null };
    let total = 0, days = 0;
    for (const [month, value] of values) {
      const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
      total += value * monthDays;
      days += monthDays;
    }
    return { year, temperature: total / days };
  });
}
