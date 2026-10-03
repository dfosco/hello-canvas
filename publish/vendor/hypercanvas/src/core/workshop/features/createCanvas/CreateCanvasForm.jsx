import { useState, useMemo, useEffect } from 'react'
import { Button } from '../../../lib/components/ui/button/index.js'
import { Input } from '../../../lib/components/ui/input/index.js'
import { Label } from '../../../lib/components/ui/label/index.js'
import { Checkbox } from '../../../lib/components/ui/checkbox/index.js'
import * as Panel from '../../../lib/components/ui/panel/index.js'
import * as Alert from '../../../lib/components/ui/alert/index.js'

const CANVAS_SUCCESS_KEY = 'sb-canvas-created'

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function getApiUrl() {
  const basePath = window.__STORYBOARD_BASE_PATH__ || '/'
  return basePath.replace(/\/$/, '') + '/_storyboard/canvas'
}

export default function CreateCanvasForm({ onClose }) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [folder, setFolder] = useState('')
  // Special folder select value indicating the user wants to create a new
  // folder rather than pick an existing one. Triggers the new-folder input.
  const NEW_FOLDER_VALUE = '__new__'
  const [folderSelectValue, setFolderSelectValue] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderKind, setNewFolderKind] = useState('workspace')
  const [grid, setGrid] = useState(true)
  // folderEntries: [{ name, kind: 'workspace' | 'pages' }, ...]
  const [folderEntries, setFolderEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [createdRoute, setCreatedRoute] = useState(null)

  const kebabName = useMemo(
    () =>
      name
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    [name],
  )

  const autoTitle = useMemo(
    () =>
      kebabName
        ? kebabName
            .split('-')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ')
        : '',
    [kebabName],
  )

  const displayTitle = useMemo(
    () => (titleTouched ? title : autoTitle),
    [titleTouched, title, autoTitle],
  )

  const routePreview = useMemo(
    () => {
      if (!kebabName) return ''
      // Both `.folder/` and plain dir produce the same URL — `.folder` is
      // stripped by the data plugin's route resolver.
      return folder ? `/canvas/${folder}/${kebabName}` : `/canvas/${kebabName}`
    },
    [kebabName, folder],
  )

  const nameError = useMemo(() => {
    if (name.trim() && !kebabName)
      return 'Name must contain at least one alphanumeric character'
    if (name.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kebabName))
      return 'Name must be kebab-case'
    return null
  }, [name, kebabName])

  const canSubmit = useMemo(() => {
    if (!kebabName || nameError || submitting) return false
    // When the user picked "+ Create new folder" they must also provide a
    // valid (kebab-case) folder name. Other selections (existing folder or
    // "No folder") always have a usable `folder` value already.
    if (folderSelectValue === NEW_FOLDER_VALUE && !folder) return false
    return true
  }, [kebabName, nameError, submitting, folderSelectValue, folder])

  useEffect(() => {
    // Restore success state after Vite's full-reload on file creation
    try {
      const saved = sessionStorage.getItem(CANVAS_SUCCESS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        setSuccess(parsed.success)
        setCreatedRoute(parsed.route)
        sessionStorage.removeItem(CANVAS_SUCCESS_KEY)
      }
    } catch { /* empty */ }

    async function fetchFolders() {
      try {
        const res = await fetch(getApiUrl() + '/folders')
        if (res.ok) {
          const data = await res.json()
          // Prefer the new tagged `entries` shape; fall back to legacy
          // `folders` string array (treat as 'pages' for back-compat).
          if (Array.isArray(data.entries)) {
            setFolderEntries(data.entries.filter((e) => e && e.name))
          } else if (Array.isArray(data.folders)) {
            setFolderEntries(data.folders.map((name) => ({ name, kind: 'pages' })))
          }
        }
      } catch { /* empty */ } finally {
        setLoading(false)
      }
    }
    fetchFolders()
  }, [])

  function handleFolderSelectChange(value) {
    setFolderSelectValue(value)
    if (value === NEW_FOLDER_VALUE) {
      // Defer folder commit until the user types a name.
      setFolder('')
    } else {
      setFolder(value)
      setNewFolderName('')
    }
  }

  // Whenever the user types into the new-folder input, mirror it into `folder`
  // so the submit handler picks it up. Kebab-case to match canvas folder
  // naming conventions (data plugin / route resolution assumes lowercase).
  const kebabNewFolder = useMemo(
    () =>
      newFolderName
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    [newFolderName],
  )

  useEffect(() => {
    if (folderSelectValue === NEW_FOLDER_VALUE) {
      setFolder(kebabNewFolder)
    }
  }, [folderSelectValue, kebabNewFolder])

  function handleTitleInput(e) {
    setTitle(e.target.value)
    setTitleTouched(true)
  }

  function handleTitleBlur() {
    if (!title.trim()) setTitleTouched(false)
  }

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    setCreatedRoute(null)
    try {
      const res = await fetch(getApiUrl() + '/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: kebabName,
          title: displayTitle,
          description: description || undefined,
          folder: folder || undefined,
          // Only meaningful when the folder doesn't exist yet — the server
          // resolves existing folders by inspecting the filesystem and
          // ignores `folderKind` in that case.
          folderKind: folder && folderSelectValue === NEW_FOLDER_VALUE ? newFolderKind : undefined,
          grid,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create canvas')
        return
      }
      const msg = `Created ${data.path}`
      setSuccess(msg)
      setCreatedRoute(data.route)
      try {
        sessionStorage.setItem(
          CANVAS_SUCCESS_KEY,
          JSON.stringify({ success: msg, route: data.route }),
        )
      } catch { /* empty */ }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && canSubmit) submit()
  }

  return (
    <>
      <Panel.Header>
        <Panel.Title>Create canvas</Panel.Title>
        <Panel.Close />
      </Panel.Header>

      <div className="p-4 pt-2 space-y-3" onKeyDown={handleKeydown}>
        <div className="space-y-1">
          <Label htmlFor="canvas-name">Name</Label>
          <Input
            id="canvas-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-canvas"
            autoComplete="off"
            spellCheck={false}
          />
          {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          {routePreview && (
            <p className="text-xs text-muted-foreground">
              Route:{' '}
              <code className="px-1 py-0.5 bg-muted rounded font-mono text-foreground text-xs">
                {routePreview}
              </code>
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="canvas-title">Title</Label>
          <Input
            id="canvas-title"
            value={displayTitle}
            onChange={handleTitleInput}
            onBlur={handleTitleBlur}
            placeholder={autoTitle || 'Auto-derived from name'}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="canvas-description">Description</Label>
          <Input
            id="canvas-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="canvas-folder">Folder</Label>
          <select
            id="canvas-folder"
            className={selectClass}
            value={folderSelectValue}
            onChange={(e) => handleFolderSelectChange(e.target.value)}
            disabled={loading}
          >
            <option value="">No folder</option>
            {folderEntries.map((f) => (
              <option key={`${f.kind}:${f.name}`} value={f.name}>
                {f.name} {f.kind === 'workspace' ? '— workspace folder' : '— canvas pages'}
              </option>
            ))}
            <option value={NEW_FOLDER_VALUE}>+ Create new folder…</option>
          </select>
        </div>

        {folderSelectValue === NEW_FOLDER_VALUE && (
          <div className="space-y-2 pl-4 border-l-2 border-muted">
            <div className="space-y-1">
              <Label htmlFor="canvas-new-folder-name">New folder name</Label>
              <Input
                id="canvas-new-folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="kebab-case-folder"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="canvas-new-folder-kind">Folder type</Label>
              <select
                id="canvas-new-folder-kind"
                className={selectClass}
                value={newFolderKind}
                onChange={(e) => setNewFolderKind(e.target.value)}
              >
                <option value="workspace">
                  Workspace folder — sibling canvases grouped in the workspace
                </option>
                <option value="pages">
                  Canvas pages — multi-page canvas, canvases become pages
                </option>
              </select>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="canvas-grid"
            checked={grid}
            onCheckedChange={setGrid}
          />
          <Label htmlFor="canvas-grid" className="text-sm font-normal cursor-pointer">
            Show grid
          </Label>
        </div>

        {error && (
          <Alert.Root variant="destructive">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        )}

        {success && (
          <Alert.Root>
            <Alert.Description className="text-success">
              {success}
              {createdRoute && (
                <>
                  {' — '}
                  <a href={createdRoute} className="underline">Open canvas</a>
                </>
              )}
            </Alert.Description>
          </Alert.Root>
        )}
      </div>

      <Panel.Footer>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Creating\u2026' : 'Create'}
        </Button>
      </Panel.Footer>
    </>
  )
}
