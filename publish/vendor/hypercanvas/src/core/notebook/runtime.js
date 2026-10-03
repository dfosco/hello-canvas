/** Runtime-owned adapter for one active, content-only Notebook. */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  initializeNotebook,
  inspectNotebook,
  notebookPaths,
  NOTEBOOK_CANVAS_CONFIG_FILE,
  NOTEBOOK_CONFIG_FILES,
  NOTEBOOK_DIRECTORIES,
  NOTEBOOK_MANIFEST_FILE,
  NOTEBOOK_PUBLISH_DIR,
  NOTEBOOK_RUNTIME_DIR,
} from './notebook.js'

const NOTEBOOK_ENTRIES = new Set([
  NOTEBOOK_MANIFEST_FILE,
  NOTEBOOK_CANVAS_CONFIG_FILE,
  NOTEBOOK_PUBLISH_DIR,
  ...NOTEBOOK_CONFIG_FILES,
  ...Object.values(NOTEBOOK_DIRECTORIES),
])
const APPLICATION_DEFAULT_ENTRIES = new Set([
  NOTEBOOK_CANVAS_CONFIG_FILE,
  ...NOTEBOOK_CONFIG_FILES,
])
const NOTEBOOK_RUNTIME_ENTRIES = new Set([NOTEBOOK_RUNTIME_DIR])

function devlog(message, details = {}) {
  console.debug('[devlog][notebook-runtime]', message, details)
}

function runtimeError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function nearestRealPath(candidate) {
  let current = candidate
  while (current !== path.dirname(current)) {
    try { return fs.realpathSync.native(current) } catch { current = path.dirname(current) }
  }
  return current
}

function canonicalRoot(root) {
  const absolute = path.resolve(String(root || '.'))
  return fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : absolute
}

function canonicalNotebookRoot(root) {
  const absolute = path.resolve(String(root || '.'))
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) {
      throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Notebook root changed or resolves through a symlink.')
    }
    const canonical = fs.realpathSync.native(absolute)
    if (!fs.statSync(canonical).isDirectory()) {
      throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Notebook root changed or resolves through a symlink.')
    }
    return canonical
  } catch (error) {
    if (error.code === 'UNSAFE_NOTEBOOK_PATH') throw error
    throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Notebook root is unavailable.')
  }
}

function safeRelativePath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.startsWith('/')
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Path must be a normalized Notebook content path.')
  }
  return normalized
}

function resolveContained(root, relativePath, { entries = null } = {}) {
  const normalized = safeRelativePath(relativePath)
  if (entries && !entries.has(normalized.split('/')[0])) {
    throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Path is not part of the active Notebook contract.')
  }
  const candidate = path.resolve(root, normalized)
  if (!isInside(root, candidate)) throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Path resolves outside its filesystem root.')
  const resolved = fs.existsSync(candidate)
    ? fs.realpathSync.native(candidate)
    : nearestRealPath(path.dirname(candidate))
  if (!isInside(root, resolved)) throw runtimeError('UNSAFE_NOTEBOOK_PATH', 'Path resolves outside its filesystem root.')
  return candidate
}

export function resolveNotebookPath(root, relativePath) {
  return resolveContained(canonicalNotebookRoot(root), relativePath, { entries: NOTEBOOK_ENTRIES })
}

export function resolveNotebookRuntimePath(root, relativePath = '') {
  const suffix = relativePath ? safeRelativePath(relativePath) : ''
  const runtimePath = suffix ? `${NOTEBOOK_RUNTIME_DIR}/${suffix}` : NOTEBOOK_RUNTIME_DIR
  return resolveContained(canonicalNotebookRoot(root), runtimePath, { entries: NOTEBOOK_RUNTIME_ENTRIES })
}

export function resolvePathWithinRoot(root, relativePath) {
  return resolveContained(canonicalNotebookRoot(root), relativePath)
}

/**
 * Keep the Vite project root stable while exposing only the selected
 * Notebook's manifest-owned content. The owner can swap roots atomically.
 */
