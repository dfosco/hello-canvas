import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const AXIS_COLOR = '#a1a1aa'
const GRID_COLOR = '#3f3f46'

function formatValue(value, unit) {
  const formatted = Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })
  return unit ? `${formatted} ${unit}` : formatted
}

export default function SiloChart({ data, unit }) {
  const gradientId = `silo-chart-fill-${useId().replace(/:/g, '')}`
  const points = Array.isArray(data)
    ? data.map((point) => ({
        label: String(point?.t ?? ''),
        value: Number(point?.v) || 0,
      }))
    : []

  if (points.length === 0) {
    return (
      <div className="flex h-64 w-full items-center justify-center text-sm text-neutral-500">
        No utilization data
      </div>
    )
  }

  return (
    <div className="h-64 w-full" role="group" aria-label={`Utilization over time${unit ? ` in ${unit}` : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart accessibilityLayer data={points} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d3a134" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#d3a134" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            minTickGap={24}
            tick={{ fill: AXIS_COLOR, fontSize: 10 }}
          />
          <YAxis
            width={42}
            domain={['auto', 'auto']}
            axisLine={false}
            tickLine={false}
            tick={{ fill: AXIS_COLOR, fontSize: 10 }}
          />
          <Tooltip
            cursor={{ stroke: '#71717a', strokeDasharray: '3 3' }}
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 6,
              color: '#e4e4e7',
              fontSize: 12,
            }}
            labelStyle={{ color: '#a1a1aa', marginBottom: 4 }}
            formatter={(value) => [formatValue(value, unit), 'Utilization']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#d3a134"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
