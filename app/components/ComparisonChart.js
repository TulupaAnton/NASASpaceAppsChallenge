'use client';

import { useEffect, useRef } from 'react';
import {
  BarController, BarElement, CategoryScale, Chart, LinearScale,
  LineController, LineElement, PointElement, Tooltip,
} from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip);

export default function ComparisonChart({ labels, datasets, metric }) {
  const node = useRef(null);
  useEffect(() => {
    const scores = metric.key === 'score';
    const chart = new Chart(node.current, {
      type: scores ? 'bar' : 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#bac9c3', maxTicksLimit: 7 } },
          y: {
            grid: { color: '#263934' }, ticks: { color: '#bac9c3', maxTicksLimit: 6 },
            beginAtZero: metric.key !== 'temperature',
            ...(scores ? { min: 0, max: 100 } : {}),
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: item => `${item.dataset.siteLabels?.[item.dataIndex] ?? item.dataset.label}  ${item.formattedValue} ${metric.unit}`,
            },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, datasets, metric]);
  return <div className="comparison-canvas"><canvas ref={node} role="img" aria-label={metric.title + ' for the selected sites'} /></div>;
}
