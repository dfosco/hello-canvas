import {
  FileIcon,
  ImageIcon,
  ZapIcon,
  KeyIcon,
  PersonIcon,
  PlusIcon,
} from '@primer/octicons-react'
import { useFlowData, useOverride } from '@dfosco/storyboard'
import Utilization from './Utilization.jsx'
import Projects from './Projects.jsx'
import CreateProjectDrawer from './CreateProjectDrawer.jsx'

const ICONS = {
  file: FileIcon,
  image: ImageIcon,
  zap: ZapIcon,
  key: KeyIcon,
}

const HEADER_LABELS = {
  utilization: 'Utilization Rates',
  projects: 'Projects',
}

function Pill({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 dark:text-neutral-400 dark:text-neutral-300 ${className}`}
    >
      {children}
    </span>
  )
}

export default function SiloDashboard() {
  const user = useFlowData('user') ?? {}
  const workspace = useFlowData('workspace') ?? {}
  const nav = useFlowData('nav') ?? { sections: [] }

  const [view, setView] = useOverride('view')
  const currentView = view ?? 'utilization'
  const [, setCreateProjectOpen] = useOverride('createProject.open')
  const [, , clearCreateProjectEditId] = useOverride('createProject.editId')
  const [, , clearCreateProjectName] = useOverride('createProject.name')
  const [, , clearCreateProjectDescription] = useOverride('createProject.description')

  const QUICK_CREATE = {
    project: () => {
      // Reset any stale form/edit state from a previous interaction.
      clearCreateProjectEditId()
      clearCreateProjectName()
      clearCreateProjectDescription()
      setView('projects')
      setCreateProjectOpen(true)
    },
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50 dark:bg-zinc-950 font-mono text-neutral-800 dark:text-neutral-200">
      {/* Sidebar */}
      <aside className="flex w-1/5 flex-col gap-4 border-r border-neutral-200 dark:border-neutral-800 p-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-sm bg-amber-500 text-neutral-50 dark:text-neutral-950">
            <ZapIcon size={14} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs uppercase tracking-widest text-neutral-800 dark:text-neutral-400">Silo</span>
            <span className="text-sm text-neutral-900 dark:text-neutral-100">{workspace?.name ?? '—'}</span>
          </div>
        </div>

        <button className="flex items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-700">
          <span>Jump to</span>
          <span className="rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-zinc-950 px-1.5 py-0.5 text-[10px] text-neutral-800 dark:text-neutral-400">
            ⌘K
          </span>
        </button>

        {(nav?.sections ?? []).map((section, si) => (
          <div key={si} className="flex flex-col gap-1">
            <div className="px-1 text-[10px] uppercase tracking-widest text-neutral-800 dark:text-neutral-400">
              {section?.title}
            </div>
            {(section?.items ?? []).map((item, ii) => {
              const Icon = ICONS[item?.icon] ?? FileIcon
              const itemView = item?.view ?? null
              const active = itemView ? itemView === currentView : !!item?.active
              const navigable = !!itemView
              const createAction = item?.create ? QUICK_CREATE[item.create] : null
              return (
                <div
                  key={ii}
                  className={`group flex items-center gap-1 rounded-md ${
                    active
                      ? 'bg-neutral-100 dark:bg-neutral-900 text-amber-500'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-800 dark:hover:text-neutral-200'
                  }`}
                >
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (navigable) setView(itemView)
                    }}
                    className="flex flex-1 items-center gap-2 px-2 py-1.5 text-sm"
                  >
                    <Icon size={14} />
                    <span>{item?.label}</span>
                  </a>
                  {createAction ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        createAction()
                      }}
                      aria-label={`New ${item.create}`}
                      title={`New ${item.create}`}
                      className="mr-1 grid h-6 w-6 place-items-center rounded text-neutral-600 dark:text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-amber-500"
                    >
                      <PlusIcon size={12} />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col w-4/5 overflow-y-auto">
        <header className="flex min-h-16 items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-5">
          <div className="flex items-center gap-3 text-sm text-neutral-300 dark:text-neutral-400 dark:text-neutral-300">
            <span className="text-neutral-900 dark:text-neutral-400">/</span>
            <span>{HEADER_LABELS[currentView] ?? 'Utilization Rates'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Pill>
              <span className="text-neutral-900 dark:text-neutral-400">Silo</span>
              <span className="text-neutral-600 dark:text-neutral-400">{workspace?.silo ?? '—'}</span>
            </Pill>
            <Pill>
              <PersonIcon className="text-neutral-600 dark:text-neutral-400" size={12} />
              <span className="text-neutral-600 dark:text-neutral-400">{user?.name ?? '—'}</span>
            </Pill>
          </div>
        </header>

        {currentView === 'projects' ? <Projects /> : <Utilization />}
      </main>

      <CreateProjectDrawer />
    </div>
  )
}
