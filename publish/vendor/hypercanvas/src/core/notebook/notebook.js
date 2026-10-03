/**
 * Content-only Notebook support.
 *
 * A Notebook is a user-owned folder containing portable canvas and prototype
 * content. Application code, dependencies, and runtime state stay outside it.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { SITE_CONFIG_FILE, SiteStore } from '../site/site.js'

export const NOTEBOOK_FORMAT_VERSION = 1
export const NOTEBOOK_MANIFEST_FILE = 'hypercanvas.notebook.json'
export const NOTEBOOK_CANVAS_CONFIG_FILE = 'storyboard.canvas.json'
export const NOTEBOOK_RUNTIME_DIR = '.storyboard'
export const NOTEBOOK_PUBLISH_DIR = 'publish'
export const NOTEBOOK_CONFIG_FILES = Object.freeze([
  'storyboard.config.json',
  'terminal.config.json',
  'toolbar.config.json',
  'commandpalette.config.json',
  'paste.config.json',
  'widgets.config.json',
  'mascot.config.json',
])

export const NOTEBOOK_DIRECTORIES = Object.freeze({
  canvases: 'canvas',
  prototypes: 'prototypes',
  components: 'components',
  data: 'data',
  assets: 'assets',
  publish: NOTEBOOK_PUBLISH_DIR,
})

// Read old Site descriptor locations for migration/diagnostics only. Site
// project directories are external and are never created in the Notebook.
const LEGACY_SITE_DIRECTORY = 'sites'
const PAGE_TYPES = new Set(['canvas', 'prototype'])

const DEFAULT_CANVAS_CONFIG = Object.freeze({
  version: NOTEBOOK_FORMAT_VERSION,
  canvasDirectory: NOTEBOOK_DIRECTORIES.canvases,
  prototypeDirectory: NOTEBOOK_DIRECTORIES.prototypes,
  assetsDirectory: NOTEBOOK_DIRECTORIES.assets,
})

function diagnostic(code, message, relativePath = null) {
  return { code, message, path: relativePath }
}

function runtimePathError() {
  const error = new Error('Notebook runtime directory resolves outside its filesystem root.')
  error.code = 'UNSAFE_NOTEBOOK_PATH'
  return error
}

function makeId() {
  return `nb_${randomUUID().replaceAll('-', '')}`
}

function canonicalRoot(root) {
  const resolved = path.resolve(String(root || '.'))
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

function isDirectory(filePath) {
  try { return fs.statSync(filePath).isDirectory() } catch { return false }
}

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function payloadState(root, relativePath, type) {
  const candidate = path.resolve(root, relativePath)
  if (!isInside(root, candidate)) return { available: false, unsafe: true }
  try {
    const resolved = fs.realpathSync.native(candidate)
    if (!isInside(root, resolved)) return { available: false, unsafe: true }
  } catch {
    return { available: false, unsafe: false }
  }
  return {
    available: type === 'canvas' ? isFile(candidate) : isDirectory(candidate),
    unsafe: false,
  }
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || path.posix.isAbsolute(normalized)) return null
  const segments = normalized.split('/')
  if (segments.includes('..') || segments.includes('')) return null
  const clean = path.posix.normalize(normalized)
  return clean === '.' || clean.startsWith('../') ? null : clean
}

function pagePathIsValid(type, relativePath) {
  if (type === 'canvas') {
    return relativePath.startsWith(`${NOTEBOOK_DIRECTORIES.canvases}/`) && relativePath.endsWith('.canvas.jsonl')
  }
  return type === 'prototype' && relativePath.startsWith(`${NOTEBOOK_DIRECTORIES.prototypes}/`)
}

function validateManifestShape(manifest) {
  const diagnostics = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [diagnostic('INVALID_MANIFEST', 'Notebook manifest must be a JSON object.', NOTEBOOK_MANIFEST_FILE)]
  }

  if (manifest.formatVersion !== NOTEBOOK_FORMAT_VERSION) {
    const code = Number(manifest.formatVersion) > NOTEBOOK_FORMAT_VERSION
      ? 'UNSUPPORTED_VERSION'
      : 'INVALID_VERSION'
    diagnostics.push(diagnostic(code, `Notebook formatVersion must be ${NOTEBOOK_FORMAT_VERSION}.`, NOTEBOOK_MANIFEST_FILE))
  }
  if (typeof manifest.id !== 'string' || manifest.id.trim() === '') {
    diagnostics.push(diagnostic('MISSING_NOTEBOOK_ID', 'Notebook manifest requires a stable id.', NOTEBOOK_MANIFEST_FILE))
  }
  if (typeof manifest.title !== 'string' || manifest.title.trim() === '') {
    diagnostics.push(diagnostic('MISSING_NOTEBOOK_TITLE', 'Notebook manifest requires a title.', NOTEBOOK_MANIFEST_FILE))
  }
  if (!Array.isArray(manifest.pages)) {
    diagnostics.push(diagnostic('INVALID_PAGES', 'Notebook manifest pages must be an array.', NOTEBOOK_MANIFEST_FILE))
  }
  return diagnostics
}

function validatePages(root, manifest) {
  const diagnostics = []
  const pages = []
  const ids = new Set()

  if (!Array.isArray(manifest?.pages)) return { pages, diagnostics }

  for (const [index, page] of manifest.pages.entries()) {
    const pagePath = page?.path
    const relativePath = safeRelativePath(pagePath)
    const pageDiagnostics = []

    if (!page || typeof page !== 'object' || Array.isArray(page)) {
      pageDiagnostics.push(diagnostic('INVALID_PAGE', `Page ${index + 1} must be an object.`, `pages[${index}]`))
    } else {
      if (typeof page.id !== 'string' || page.id.trim() === '') {
        pageDiagnostics.push(diagnostic('MISSING_PAGE_ID', `Page ${index + 1} requires a stable id.`, `pages[${index}].id`))
      } else if (ids.has(page.id)) {
        pageDiagnostics.push(diagnostic('DUPLICATE_PAGE_ID', `Page id "${page.id}" is used more than once.`, `pages[${index}].id`))
      } else {
        ids.add(page.id)
      }
      if (!PAGE_TYPES.has(page.type)) {
        pageDiagnostics.push(diagnostic('UNKNOWN_PAGE_TYPE', `Page type must be canvas or prototype.`, `pages[${index}].type`))
      }
      if (typeof page.title !== 'string' || page.title.trim() === '') {
        pageDiagnostics.push(diagnostic('MISSING_PAGE_TITLE', `Page "${page.id || index + 1}" requires a title.`, `pages[${index}].title`))
      }
      if (!relativePath || !pagePathIsValid(page.type, relativePath)) {
        pageDiagnostics.push(diagnostic(
          'INVALID_PAGE_PATH',
          `Page path must stay under canvas/ or prototypes/ and match its page type.`,
          `pages[${index}].path`,
        ))
      }
    }

    const payload = relativePath
      ? payloadState(root, relativePath, page?.type)
      : { available: false, unsafe: false }
    if (payload.unsafe) {
      pageDiagnostics.push(diagnostic('UNSAFE_PAGE_PATH', `Page payload resolves outside the Notebook: ${relativePath}.`, relativePath))
    }
    const available = payload.available
    if (relativePath && !available) {
      pageDiagnostics.push(diagnostic('MISSING_PAGE_PAYLOAD', `Page payload is missing: ${relativePath}.`, relativePath))
    }

    diagnostics.push(...pageDiagnostics)
    pages.push({
      ...(page && typeof page === 'object' ? page : {}),
      index,
      path: relativePath || pagePath || null,
      available: available && pageDiagnostics.length === 0,
      diagnostics: pageDiagnostics,
    })
  }

  return { pages, diagnostics }
}

function readManifest(root) {
  const manifestPath = path.join(root, NOTEBOOK_MANIFEST_FILE)
  if (!isFile(manifestPath)) {
    return { manifest: null, diagnostics: [diagnostic('MISSING_MANIFEST', `Missing ${NOTEBOOK_MANIFEST_FILE}.`, NOTEBOOK_MANIFEST_FILE)] }
  }
  try {
    return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), diagnostics: [] }
  } catch (error) {
    return {
      manifest: null,
      diagnostics: [diagnostic('MALFORMED_MANIFEST', `Could not parse ${NOTEBOOK_MANIFEST_FILE}: ${error.message}.`, NOTEBOOK_MANIFEST_FILE)],
    }
  }
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function resolveConfigSource(root, filename) {
  return [
    path.join(root, filename),
    path.join(root, 'packages', 'storyboard', filename),
    path.join(root, 'node_modules', '@dfosco', 'hypercanvas', filename),
  ].find(isFile) || null
}

function ensureNotebookLayout(paths, configRoot) {
  fs.mkdirSync(paths.canvases, { recursive: true })
  fs.mkdirSync(paths.prototypes, { recursive: true })
  fs.mkdirSync(paths.components, { recursive: true })
  fs.mkdirSync(paths.data, { recursive: true })
  fs.mkdirSync(paths.assets, { recursive: true })
  assertRuntimeDirectoryContained(paths)
  fs.mkdirSync(paths.runtime, { recursive: true })
  assertRuntimeDirectoryContained(paths)
  if (!isFile(paths.canvasConfig)) writeJsonAtomic(paths.canvasConfig, DEFAULT_CANVAS_CONFIG)
  for (const filename of NOTEBOOK_CONFIG_FILES) {
    const destination = path.join(paths.root, filename)
    const source = resolveConfigSource(configRoot, filename)
    if (!isFile(destination) && source) fs.copyFileSync(source, destination)
  }
}

function assertRuntimeDirectoryContained(paths) {
  try {
    const realPath = fs.realpathSync.native(paths.runtime)
    if (!isInside(paths.root, realPath) || !fs.statSync(realPath).isDirectory()) throw runtimePathError()
  } catch (error) {
    if (error.code === 'ENOENT') return
    if (error.code === 'UNSAFE_NOTEBOOK_PATH') throw error
    throw runtimePathError()
  }
}

export function notebookManifest({ id = makeId(), title = 'Notebook', pages = [] } = {}) {
  return { formatVersion: NOTEBOOK_FORMAT_VERSION, id, title, pages }
}

export function notebookPaths(root) {
  const notebookRoot = canonicalRoot(root)
  return {
    root: notebookRoot,
    manifest: path.join(notebookRoot, NOTEBOOK_MANIFEST_FILE),
    canvasConfig: path.join(notebookRoot, NOTEBOOK_CANVAS_CONFIG_FILE),
    configFiles: NOTEBOOK_CONFIG_FILES.map(filename => path.join(notebookRoot, filename)),
    runtime: path.join(notebookRoot, NOTEBOOK_RUNTIME_DIR),
    siteConfig: path.join(notebookRoot, SITE_CONFIG_FILE),
    canvases: path.join(notebookRoot, NOTEBOOK_DIRECTORIES.canvases),
    prototypes: path.join(notebookRoot, NOTEBOOK_DIRECTORIES.prototypes),
    components: path.join(notebookRoot, NOTEBOOK_DIRECTORIES.components),
    data: path.join(notebookRoot, NOTEBOOK_DIRECTORIES.data),
    assets: path.join(notebookRoot, NOTEBOOK_DIRECTORIES.assets),
    publish: path.join(notebookRoot, NOTEBOOK_DIRECTORIES.publish),
  }
}

/**
 * Inspect without modifying the selected folder.
 * Missing payloads keep the Notebook recognizable but mark individual pages
 * unavailable, allowing the rest of the Notebook to remain usable.
 */
