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

const TRANSPARENT_PALETTE = PALETTE.map(color => `${color}55`)
const WIDTH = 520
const HEIGHT = 280

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function readData(data) {
  if (Array.isArray(data)) {
    if (data[0] && 'label' in data[0]) {
      return {
        labels: data.map(item => String(item?.label ?? '')),
        values: data.map(item => asNumber(item?.value)),
      }
    }
    if (data[0] && 'x' in data[0]) {
      return { points: data.map(item => ({
        x: asNumber(item?.x),
        y: asNumber(item?.y),
        r: Math.max(2, asNumber(item?.r) || 5),
      })) }
    }
    return {
      labels: data.map(item => String(item?.t ?? '')),
      values: data.map(item => asNumber(item?.v)),
    }
  }

  if (data && Array.isArray(data.labels) && Array.isArray(data.datasets)) {
    const dataset = data.datasets[0] ?? {}
    return {
      labels: data.labels.map(label => String(label ?? '')),
      values: Array.isArray(dataset.data) ? dataset.data.map(asNumber) : [],
      points: Array.isArray(dataset.data) && dataset.data.some(point => point && typeof point === 'object' && 'x' in point)
        ? dataset.data.map(point => ({ x: asNumber(point?.x), y: asNumber(point?.y), r: Math.max(2, asNumber(point?.r) || 5) }))
        : null,
    }
  }

  return { labels: [], values: [], points: [] }
}

function polarPoint(cx, cy, radius, angle) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  }
}

