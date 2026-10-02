/**
 * ChartSet component-set stories.
 * One variant per chart type, with appropriate sample data.
 */
import ChartSet from './ChartSet.jsx'

const FRAME = {
  width: 560,
  height: 360,
  padding: '1rem',
  background: '#0a0a0a',
  border: '1px solid #1f2937',
  borderRadius: 8,
}

function Frame({ children }) {
  return <div style={FRAME}>{children}</div>
}

const timeSeries = Array.from({ length: 24 }, (_, i) => ({
  t: `${String(i).padStart(2, '0')}:00`,
  v: Math.round(40 + 40 * Math.sin(i / 3) + Math.random() * 15),
}))

const categorical = [
  { label: 'Compute', value: 42 },
  { label: 'Storage', value: 28 },
  { label: 'Network', value: 17 },
  { label: 'Memory', value: 9 },
  { label: 'Other', value: 4 },
]

const radarData = [
  { label: 'CPU', value: 78 },
  { label: 'Memory', value: 62 },
  { label: 'Disk I/O', value: 45 },
  { label: 'Network', value: 88 },
  { label: 'GPU', value: 30 },
  { label: 'Cache', value: 70 },
]

const scatterData = Array.from({ length: 30 }, () => ({
  x: Math.round(Math.random() * 100),
  y: Math.round(Math.random() * 100),
}))

const bubbleData = Array.from({ length: 16 }, () => ({
  x: Math.round(Math.random() * 100),
  y: Math.round(Math.random() * 100),
  r: 4 + Math.round(Math.random() * 18),
}))

export function LineChart() {
  return <Frame><ChartSet type="line" data={timeSeries} unit="req/s" height={320} /></Frame>
}
export function BarChart() {
  return <Frame><ChartSet type="bar" data={timeSeries} unit="req/s" height={320} /></Frame>
}
export function PieChart() {
  return <Frame><ChartSet type="pie" data={categorical} unit="%" height={320} /></Frame>
}
export function DoughnutChart() {
  return <Frame><ChartSet type="doughnut" data={categorical} unit="%" height={320} /></Frame>
}
export function RadarChart() {
  return <Frame><ChartSet type="radar" data={radarData} unit="score" height={320} /></Frame>
}
export function PolarAreaChart() {
  return <Frame><ChartSet type="polarArea" data={categorical} unit="%" height={320} /></Frame>
}
export function ScatterChart() {
  return <Frame><ChartSet type="scatter" data={scatterData} unit="value" height={320} /></Frame>
}
export function BubbleChart() {
  return <Frame><ChartSet type="bubble" data={bubbleData} unit="value" height={320} /></Frame>
}