export function inspectNotebook(root) {
  const paths = notebookPaths(root)
  if (!isDirectory(paths.root)) {
    return {
      status: 'unavailable',
      root: paths.root,
      manifest: null,
      pages: [],
      diagnostics: [diagnostic('ROOT_NOT_FOUND', `Notebook folder does not exist: ${paths.root}.`)],
    }
  }

  const { manifest, diagnostics: manifestDiagnostics } = readManifest(paths.root)
  const shapeDiagnostics = validateManifestShape(manifest)
  const { pages, diagnostics: pageDiagnostics } = validatePages(paths.root, manifest)
  const sites = listSiteFiles(paths.root)
  const diagnostics = [...manifestDiagnostics, ...shapeDiagnostics, ...pageDiagnostics]
  const hasMissingPayload = diagnostics.some(({ code }) => code === 'MISSING_PAGE_PAYLOAD')
  const hasStructuralError = diagnostics.some(({ code }) => code !== 'MISSING_PAGE_PAYLOAD')

  return {
    status: hasStructuralError ? 'invalid' : 'valid',
    root: paths.root,
    manifest,
    pages,
    sites,
    diagnostics,
    hasMissingPayload,
  }
}

/**
 * Create the portable Notebook skeleton and ignored runtime directory.
 * Existing valid Notebooks are returned unchanged. Any selected directory can
 * be adopted as a Notebook: initialization only adds missing manifest,
 * layout, and default config files, and never overwrites existing content.
 */
