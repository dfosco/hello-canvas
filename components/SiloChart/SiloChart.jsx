import { Line } from 'react-chartjs-2'
import 'chart.js/auto'

export default function SiloChart({ data, unit }) {
  const points = Array.isArray(data) ? data : []
  const labels = points.map((p) => p?.t ?? '')
  const values = points.map((p) => p?.v ?? 0)

  const chartData = {
    labels,
    datasets: [
      {
        label: unit ?? '',
        data: values,
        borderColor: '#d3a134',
        backgroundColor: 'rgba(211,161,52,0.18)',
        borderWidth: 1.5,
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0a0a0a',
        borderColor: '#372f1f',
        borderWidth: 1,
        titleColor: '#ebe9e5',
        bodyColor: '#afa99c',
        callbacks: {
          label: (ctx) => `${ctx.parsed.y} ${unit ?? ''}`.trim(),
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#80796b', font: { size: 10 }, maxRotation: 0, autoSkipPadding: 16 },
        grid: { color: '#372f1f' },
        border: { display: false },
      },
      y: {
        ticks: { color: '#80796b', font: { size: 10 } },
        grid: { color: '#372f1f' },
        border: { display: false },
      },
    },
  }

  return (
    <div className="h-64 w-full">
      <Line data={chartData} options={options} />
    </div>
  )
}