export function createNotebookRuntime(options = {}) {
  const settings = typeof options === 'string' || options == null
    ? { initialRoot: options }
    : options
  const applicationRoot = canonicalRoot(settings.applicationRoot || process.cwd())
  const stateDirectory = settings.stateDirectory || process.env.HYPERCANVAS_APP_STATE_DIR || null
  const recentFile = stateDirectory ? path.join(path.resolve(stateDirectory), 'notebooks.json') : null
  const globalRoots = (settings.globalRoots || []).map(({ root, access = ['read'] }) => ({
    root: canonicalRoot(root),
    access: new Set(access),
  }))
  let active = null
  let generation = 0
  const listeners = new Set()

  function readRecent() {
    if (!recentFile) return []
    try {
      const entries = JSON.parse(fs.readFileSync(recentFile, 'utf8'))
      if (!Array.isArray(entries)) return []
      return entries.filter(entry => typeof entry?.root === 'string' && path.isAbsolute(entry.root))
    } catch { return [] }
  }

  function persistRecent(entries) {
    if (!recentFile) return
    const directory = path.dirname(recentFile)
    fs.mkdirSync(directory, { recursive: true })
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
    const temporary = `${recentFile}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(entries.slice(0, 20), null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, recentFile)
  }

  function remember(notebook) {
    if (!recentFile) return
    const root = notebook.root
    const entries = readRecent().filter(entry => entry.root !== root)
    entries.unshift({
      root,
      id: notebook.manifest?.id || null,
      title: notebook.manifest?.title || path.basename(root),
      lastOpened: new Date().toISOString(),
    })
    try { persistRecent(entries) } catch (error) { devlog('could not persist recent Notebook history', { message: error.message }) }
  }

  function close() {
    const previous = active
    if (!previous) return status()
    generation += 1
    active = null
    for (const listener of listeners) listener({ previous, current: null })
    return status()
  }

  function recent() {
    return readRecent().map(entry => {
      let available = false
      let title = entry.title || path.basename(entry.root)
      let id = entry.id || null
      try {
        const notebook = inspectNotebook(entry.root)
        available = notebook.status === 'valid'
        title = notebook.manifest?.title || title
        id = notebook.manifest?.id || id
      } catch { available = false }
      return { ...entry, title, id, available }
    })
  }

  function open(root) {
    devlog('open requested', { root })
    // Intake always repairs or creates the portable Notebook shell before it
    // becomes active. Existing folder content is preserved by the initializer.
    const notebook = fs.existsSync(root) && fs.statSync(root).isDirectory()
      ? initializeNotebook(root, { configRoot: applicationRoot })
      : inspectNotebook(root)
    if (notebook.status !== 'valid') {
      const detail = notebook.diagnostics?.find(d => d.message)?.message
        || 'Notebook must be valid before it can become active.'
      throw runtimeError('INVALID_NOTEBOOK', detail)
    }
    const previous = active
    generation += 1
    active = Object.freeze({ root: notebook.root, notebook, paths: notebookPaths(notebook.root), generation })
    remember(notebook)
    for (const listener of listeners) listener({ previous, current: active })
    devlog('open succeeded', { root: active.root, id: notebook.manifest?.id, title: notebook.manifest?.title })
    return status()
  }

  function create(root, { title = 'Notebook', id = undefined } = {}) {
    const requested = String(root || '').trim()
    const requestedRoot = path.resolve(requested)
    if (!requested || requestedRoot === path.parse(requestedRoot).root) {
      throw runtimeError('INVALID_NOTEBOOK_ROOT', 'Choose a non-root directory for the new Notebook.')
    }
    const existingManifest = path.join(requestedRoot, NOTEBOOK_MANIFEST_FILE)
    if (fs.existsSync(existingManifest)) {
      throw runtimeError('NOTEBOOK_ALREADY_EXISTS', 'This folder already contains a Notebook; open it instead of creating another one.')
    }
    initializeNotebook(requestedRoot, { title, id, configRoot: applicationRoot })
    return open(requestedRoot)
  }

  function status() {
    return active
      ? { active: true, root: active.root, notebook: active.notebook, generation: active.generation }
      : { active: false, root: null, notebook: null, generation }
  }

  function requireNotebookRoot() {
    if (!active) throw runtimeError('NO_ACTIVE_NOTEBOOK', 'No Notebook is active.')
    return active.root
  }

  function resolve(relativePath, { scope = 'notebook', access = 'read', globalRoot = null } = {}) {
    if (scope === 'notebook') {
      return resolveNotebookPath(requireNotebookRoot(), relativePath)
    }
    if (scope === 'application-default') {
      if (access !== 'read') throw runtimeError('IMMUTABLE_APPLICATION_SOURCE', 'Application source is read-only.')
      return resolveContained(applicationRoot, relativePath, { entries: APPLICATION_DEFAULT_ENTRIES })
    }
    if (scope === 'global') {
      const requestedRoot = canonicalRoot(globalRoot)
      const capability = globalRoots.find(item => item.root === requestedRoot && item.access.has(access))
      if (!capability) throw runtimeError('GLOBAL_PATH_NOT_ALLOWED', 'Global filesystem access is not allowlisted.')
      return resolveContained(capability.root, relativePath)
    }
    throw runtimeError('UNKNOWN_FILESYSTEM_SCOPE', `Unknown filesystem scope: ${scope}`)
  }

  function read(relativePath) {
    return fs.readFileSync(resolve(relativePath), 'utf8')
  }

  function write(relativePath, content) {
    const destination = resolve(relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, content, 'utf8')
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function viteAllowRoots() {
    return [applicationRoot, ...(active ? [active.root] : [])]
  }

  if (settings.initialRoot) open(settings.initialRoot)
  function watchPaths() {
    if (!active) return []
    return [
      active.paths.manifest,
      active.paths.canvasConfig,
      ...active.paths.configFiles,
      active.paths.canvases,
      active.paths.prototypes,
      active.paths.components,
      active.paths.data,
      active.paths.assets,
      active.paths.siteConfig,
    ]
  }

  return {
    applicationRoot,
    open,
    create,
    close,
    recent,
    status,
    requireNotebookRoot,
    resolve,
    read,
    write,
    subscribe,
    watchPaths,
    viteAllowRoots,
  }
}
