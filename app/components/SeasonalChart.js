'use client';

import { useEffect, useRef } from 'react';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { months, resourceKey } from '../lib/chart-data';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export default function SeasonalChart({ rows, kind, peakMonth, windHeight = 100, windKey = 'wind_speed_100m_ms' }) {
  const node = useRef(null);
  const solar = kind === 'solar';
  useEffect(() => {
    const key = solar ? resourceKey('solar') : windKey;
    const chart = new Chart(node.current, {
      type: 'bar',
      data: {
        labels: rows.map(row => months[row.month - 1]),
        datasets: [{
          label: solar ? 'Solar irradiation' : 'Wind speed',
          data: rows.map(row => row[key]),
          backgroundColor: rows.map(row => row.month === peakMonth
            ? (solar ? '#ffc477' : '#9bddff')
            : (solar ? '#bf8b51b8' : '#68a8c6bb')),
          hoverBackgroundColor: solar ? '#ffc477' : '#8ad8ff',
          borderRadius: 3,
          maxBarThickness: 19,
        }],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false }, border: { color: '#20312c' },
            ticks: { color: '#a3adab', font: { size: 10 }, callback: (_, index) => index % 2 ? '' : months[rows[index].month - 1] },
          },
          y: {
            beginAtZero: true, border: { display: false }, grid: { color: '#1e302a' },
            ticks: { color: '#a3adab', maxTicksLimit: 4, font: { size: 10 } },
          },
        },
        plugins: {
          tooltip: { callbacks: { label: ({ formattedValue }) => formattedValue + (solar ? ' kWh/m²' : ' m/s') } },
        },
      },
    });
    return () => chart.destroy();
  }, [rows, peakMonth, solar, windKey]);

  return <div className="seasonal-chart"><canvas ref={node} role="img" aria-label={solar ? 'Mean monthly solar irradiation' : `Mean monthly wind speed at ${windHeight} metres`} /></div>;
}
