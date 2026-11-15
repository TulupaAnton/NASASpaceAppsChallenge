'use client';

import { useEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5xy from '@amcharts/amcharts5/xy';

const textColor = 0xa3adab;
const gridColor = 0x8ba39b;

export default function TemperatureChart({ rows, modeled }) {
  const node = useRef(null);
  useEffect(() => {
    const root = am5.Root.new(node.current);
    root.utc = true;
    root.fps = 30;
    const chart = root.container.children.push(am5xy.XYChart.new(root, {
      paddingTop: 4, paddingLeft: 0, paddingRight: 6, paddingBottom: 0,
      panX: false, panY: false, wheelX: 'none', wheelY: 'none',
    }));

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 55 });
    const yRenderer = am5xy.AxisRendererY.new(root, { minGridDistance: 29 });
    for (const renderer of [xRenderer, yRenderer]) {
      renderer.labels.template.setAll({ fill: am5.color(textColor), fontSize: 11 });
      renderer.grid.template.setAll({ stroke: am5.color(gridColor), strokeOpacity: .16 });
    }
    xRenderer.grid.template.set('visible', false);
    xRenderer.labels.template.set('maxPosition', .96);

    const x = chart.xAxes.push(am5xy.DateAxis.new(root, {
      baseInterval: { timeUnit: 'year', count: 1 },
      gridIntervals: [{ timeUnit: 'year', count: 2 }, { timeUnit: 'year', count: 5 }, { timeUnit: 'year', count: 10 }],
      tooltipDateFormat: 'yyyy',
      renderer: xRenderer,
    }));
    const y = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yRenderer, extraMin: .05, extraMax: .08 }));
    const lineColor = am5.color(modeled ? 0xffc477 : 0xa3e7c8);
    const series = chart.series.push(am5xy.LineSeries.new(root, {
      xAxis: x, yAxis: y, valueXField: 'date', valueYField: 'temperature',
      stroke: lineColor, fill: lineColor, connect: false,
      tooltip: am5.Tooltip.new(root, { labelText: "{valueX.formatDate('yyyy')}  {valueY.formatNumber('#.#')} °C" }),
    }));
    series.strokes.template.setAll({ strokeWidth: 2.15, strokeDasharray: modeled ? [4, 2] : undefined });
    series.fills.template.setAll({ visible: true, fillOpacity: .11 });
    series.data.setAll(rows.map(row => ({ date: Date.UTC(row.year, 0, 1), temperature: row.temperature })));
    const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { xAxis: x, snapToSeries: [series] }));
    cursor.lineY.set('visible', false);
    cursor.lineX.setAll({ stroke: lineColor, strokeOpacity: .55 });
    return () => root.dispose();
  }, [rows, modeled]);

  return <div className="temperature-chart" ref={node} role="img" aria-label={modeled ? 'Modeled annual air temperature in degrees Celsius' : 'Observed annual air temperature in degrees Celsius'} />;
}