export function initializeNotebook(root, { id, title = 'Notebook', configRoot = process.cwd() } = {}) {
  const requestedRoot = path.resolve(String(root || '.'))
  fs.mkdirSync(requestedRoot, { recursive: true })
  const paths = notebookPaths(requestedRoot)

  if (isFile(paths.manifest)) {
    const current = inspectNotebook(paths.root)
    if (current.status === 'valid') {
      ensureNotebookLayout(paths, configRoot)
      return inspectNotebook(paths.root)
    }
    const error = new Error(`Cannot initialize invalid Notebook: ${current.diagnostics.map(d => d.message).join(' ')}`)
    error.code = 'INVALID_NOTEBOOK'
    throw error
  }
  ensureNotebookLayout(paths, configRoot)
  writeJsonAtomic(paths.manifest, notebookManifest({ id, title }))

  return inspectNotebook(paths.root)
}

/**
 * Open a Notebook session and optionally observe real filesystem changes.
 * Refresh is serialized by the event loop and never writes to the Notebook.
 */
export function openNotebook(root, { watch = false, onChange } = {}) {
  let snapshot = inspectNotebook(root)
  let closed = false
  let timer = null
  const listeners = new Set()
  if (typeof onChange === 'function') listeners.add(onChange)

  const refresh = () => {
    if (closed) return snapshot
    const next = inspectNotebook(root)
    // Keep the last usable page snapshot visible while an editor's atomic
    // save briefly leaves the manifest malformed. Diagnostics still expose
    // the invalid on-disk state and the next valid refresh replaces it.
    const visible = next.status === 'invalid' && snapshot.status === 'valid'
      ? { ...next, manifest: snapshot.manifest, pages: snapshot.pages }
      : next
    const changed = JSON.stringify(visible) !== JSON.stringify(snapshot)
    snapshot = visible
    if (changed) {
      for (const listener of listeners) listener(snapshot)
    }
    return snapshot
  }

  let watcher = null
  if (watch && isDirectory(snapshot.root)) {
    try {
      watcher = fs.watch(snapshot.root, { recursive: true }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; refresh() }, 25)
      })
      watcher.on('error', () => refresh())
    } catch {
      watcher = null
    }
  }

  return {
    get snapshot() { return snapshot },
    refresh,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      watcher?.close()
      listeners.clear()
    },
  }
}

export const __test = { safeRelativePath, validateManifestShape, validatePages, payloadState }

function listSiteFiles(root) {
  const sites = new SiteStore(root).list()
  const hasUnifiedConfig = isFile(path.join(root, SITE_CONFIG_FILE))
  return sites.map(site => ({
    id: site.id,
    path: hasUnifiedConfig || !isFile(path.join(root, LEGACY_SITE_DIRECTORY, `${site.id}.site.json`))
      ? SITE_CONFIG_FILE
      : `${LEGACY_SITE_DIRECTORY}/${site.id}.site.json`,
  }))
}
