import { useOverride, useRecords } from '@dfosco/hypercanvas'
import {
  FileDirectoryFillIcon,
  InfoIcon,
  PlusIcon,
  KebabHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from '@primer/octicons-react'

function formatCreated(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getUTCDate()
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const year = d.getUTCFullYear()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return (
    <>
      {day} {month} {year}{' '}
      <span className="text-neutral-900 dark:text-neutral-500">
        {hh}:{mm}
      </span>
    </>
  )
}

function parseJson(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export default function Projects() {
  const baseProjects = useRecords('projects') ?? []
  const [createdRaw, setCreated] = useOverride('projects.new')
  const [deletedRaw, setDeleted] = useOverride('projects.deleted')
  const [editedRaw] = useOverride('projects.edited')
  const [, setOpen] = useOverride('createProject.open')
  const [, setEditId] = useOverride('createProject.editId')
  const [, setName] = useOverride('createProject.name')
  const [, setDescription] = useOverride('createProject.description')
  const [menuOpenRaw, setMenuOpen, clearMenuOpen] = useOverride('projects.menuOpen')
  const parsedDeletedIds = parseJson(deletedRaw, [])
  const deletedIds = new Set(Array.isArray(parsedDeletedIds) ? parsedDeletedIds : [])

  const newProjects = (() => {
    const parsed = parseJson(createdRaw, [])
    return Array.isArray(parsed) ? parsed : []
  })()
  const edits = (() => {
    const parsed = parseJson(editedRaw, {})
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  })()

  const menuOpenId = menuOpenRaw ?? null
  const newIds = new Set(newProjects.map((p) => p?.id))

  // Merge new + seed records, drop deleted IDs, apply per-id edits.
  const projects = [...newProjects, ...baseProjects]
    .filter((p) => p?.id && !deletedIds.has(p.id))
    .map((p) => ({ ...p, ...(edits[p.id] ?? {}) }))

  const openCreate = () => {
    setEditId('')
    setName('')
    setDescription('')
    setOpen(true)
  }

  const openEdit = (project) => {
    clearMenuOpen()
    setEditId(project.id)
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setOpen(true)
  }

  const deleteProject = (project) => {
    clearMenuOpen()
    if (newIds.has(project.id)) {
      // Locally-created project — just shrink the projects.new array.
      const next = newProjects.filter((p) => p?.id !== project.id)
      setCreated(JSON.stringify(next))
    } else {
      // Seed record — keep deleted IDs in one shareable Notebook override.
      setDeleted(JSON.stringify([...new Set([...deletedIds, project.id])]))
    }
  }

  const toggleMenu = (id) => {
    if (menuOpenId === id) clearMenuOpen()
    else setMenuOpen(id)
  }

  return (
    <div className="flex flex-col gap-5 px-8 py-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FileDirectoryFillIcon size={20} className="text-amber-500" />
          <h1 className="m-0 text-2xl font-semibold leading-none text-neutral-900 dark:text-neutral-100">
            Projects
          </h1>
        </div>
        <button
          className="grid h-8 w-8 place-items-center rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          aria-label="More info"
        >
          <InfoIcon size={14} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-end">
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-amber-500 hover:border-amber-600 hover:bg-amber-900/40"
        >
          <PlusIcon size={12} />
          New project
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
              <th className="px-4 py-3 font-normal w-1/4">Name</th>
              <th className="px-4 py-3 font-normal">Description</th>
              <th className="px-4 py-3 font-normal w-56">Created</th>
              <th className="px-4 py-3 font-normal w-12"></th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-xs text-neutral-600 dark:text-neutral-500"
                >
                  No projects yet.
                </td>
              </tr>
            ) : (
              projects.map((project, i) => (
                <tr
                  key={project?.id ?? i}
                  className={
                    i < projects.length - 1
                      ? 'border-b border-neutral-200 dark:border-neutral-800'
                      : ''
                  }
                >
                  <td className="px-4 py-3">
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      className="text-neutral-900 dark:text-neutral-100 underline decoration-neutral-300 dark:decoration-neutral-700 underline-offset-4 hover:decoration-amber-500"
                    >
                      {project?.name ?? '—'}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                    {project?.description ?? ''}
                  </td>
                  <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300 tabular-nums">
                    {formatCreated(project?.created)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="relative inline-block">
                      <button
                        onClick={() => toggleMenu(project.id)}
                        aria-haspopup="menu"
                        aria-expanded={menuOpenId === project.id}
                        aria-label={`Actions for ${project?.name ?? 'project'}`}
                        className={`grid h-7 w-7 place-items-center rounded-md ${
                          menuOpenId === project.id
                            ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100'
                            : 'text-neutral-600 dark:text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100'
                        }`}
                      >
                        <KebabHorizontalIcon size={14} />
                      </button>
                      {menuOpenId === project.id ? (
                        <>
                          {/* Click-outside catcher */}
                          <div
                            onClick={clearMenuOpen}
                            className="fixed inset-0 z-30"
                            aria-hidden="true"
                          />
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-[100] mt-1 w-36 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-zinc-950 shadow-lg"
                          >
                            <button
                              role="menuitem"
                              onClick={() => openEdit(project)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-neutral-100"
                            >
                              <PencilIcon size={12} />
                              Edit
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => deleteProject(project)}
                              className="flex w-full items-center gap-2 border-t border-neutral-200 dark:border-neutral-800 px-3 py-2 text-left text-xs text-red-500 hover:bg-red-500/10 hover:text-red-400"
                            >
                              <TrashIcon size={12} />
                              Delete
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-neutral-600 dark:text-neutral-500">
        <span>
          Rows per page{' '}
          <span className="ml-1 inline-block rounded border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-800 dark:text-neutral-400">
            50
          </span>
        </span>
        <span className="flex items-center gap-4">
          <button className="hover:text-neutral-900 dark:hover:text-neutral-300">◂ Prev</button>
          <button className="hover:text-neutral-900 dark:hover:text-neutral-300">Next ▸</button>
        </span>
      </div>
    </div>
  )
}
