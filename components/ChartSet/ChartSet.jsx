import {
  Line,
  Bar,
  Pie,
  Doughnut,
  Radar,
  PolarArea,
  Scatter,
  Bubble,
} from 'react-chartjs-2'
import 'chart.js/auto'

const COMPONENTS = {
  line: Line,
  bar: Bar,
  pie: Pie,
  doughnut: Doughnut,
  radar: Radar,
  polarArea: PolarArea,
  scatter: Scatter,
  bubble: Bubble,
}

const PALETTE = [
  '#34d399',
  '#60a5fa',
  '#f472b6',
  '#fbbf24',
  '#a78bfa',
  '#f87171',
  '#22d3ee',
  '#fb923c',
]

const TRANSPARENT_PALETTE = PALETTE.map((c) => c + '55')

function buildDataset({ type, data, unit }) {
  if (!data) return { labels: [], datasets: [] }
  if (data.datasets) return data

  const cycle = (n, arr) => Array.from({ length: n }, (_, i) => arr[i % arr.length])

  if (Array.isArray(data) && data.length && data[0] && 't' in data[0]) {
    const labels = data.map((p) => p?.t ?? '')
    const values = data.map((p) => p?.v ?? 0)
    return {
      labels,
      datasets: [
        {
          label: unit ?? '',
          data: values,
          borderColor: PALETTE[0],
          backgroundColor: type === 'bar' ? PALETTE[0] : 'rgba(52,211,153,0.18)',
          borderWidth: 1.5,
          fill: type === 'line',
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    }
  }

  if (Array.isArray(data) && data.length && data[0] && 'label' in data[0]) {
    const labels = data.map((d) => d.label)
    const values = data.map((d) => d.value ?? 0)
    return {
      labels,
      datasets: [
        {
          label: unit ?? '',
          data: values,
          backgroundColor: TRANSPARENT_PALETTE.slice(0, values.length),
          borderColor: PALETTE.slice(0, values.length),
          borderWidth: 1.5,
        },
      ],
    }
  }

  if (Array.isArray(data) && data.length && data[0] && 'x' in data[0]) {
    // Bubble (has r) → per-entry colors. Scatter → single color.
    const perEntry = 'r' in data[0]
    return {
      datasets: [
        {
          label: unit ?? '',
          data,
          backgroundColor: perEntry ? cycle(data.length, TRANSPARENT_PALETTE) : TRANSPARENT_PALETTE[0],
          borderColor: perEntry ? cycle(data.length, PALETTE) : PALETTE[0],
          borderWidth: 1.5,
        },
      ],
    }
  }

  return { labels: [], datasets: [] }
}

function buildOptions(type) {
  const radial = ['radar', 'polarArea', 'pie', 'doughnut'].includes(type)
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: {
        display: radial,
        position: 'bottom',
        labels: { color: '#9ca3af', font: { size: 10 } },
      },
      tooltip: {
        backgroundColor: '#0a0a0a',
        borderColor: '#1f2937',
        borderWidth: 1,
        titleColor: '#e5e7eb',
        bodyColor: '#9ca3af',
      },
    },
    scales: radial
      ? undefined
      : {
          x: {
            ticks: { color: '#6b7280', font: { size: 10 }, maxRotation: 0, autoSkipPadding: 16 },
            grid: { color: '#1f2937' },
            border: { display: false },
          },
          y: {
            ticks: { color: '#6b7280', font: { size: 10 } },
            grid: { color: '#1f2937' },
            border: { display: false },
          },
        },
  }
}

export default function ChartSet({ type = 'line', data, unit, height = 256 }) {
  const Component = COMPONENTS[type] ?? Line
  const chartData = buildDataset({ type, data, unit })
  const options = buildOptions(type)

  return (
    <div style={{ height, width: '100%' }}>
      <Component data={chartData} options={options} />
    </div>
  )
}
