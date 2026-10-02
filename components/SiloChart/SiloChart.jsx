export default function SiloChart({ data, unit }) {
  const points = Array.isArray(data)
    ? data.map(point => ({ label: String(point?.t ?? ''), value: Number(point?.v) || 0 }))
    : []

  if (points.length === 0) {
    return <div className="flex h-64 w-full items-center justify-center text-sm text-neutral-500">No utilization data</div>
  }

  const width = 520
  const height = 256
  const left = 42
  const right = 508
  const top = 18
  const bottom = 216
  const max = Math.max(1, ...points.map(point => point.value))
  const x = index => left + (index / Math.max(points.length - 1, 1)) * (right - left)
  const y = value => bottom - (Math.max(0, value) / max) * (bottom - top)
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`).join(' ')
  const area = `${line} L ${x(points.length - 1)} ${bottom} L ${left} ${bottom} Z`
  const labelStep = Math.max(1, Math.ceil(points.length / 7))

  return (
    <div className="h-64 w-full">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img" aria-label={`Utilization over time${unit ? ` in ${unit}` : ''}`}>
        {[0, 1, 2, 3, 4].map(index => {
          const gridY = top + ((bottom - top) * index) / 4
          const value = Math.round(max * (1 - index / 4))
          return (
            <g key={index} fontSize="10" fill="#80796b">
              <line x1={left} y1={gridY} x2={right} y2={gridY} stroke="#372f1f" />
              <text x={left - 7} y={gridY + 3} textAnchor="end">{value}</text>
            </g>
          )
        })}
        <path d={area} fill="rgba(211,161,52,0.18)" />
        <path d={line} fill="none" stroke="#d3a134" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={x(index)} cy={y(point.value)} r="2.5" fill="#d3a134">
              <title>{`${point.label}: ${point.value}${unit ? ` ${unit}` : ''}`}</title>
            </circle>
            {index % labelStep === 0 && <text x={x(index)} y={bottom + 18} textAnchor="middle" fontSize="10" fill="#80796b">{point.label.slice(0, 8)}</text>}
          </g>
        ))}
        {unit ? <text x={right} y={top - 4} textAnchor="end" fontSize="10" fill="#80796b">{unit}</text> : null}
      </svg>
    </div>
  )
}
