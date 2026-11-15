'use client';

import dynamic from 'next/dynamic';

const DashboardChart = dynamic(() => import('./DashboardChart'), {
  ssr: false,
  loading: () => <p className="chart-placeholder" role="status">Loading chart…</p>,
});

export default DashboardChart;