function sectorPath(cx, cy, outerRadius, startAngle, endAngle, innerRadius = 0) {
  const startOuter = polarPoint(cx, cy, outerRadius, startAngle)
  const endOuter = polarPoint(cx, cy, outerRadius, endAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  if (innerRadius === 0) {
    return `M ${cx} ${cy} L ${startOuter.x} ${startOuter.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y} Z`
  }
  const endInner = polarPoint(cx, cy, innerRadius, endAngle)
  const startInner = polarPoint(cx, cy, innerRadius, startAngle)
  return `M ${startOuter.x} ${startOuter.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y} L ${endInner.x} ${endInner.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${startInner.x} ${startInner.y} Z`
}

function Legend({ labels }) {
  const entries = labels.slice(0, 6)
  const startX = Math.max(16, (WIDTH - entries.length * 78) / 2)
  return (
    <g fontSize="10" fill="#9ca3af">
      {entries.map((label, index) => {
        const x = startX + index * 78
        return (
          <g key={`${label}-${index}`} transform={`translate(${x} 265)`}>
            <circle cx="0" cy="-3" r="4" fill={PALETTE[index % PALETTE.length]} />
            <text x="8" y="0">{label.length > 9 ? `${label.slice(0, 8)}…` : label}</text>
          </g>
        )
      })}
    </g>
  )
}

function RadialChart({ type, labels, values }) {
  const safeValues = values.map(value => Math.max(0, value))
  const total = safeValues.reduce((sum, value) => sum + value, 0) || 1
  const cx = WIDTH / 2
  const cy = 126
  const maxRadius = 96
  let angle = -Math.PI / 2
  const sectors = safeValues.map((value, index) => {
    const sweep = (value / total) * Math.PI * 2
    const start = angle
    angle += sweep
    const radius = type === 'polarArea'
      ? 34 + (value / (Math.max(...safeValues, 1))) * 58
      : maxRadius
    return (
      <path
        key={`${labels[index] ?? 'segment'}-${index}`}
        d={sectorPath(cx, cy, radius, start, start + sweep, type === 'doughnut' ? 48 : 0)}
        fill={type === 'polarArea' ? TRANSPARENT_PALETTE[index % TRANSPARENT_PALETTE.length] : PALETTE[index % PALETTE.length]}
        stroke="#0a0a0a"
        strokeWidth="2"
      />
    )
  })

  return (
    <g>
      {type === 'radar' ? <RadarChart labels={labels} values={values} /> : sectors}
      <Legend labels={labels} />
    </g>
  )
}

function RadarChart({ labels, values }) {
  const cx = WIDTH / 2
  const cy = 122
  const radius = 92
  const count = Math.max(labels.length, values.length, 3)
  const maxValue = Math.max(...values.map(value => Math.max(0, value)), 1)
  const pointAt = (index, scale = 1) => polarPoint(cx, cy, radius * scale, -Math.PI / 2 + (Math.PI * 2 * index) / count)
  const polygon = values.map((value, index) => {
    const point = pointAt(index, Math.max(0, value) / maxValue)
    return `${point.x},${point.y}`
  }).join(' ')

  return (
    <g>
      {[0.25, 0.5, 0.75, 1].map(scale => (
        <polygon key={scale} points={Array.from({ length: count }, (_, index) => {
          const point = pointAt(index, scale)
          return `${point.x},${point.y}`
        }).join(' ')} fill="none" stroke="#374151" strokeWidth="1" />
      ))}
      {Array.from({ length: count }, (_, index) => {
        const point = pointAt(index)
        return <line key={index} x1={cx} y1={cy} x2={point.x} y2={point.y} stroke="#374151" />
      })}
      <polygon points={polygon} fill="#34d39933" stroke="#34d399" strokeWidth="2" />
      {values.map((value, index) => {
        const point = pointAt(index, Math.max(0, value) / maxValue)
        return <circle key={index} cx={point.x} cy={point.y} r="3" fill="#34d399" />
      })}
    </g>
  )
}

function CartesianChart({ type, labels, values, points, unit }) {
  const left = 42
  const right = 508
  const top = 22
  const bottom = 230
  const plotWidth = right - left
  const plotHeight = bottom - top
  const chartPoints = points ?? values.map((value, index) => ({ x: index, y: value }))
  if (chartPoints.length === 0) {
    return <text x={WIDTH / 2} y={HEIGHT / 2} fill="#9ca3af" textAnchor="middle">No chart data</text>
  }
  const xMax = Math.max(1, ...chartPoints.map(point => point.x))
  const yMax = Math.max(1, ...chartPoints.map(point => point.y))
  const yMin = Math.min(0, ...chartPoints.map(point => point.y))
  const yRange = yMax - yMin || 1
  const pointX = (point, index) => points ? left + (point.x / xMax) * plotWidth : left + (index / Math.max(chartPoints.length - 1, 1)) * plotWidth
  const pointY = point => bottom - ((point.y - yMin) / yRange) * plotHeight
  const lineD = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(point, index)} ${pointY(point)}`).join(' ')

  return (
    <g fontSize="10" fill="#6b7280">
      {[0, 1, 2, 3, 4].map(index => {
        const y = top + (plotHeight * index) / 4
        const tick = yMax - ((yMax - yMin) * index) / 4
        return <g key={index}><line x1={left} y1={y} x2={right} y2={y} stroke="#374151" /><text x={left - 7} y={y + 3} textAnchor="end">{Math.round(tick)}</text></g>
      })}
      {type === 'bar' ? chartPoints.map((point, index) => {
        const barWidth = Math.max(4, (plotWidth / Math.max(chartPoints.length, 1)) * 0.62)
        const x = points ? pointX(point, index) - barWidth / 2 : left + index * (plotWidth / chartPoints.length) + (plotWidth / chartPoints.length - barWidth) / 2
        const y = pointY(point)
        return <rect key={index} x={x} y={y} width={barWidth} height={Math.max(0, bottom - y)} rx="2" fill={PALETTE[index % PALETTE.length]} />
      }) : type === 'scatter' || type === 'bubble' ? chartPoints.map((point, index) => (
        <circle key={index} cx={pointX(point, index)} cy={pointY(point)} r={type === 'bubble' ? Math.max(3, Math.min(17, point.r)) : 4} fill={TRANSPARENT_PALETTE[index % TRANSPARENT_PALETTE.length]} stroke={PALETTE[index % PALETTE.length]} strokeWidth="1.5" />
      )) : (
        <>
          <path d={`${lineD} L ${pointX(chartPoints.at(-1) ?? { x: 0, y: 0 }, chartPoints.length - 1)} ${bottom} L ${left} ${bottom} Z`} fill="#34d3992e" />
          <path d={lineD} fill="none" stroke={PALETTE[0]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {chartPoints.length < 28 && chartPoints.map((point, index) => <circle key={index} cx={pointX(point, index)} cy={pointY(point)} r="2.5" fill={PALETTE[0]} />)}
        </>
      )}
      {labels.filter((_, index) => index % Math.max(1, Math.ceil(labels.length / 7)) === 0).map((label, index) => {
        const originalIndex = index * Math.max(1, Math.ceil(labels.length / 7))
        const x = left + (originalIndex / Math.max(labels.length - 1, 1)) * plotWidth
        return <text key={`${label}-${index}`} x={x} y={bottom + 18} textAnchor="middle">{label.slice(0, 8)}</text>
      })}
      {unit ? <text x={right} y={top - 8} textAnchor="end">{unit}</text> : null}
    </g>
  )
}

export default function ChartSet({ type = 'line', data, unit, height = 256 }) {
  const normalized = readData(data)
  const chartType = ['line', 'bar', 'pie', 'doughnut', 'radar', 'polarArea', 'scatter', 'bubble'].includes(type)
    ? type
    : 'line'
  const radial = ['pie', 'doughnut', 'radar', 'polarArea'].includes(chartType)

  return (
    <div style={{ height, width: '100%' }}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" role="img" aria-label={`${chartType} chart`}>
        {radial
          ? <RadialChart type={chartType} labels={normalized.labels ?? []} values={normalized.values ?? []} />
          : <CartesianChart type={chartType} labels={normalized.labels ?? []} values={normalized.values ?? []} points={normalized.points} unit={unit} />}
      </svg>
    </div>
  )
}
