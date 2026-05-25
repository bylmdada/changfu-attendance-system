'use client';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface TrendPoint {
  ym: string;
  due: number;
  done: number;
}

export default function PropertyTrendChart({ trend }: { trend: TrendPoint[] }) {
  return (
    <Bar
      data={{
        labels: trend.map((t) => t.ym),
        datasets: [
          {
            label: '應維護',
            data: trend.map((t) => t.due),
            backgroundColor: 'rgba(249,115,22,0.6)',
          },
          {
            label: '已完成',
            data: trend.map((t) => t.done),
            backgroundColor: 'rgba(34,197,94,0.6)',
          },
        ],
      }}
      options={{ responsive: true, plugins: { legend: { position: 'top' as const } } }}
    />
  );
}
