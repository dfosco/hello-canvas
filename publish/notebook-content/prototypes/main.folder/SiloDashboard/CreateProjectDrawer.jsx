import { XIcon, FileIcon } from '@primer/octicons-react'
import { useOverride } from '@dfosco/hypercanvas'

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseObject(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function parseProjects(raw) {
  const parsed = parseObject(raw, [])
  return Array.isArray(parsed) ? parsed : []
}

export default function CreateProjectDrawer() {
  const [open, , clearOpen] = useOverride('createProject.open')
  const [name, setName, clearName] = useOverride('createProject.name')
  const [description, setDescription, clearDescription] = useOverride(
    'createProject.description',
  )
  const [editIdRaw, , clearEditId] = useOverride('createProject.editId')
  const [createdRaw, setCreated] = useOverride('projects.new')
  const [editedRaw, setEdited] = useOverride('projects.edited')

  // URL hash stores everything as strings; treat presence (any non-empty value
  // other than "false") as open, so clearOpen() correctly closes the drawer.
  const isOpen = open != null && open !== 'false' && open !== false
  const editId = editIdRaw && editIdRaw !== 'false' ? String(editIdRaw) : ''
  const isEdit = editId.length > 0
  const nameValue = name ?? ''
  const descriptionValue = description ?? ''
  const canSubmit = nameValue.trim().length > 0

  const title = isEdit ? 'Edit project' : 'Create project'
  const submitLabel = isEdit ? 'Save changes' : 'Create project'

  const close = () => {
    clearOpen()
    clearName()
    clearDescription()
    clearEditId()
  }

  const submit = () => {
    if (!canSubmit) return
    const trimmedName = nameValue.trim()
    const trimmedDescription = descriptionValue.trim()
    const existing = parseProjects(createdRaw)

    if (isEdit) {
      // If editing a hash-stored (new) project, update it in place.
      const newIndex = existing.findIndex((p) => p?.id === editId)
      if (newIndex >= 0) {
        const next = existing.slice()
        next[newIndex] = {
          ...next[newIndex],
          name: trimmedName,
          description: trimmedDescription,
        }
        setCreated(JSON.stringify(next))
      } else {
        // Editing a seed record — store the patch in projects.edited.
        const edits = parseObject(editedRaw, {})
        const editsObj =
          edits && typeof edits === 'object' && !Array.isArray(edits) ? edits : {}
        const nextEdits = {
          ...editsObj,
          [editId]: { name: trimmedName, description: trimmedDescription },
        }
        setEdited(JSON.stringify(nextEdits))
      }
      close()
      return
    }

    // Create flow — generate a unique slug-id across the new-projects array.
    const baseSlug = slugify(trimmedName) || 'project'
    const usedIds = new Set(existing.map((p) => p?.id))
    let id = baseSlug
    let n = 2
    while (usedIds.has(id)) {
      id = `${baseSlug}-${n++}`
    }
    const next = [
      {
        id,
        name: trimmedName,
        description: trimmedDescription,
        created: new Date().toISOString(),
      },
      ...existing,
    ]
    setCreated(JSON.stringify(next))
    close()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-labelledby="create-project-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-zinc-950 text-neutral-800 dark:text-neutral-200 font-mono shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-6 py-5">
          <h2
            id="create-project-title"
            className="m-0 text-xl font-semibold text-neutral-900 dark:text-neutral-100"
          >
            {title}
          </h2>
          <button
            onClick={close}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <XIcon size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="create-project-name"
              className="text-sm text-neutral-700 dark:text-neutral-300"
            >
              Name
            </label>
            <input
              id="create-project-name"
              type="text"
              value={nameValue}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-amber-500"
            />
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label
              htmlFor="create-project-description"
              className="text-sm text-neutral-700 dark:text-neutral-300"
            >
              Description{' '}
              <span className="text-neutral-500 dark:text-neutral-500">(Optional)</span>
            </label>
            <textarea
              id="create-project-description"
              rows={4}
              value={descriptionValue}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-amber-500"
            />
          </div>

          <div className="mt-10">
            <h3 className="m-0 mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Relevant docs
            </h3>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center gap-2 text-sm text-amber-500 hover:text-amber-300"
            >
              <FileIcon size={14} />
              Projects
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-neutral-200 dark:border-neutral-800 px-6 py-4">
          <button
            onClick={close}
            className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md border border-amber-500 bg-amber-500 px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </aside>
    </>
  )
}
