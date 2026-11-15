'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  BarController, BarElement, CategoryScale, Chart, Filler, LinearScale,
  LineController, LineElement, PointElement, Tooltip,
} from 'chart.js';
import { valueText } from '../lib/analysis-format';

Chart.register(BarController, BarElement, CategoryScale, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip);

export default function DashboardChart({ spec }) {
  const canvas = useRef(null);
  const tipId = useId();
  const [active, setActive] = useState(null);
  const index = Math.min(active ?? spec.preferred ?? Math.max(spec.labels.length - 1, 0), spec.labels.length - 1);

  useEffect(() => {
    const css = getComputedStyle(canvas.current);
    const ink = css.getPropertyValue('--ink').trim();
    const muted = css.getPropertyValue('--muted').trim();
    const line = css.getPropertyValue('--line').trim();
    const colors = {
      mint: css.getPropertyValue('--mint').trim(), amber: css.getPropertyValue('--amber').trim(),
      water: css.getPropertyValue('--water').trim(), muted, ink, line,
    };
    const resolve = color => colors[color] ?? color ?? muted;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const axis = { color: muted, font: { family: 'DM Sans, system-ui, sans-serif', size: 11 } };
    const unit = { display: true, text: spec.axisLabel ?? spec.unit, color: ink, font: axis.font };
    const category = { grid: { display: false }, ticks: { ...axis, maxTicksLimit: spec.tickLimit ?? 7 } };
    const valueAxis = {
      ticks: { ...axis, maxTicksLimit: spec.horizontal ? 5 : 6 },
      grid: { color: line },
      title: unit,
      beginAtZero: spec.zero ?? false,
      ...(spec.limits ?? {}),
    };
    const chart = new Chart(canvas.current, {
      type: spec.type,
      data: {
        labels: spec.labels,
        datasets: spec.series.map(({ data, label, tone, fill, dash, peak, stack }) => ({
          data, label, stack,
          borderColor: resolve(tone), borderDash: dash, borderWidth: spec.type === 'line' ? 2 : 0,
          backgroundColor: peak === undefined
            ? (fill ? resolve(tone) + '1F' : resolve(tone))
            : data.map((_, i) => resolve(tone) + (i === peak ? 'FF' : '82')),
          pointBackgroundColor: resolve(tone), pointRadius: spec.markers ? 2 : 0,
          pointHoverRadius: 4, borderRadius: 4, maxBarThickness: spec.horizontal ? 25 : 32,
          fill: fill ? 'origin' : false, spanGaps: false,
        })),
      },
      options: {
        animation: { duration: reduced ? 0 : 180 },
        transitions: { active: { animation: { duration: reduced ? 0 : 180 } }, resize: { animation: { duration: 0 } } },
        responsive: true, maintainAspectRatio: false,
        indexAxis: spec.horizontal ? 'y' : 'x',
        interaction: { mode: 'index', axis: spec.horizontal ? 'y' : 'x', intersect: false },
        onHover: (_, elements) => { if (elements.length) setActive(elements[0].index); },
        onClick: (_, elements) => { if (elements.length) setActive(elements[0].index); },
        layout: { padding: { left: 3, right: 9, top: 4, bottom: 3 } },
        scales: spec.horizontal ? {
          x: { ...valueAxis, stacked: spec.stacked },
          y: { ...category, stacked: spec.stacked, ticks: { ...axis, display: !spec.compact } },
        } : { x: category, y: valueAxis },
        plugins: { tooltip: { enabled: false } },
      },
    });
    return () => chart.destroy();
  }, [spec]);

  function handleArrow(event) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    setActive(Math.min(spec.labels.length - 1, Math.max(0, index + step)));
  }

  return <figure className={'dashboard-chart' + (spec.compact ? ' compact-chart' : '')}>
    <div className="dashboard-plot" tabIndex={0} role="group" aria-label={spec.title} aria-describedby={tipId}
      onKeyDown={handleArrow}>
      <canvas role="img" aria-label={spec.title + ' (' + spec.unit + ')'} ref={canvas} />
    </div>
    <div className={'chart-readout' + (spec.compact && active === null ? ' sr-only' : '')} id={tipId}>
      <span className="sr-only">Use arrow keys to read chart values. </span>
      <output aria-live="polite">
        <strong>{spec.labels[index]}{index === spec.preferred && spec.peakLabel ? ' · Peak' : ''}</strong>
        {spec.series.map(series => <span key={series.label}>{series.label} {valueText(series.data[index], spec.unit)}</span>)}
      </output>
    </div>
  </figure>;
}
