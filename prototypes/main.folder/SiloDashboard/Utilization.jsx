import {
  GraphIcon,
  SyncIcon,
  CalendarIcon,
  InfoIcon,
} from '@primer/octicons-react'
import { useFlowData, useObject } from '@dfosco/hypercanvas'
import SiloChart from '../../../components/SiloChart/SiloChart.jsx'

function SummaryCard({ data }) {
  if (!data) return null
  const { label, percent, provisioned, quota, unit } = data
  const provPct = quota ? Math.min(100, (provisioned / quota) * 100) : 0
  const quotaPct = Math.max(0, 100 - provPct)
  const pctNum = Number(percent ?? 0)
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm uppercase tracking-wider text-neutral-600 dark:text-neutral-400">{label}</div>
        <div className="text-right text-3xl font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
          {pctNum.toFixed(2)}
          <span className="ml-1 text-base text-neutral-800 dark:text-neutral-400">%</span>
        </div>
      </div>
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full bg-amber-500" style={{ width: `${provPct}%` }} />
        <div className="h-full bg-gray-600" style={{ width: `${quotaPct}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          Provisioned <span className="text-neutral-900 dark:text-neutral-200 tabular-nums">{provisioned}</span> {unit}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-gray-600" />
          Quota <span className="text-neutral-900 dark:text-neutral-200 tabular-nums">{quota}</span> {unit}
        </span>
      </div>
    </div>
  )
}

function ChartPanel({ title, data, unit }) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-neutral-300 dark:text-neutral-400 dark:text-neutral-300">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">{title}</span>
          <InfoIcon size={12} className="text-neutral-900 dark:text-neutral-400" />
        </div>
        <div className="text-xs text-neutral-800 dark:text-neutral-400">{unit}</div>
      </div>
      <SiloChart data={data} unit={unit} />
    </div>
  )
}

function Select({ children }) {
  return (
    <button className="inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-300 dark:text-neutral-400 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-700">
      {children}
      <span className="text-neutral-900 dark:text-neutral-400">▾</span>
    </button>
  )
}

export default function Utilization() {
  const summary = useFlowData('summary') ?? {}
  const timeRange = useFlowData('timeRange') ?? {}

  const cpuSeries = useObject('metrics', 'cpu') ?? []
  const memSeries = useObject('metrics', 'memory') ?? []
  const storageSeries = useObject('metrics', 'storage') ?? []

  return (
    <div className="flex flex-col gap-5 px-8 py-6">
      {/* Title */}
      <div className="flex items-center gap-2.5">
        <GraphIcon size={20} className="text-amber-500" />
        <h1 className="m-0 text-2xl font-semibold leading-none text-neutral-900 dark:text-neutral-100">
          Utilization
        </h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard data={summary?.cpu} />
        <SummaryCard data={summary?.memory} />
        <SummaryCard data={summary?.storage} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="grid h-8 w-8 place-items-center rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100">
            <SyncIcon size={14} />
          </button>
          <Select>All projects</Select>
        </div>
        <div className="flex items-center gap-2">
          <Select>
            <CalendarIcon size={12} />
            {timeRange?.label ?? 'Last hour'}
          </Select>
          <span className="text-xs text-neutral-800 dark:text-neutral-400 tabular-nums">
            {timeRange?.from ?? ''} <span className="text-neutral-300 dark:text-neutral-400">→</span>{' '}
            {timeRange?.to ?? ''}
          </span>
        </div>
      </div>

      {/* Charts */}
      <div className="flex flex-col gap-3">
        <ChartPanel title="CPU" data={cpuSeries} unit="Count" />
        <ChartPanel title="Memory" data={memSeries} unit="GiB" />
        <ChartPanel title="Storage" data={storageSeries} unit="TiB" />
      </div>
    </div>
  )
}
