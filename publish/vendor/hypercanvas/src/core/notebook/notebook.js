/**
 * Content-only Notebook support.
 *
 * A Notebook is a user-owned folder containing portable canvas and prototype
 * content. Application code, dependencies, and runtime state stay outside it.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash, randomUUID } from 'node:crypto'
import { SITE_CONFIG_FILE, SiteStore } from '../site/site.js'
import {
  applyNavigationOperation,
  createDefaultNavigation,
  normalizeNavigation,
  NOTEBOOK_PAGE_TYPES,
} from './navigation.js'

export const NOTEBOOK_FORMAT_VERSION = 2
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
const PAGE_TYPES = new Set(NOTEBOOK_PAGE_TYPES)
const RECOVERABLE_PAGE_DIAGNOSTICS = new Set([
  'MISSING_PAGE_PAYLOAD',
  'MISSING_SITE_DESCRIPTOR',
  'UNSUPPORTED_CANVAS_LOCATION',
  'PAGE_ROUTE_CONFLICT',
  'PROTOTYPE_DATA_SCOPE_CONFLICT',
  'CUSTOM_DRAFT_EXCLUSION',
])

const DEFAULT_CANVAS_CONFIG = Object.freeze({
  version: 1,
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

function deterministicId(prefix, value) {
  const suffix = createHash('sha256').update(String(value)).digest('hex').slice(0, 20)
  return `${prefix}-${suffix}`
}

function pageRoute(page) {
  if (typeof page.route === 'string' && page.route.startsWith('/')) return page.route
  if (page.type === 'site') return `/sites/${encodeURIComponent(page.siteId || page.id)}`
  const locator = String(page.path || '').replaceAll('\\', '/')
  const segments = locator.split('/').filter(Boolean)
  if (page.type === 'canvas' && locator.startsWith(`${NOTEBOOK_DIRECTORIES.canvases}/`) && locator.endsWith('.canvas.jsonl')) {
    const routeSegments = segments.slice(1, -1).concat(segments.at(-1).replace(/\.canvas\.jsonl$/, ''))
      .filter(segment => segment !== 'drafts' && !segment.endsWith('.folder'))
    return `/canvas/${routeSegments.join('/')}`
  }
  if (page.type === 'prototype' && locator.startsWith(`${NOTEBOOK_DIRECTORIES.prototypes}/`)) {
    const routeSegments = segments.slice(1, -1)
      .filter(segment => segment !== 'drafts' && !segment.endsWith('.folder'))
      .concat(segments.at(-1) || [])
    return `/${routeSegments.join('/')}`
  }
  return null
}

function legacyGroupKey(page) {
  const segments = String(page.path || '').replaceAll('\\', '/').split('/').filter(Boolean)
  if (page.type === 'canvas' && segments[0] === NOTEBOOK_DIRECTORIES.canvases) {
    const groups = segments.slice(1, -1)
    return groups.length ? groups.join('/') : null
  }
  if (page.type === 'prototype' && segments[0] === NOTEBOOK_DIRECTORIES.prototypes) {
    const groups = segments.slice(1, -1).filter(segment => segment.endsWith('.folder')).map(segment => segment.slice(0, -7))
    return groups.length ? groups.join('/') : null
  }
  return null
}

function migrateManifestV1(root, legacy) {
  if (!legacy || legacy.formatVersion !== 1) return legacy
  const pages = (Array.isArray(legacy.pages) ? legacy.pages : []).map((page, index) => {
    if (!page || typeof page !== 'object' || Array.isArray(page)) return page
    const locator = safeRelativePath(page.path) || `invalid-${index + 1}`
    const type = PAGE_TYPES.has(page.type) ? page.type : 'page'
    const migrated = {
      ...page,
      id: typeof page.id === 'string' && page.id.trim() ? page.id : deterministicId(type, locator),
      title: typeof page.title === 'string' && page.title.trim() ? page.title : path.posix.basename(locator).replace(/\.canvas\.jsonl$/, ''),
    }
    migrated.route = pageRoute(migrated)
    return migrated
  })
  const siteStore = new SiteStore(root)
  const usedIds = new Set(pages.map(page => page?.id).filter(id => typeof id === 'string'))
  for (const site of siteStore.list()) {
    const id = deterministicId('site', site.id)
    if (usedIds.has(id)) continue
    usedIds.add(id)
    pages.push({ id, type: 'site', siteId: site.id, title: site.title, route: `/sites/${encodeURIComponent(site.id)}` })
  }

  const groupsByTitle = new Map()
  for (const page of pages) {
    const key = legacyGroupKey(page)
    if (!key) continue
    const title = key.split('/').join(' / ')
    if (!groupsByTitle.has(title)) groupsByTitle.set(title, [])
    groupsByTitle.get(title).push(page.id)
  }
  const legacyGroups = [...groupsByTitle].map(([title, pageIds]) => ({
    id: deterministicId('section', title.toLowerCase()),
    title,
    pageIds,
  }))
  return {
    ...legacy,
    formatVersion: 2,
    pages,
    navigation: createDefaultNavigation(pages, { legacyGroups }),
  }
}

function listFilesRecursively(directory, predicate, results = []) {
  if (!isDirectory(directory)) return results
  let entries = []
  try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return results }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !entry.name.endsWith('.folder')) continue
    if (entry.name.startsWith('_')) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) listFilesRecursively(absolute, predicate, results)
    else if (entry.isFile() && predicate(entry.name, absolute)) results.push(absolute)
  }
  return results
}

function readCanvasTitle(filePath, { fallbackName = true } = {}) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const event = JSON.parse(lines[index])
      if (typeof event?.title === 'string' && event.title.trim()) return event.title.trim()
    }
  } catch { /* damaged canvases stay discoverable under their file name */ }
  return fallbackName ? path.basename(filePath).replace(/\.canvas\.jsonl$/, '') : ''
}

function readPrototypeTitle(directory) {
  let entries = []
  try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return path.basename(directory) }
  const metadata = entries.find(entry => entry.isFile() && entry.name.endsWith('.prototype.json'))
  if (metadata) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, metadata.name), 'utf8'))
      if (typeof value?.meta?.title === 'string' && value.meta.title.trim()) return value.meta.title.trim()
    } catch { /* malformed metadata does not hide the prototype */ }
  }
  return path.basename(directory)
}

function prototypeDirectories(root) {
  const prototypesRoot = path.join(root, NOTEBOOK_DIRECTORIES.prototypes)
  const directories = []
  const walkLegacyGroups = (directory) => {
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.isSymbolicLink() || !entry.isDirectory()) continue
      const target = path.join(directory, entry.name)
      let children = []
      try { children = fs.readdirSync(target, { withFileTypes: true }) } catch { continue }
      if (children.some(child => child.isFile() && (child.name.endsWith('.prototype.json') || /^index\.(jsx|js|tsx|ts)$/.test(child.name)))) {
        directories.push(target)
      }
      if (entry.name.endsWith('.folder') || entry.name === 'drafts') walkLegacyGroups(target)
    }
  }
  walkLegacyGroups(prototypesRoot)
  return directories
}

function appendDiscoveredPages(navigation, pages, addedPages) {
  if (!addedPages.length) return navigation
  const current = normalizeNavigation(navigation, pages).navigation
  for (const page of addedPages) {
    current.type.order[page.type].push(page.id)
    current.files.flatOrder.push(page.id)
    current.files.entries.push({ type: 'page', pageId: page.id })
  }
  return current
}

/** Discover supported payloads without changing saved page identities or layout. */
function discoverNotebookPages(root, registeredPages) {
  const knownLocators = new Set(registeredPages.filter(page => typeof page?.path === 'string').map(page => page.path.replaceAll('\\', '/')))
  const knownSites = new Set(registeredPages.filter(page => page?.type === 'site').map(page => page.siteId))
  const knownIds = new Set(registeredPages.map(page => page?.id).filter(Boolean))
  const discovered = []
  const add = page => {
    const locator = typeof page.path === 'string' ? page.path.replaceAll('\\', '/') : null
    if (locator && knownLocators.has(locator)) return
    if (page.type === 'site' && knownSites.has(page.siteId)) return
    let id = page.id
    while (knownIds.has(id)) id = `${id}-next`
    page.id = id
    knownIds.add(id)
    if (locator) knownLocators.add(locator)
    if (page.type === 'site') knownSites.add(page.siteId)
    discovered.push(page)
  }

  const canvasRoot = path.join(root, NOTEBOOK_DIRECTORIES.canvases)
  for (const absolute of listFilesRecursively(canvasRoot, name => name.endsWith('.canvas.jsonl'))) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    const page = {
      id: deterministicId('canvas', relative),
      type: 'canvas',
      title: readCanvasTitle(absolute),
      path: relative,
    }
    page.route = pageRoute(page)
    add(page)
  }

  const prototypeRoot = path.join(root, NOTEBOOK_DIRECTORIES.prototypes)
  for (const absolute of prototypeDirectories(root)) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    const page = {
      id: deterministicId('prototype', relative),
      type: 'prototype',
      title: readPrototypeTitle(absolute),
      path: relative,
    }
    page.route = pageRoute(page)
    add(page)
  }

  for (const absolute of listFilesRecursively(prototypeRoot, name => name.endsWith('.canvas.jsonl'))) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    const page = {
      id: deterministicId('canvas', relative),
      type: 'canvas',
      title: readCanvasTitle(absolute),
      path: relative,
      route: null,
    }
    add(page)
  }

  for (const site of new SiteStore(root).list()) {
    add({
      id: deterministicId('site', site.id),
      type: 'site',
      siteId: site.id,
      title: site.title || site.id,
      route: `/sites/${encodeURIComponent(site.id)}`,
    })
  }

  return discovered
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
        pageDiagnostics.push(diagnostic('UNKNOWN_PAGE_TYPE', `Page type must be prototype, canvas, or site.`, `pages[${index}].type`))
      }
      if (typeof page.title !== 'string' || page.title.trim() === '') {
        pageDiagnostics.push(diagnostic('MISSING_PAGE_TITLE', `Page "${page.id || index + 1}" requires a title.`, `pages[${index}].title`))
      }
      if (page.type === 'site') {
        if (typeof page.siteId !== 'string' || !page.siteId.trim() || page.path !== undefined) {
          pageDiagnostics.push(diagnostic('INVALID_SITE_REFERENCE', `Site page "${page.id || index + 1}" requires a siteId and cannot have a payload path.`, `pages[${index}]`))
        }
      } else if (!relativePath || !pagePathIsValid(page.type, relativePath)) {
        const prototypeCanvas = page.type === 'canvas' && relativePath?.startsWith(`${NOTEBOOK_DIRECTORIES.prototypes}/`)
        pageDiagnostics.push(diagnostic(
          prototypeCanvas ? 'UNSUPPORTED_CANVAS_LOCATION' : 'INVALID_PAGE_PATH',
          prototypeCanvas
            ? 'Canvas pages cannot be registered inside a Prototype; the deprecated workspace can still read this legacy path.'
            : `Page path must stay under canvas/ or prototypes/ and match its page type.`,
          `pages[${index}].path`,
        ))
      }
    }

    const isSite = page?.type === 'site'
    const siteDescriptor = isSite && typeof page?.siteId === 'string' ? new SiteStore(root).get(page.siteId) : null
    if (isSite && !siteDescriptor) {
      pageDiagnostics.push(diagnostic('MISSING_SITE_DESCRIPTOR', `Site "${page.siteId}" is not registered in the local Site store.`, page.siteId))
    }
    const payload = relativePath && !isSite
      ? payloadState(root, relativePath, page?.type)
      : { available: false, unsafe: false }
    const payloadTitle = page?.type === 'canvas' && payload.available
      ? readCanvasTitle(path.join(root, relativePath), { fallbackName: false })
      : ''
    if (payload.unsafe) {
      pageDiagnostics.push(diagnostic('UNSAFE_PAGE_PATH', `Page payload resolves outside the Notebook: ${relativePath}.`, relativePath))
    }
    const available = isSite ? Boolean(siteDescriptor) : payload.available
    if (relativePath && !isSite && !available) {
      pageDiagnostics.push(diagnostic('MISSING_PAGE_PAYLOAD', `Page payload is missing: ${relativePath}.`, relativePath))
    }

    diagnostics.push(...pageDiagnostics)
    pages.push({
      ...(page && typeof page === 'object' ? page : {}),
      ...(payloadTitle ? { title: payloadTitle } : {}),
      index,
      path: relativePath || pagePath || null,
      route: pageRoute(page || {}),
      ...(siteDescriptor ? {
        title: typeof page?.title === 'string' && page.title.trim() ? page.title : siteDescriptor.title,
        productionUrl: siteDescriptor.deployments?.[siteDescriptor.defaultDeployment]?.baseUrl || null,
      } : {}),
      available: available && pageDiagnostics.length === 0,
      diagnostics: pageDiagnostics,
    })
  }

  const routes = new Map()
  for (const page of pages) {
    if (!page.route) continue
    if (!routes.has(page.route)) routes.set(page.route, [])
    routes.get(page.route).push(page)
  }
  for (const [route, matches] of routes) {
    if (matches.length < 2) continue
    for (const page of matches) {
      const item = diagnostic('PAGE_ROUTE_CONFLICT', `Page route "${route}" is shared by multiple registered pages; explicitly resolve the conflict.`, page.path || page.siteId)
      page.diagnostics.push(item)
      diagnostics.push(item)
      page.available = false
    }
  }

  return { pages, diagnostics }
}

function prototypeOwner(relativePath) {
  const segments = String(relativePath || '').replaceAll('\\', '/').split('/').filter(Boolean)
  if (segments[0] === NOTEBOOK_DIRECTORIES.prototypes) segments.shift()
  return segments.find(segment => segment !== 'drafts' && !segment.endsWith('.folder') && !segment.startsWith('_')) || null
}

function prototypeDataScopeConflicts(root, pages) {
  const prototypeRoot = path.join(root, NOTEBOOK_DIRECTORIES.prototypes)
  const files = listFilesRecursively(prototypeRoot, name => /\.(flow|scene|object|record)\.jsonc?$/.test(name))
  const declarations = new Map()
  for (const absolute of files) {
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    const match = path.basename(absolute).match(/^(.+)\.(flow|scene|object|record)\.jsonc?$/)
    const owner = prototypeOwner(relative)
    if (!match || !owner) continue
    const suffix = match[2] === 'scene' ? 'flow' : match[2]
    const key = `${owner}/${match[1]}.${suffix}`
    if (!declarations.has(key)) declarations.set(key, [])
    declarations.get(key).push(relative)
  }

  const diagnostics = []
  const affectedOwners = new Map()
  for (const [key, paths] of declarations) {
    if (paths.length < 2) continue
    const owner = key.slice(0, key.indexOf('/'))
    if (!affectedOwners.has(owner)) affectedOwners.set(owner, [])
    affectedOwners.get(owner).push({ key, paths })
  }

  for (const page of pages) {
    if (page.type !== 'prototype') continue
    const owner = prototypeOwner(page.path)
    const conflicts = affectedOwners.get(owner) || []
    for (const conflict of conflicts) {
      const item = diagnostic(
        'PROTOTYPE_DATA_SCOPE_CONFLICT',
        `Prototype data key "${conflict.key}" is declared in multiple payload files; resolve the conflict before using this Prototype.`,
        page.path,
      )
      page.diagnostics.push(item)
      page.available = false
      diagnostics.push(item)
    }
  }
  return diagnostics
}

function customDraftIgnoreDiagnostics(root) {
  const file = path.join(root, '.gitignore')
  if (!isFile(file)) return []
  const recognized = new Set([
    'assets/canvas/images/drafts/',
    'src/canvas/**/drafts/',
    'src/prototypes/**/drafts/',
  ])
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  return lines.flatMap((line, index) => {
    const rule = line.trim()
    if (!rule || rule.startsWith('#') || rule.startsWith('!') || !rule.includes('drafts')) return []
    if (recognized.has(rule)) return [diagnostic(
      'CUSTOM_DRAFT_EXCLUSION',
      `Recognized legacy rule "${rule}" excludes content under drafts/; the notebook scaffold will remove it.`,
      `.gitignore:${index + 1}`,
    )]
    return [diagnostic(
      'CUSTOM_DRAFT_EXCLUSION',
      `Custom .gitignore rule "${rule}" may exclude registered content under drafts/; remove or narrow the rule explicitly.`,
      `.gitignore:${index + 1}`,
    )]
  })
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
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }) } catch { /* atomic rename already succeeded */ }
  }
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
  return {
    formatVersion: NOTEBOOK_FORMAT_VERSION,
    id,
    title,
    pages,
    navigation: createDefaultNavigation(pages),
  }
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

  const { manifest: sourceManifest, diagnostics: manifestDiagnostics } = readManifest(paths.root)
  const needsMigration = sourceManifest?.formatVersion === 1
  const migratedManifest = migrateManifestV1(paths.root, sourceManifest)
  const registeredPages = Array.isArray(migratedManifest?.pages) ? migratedManifest.pages : []
  const discoveredPages = migratedManifest?.formatVersion === NOTEBOOK_FORMAT_VERSION
    ? discoverNotebookPages(paths.root, registeredPages)
    : []
  const needsPageRegistration = discoveredPages.length > 0
  const reconciledManifest = migratedManifest && migratedManifest.formatVersion === NOTEBOOK_FORMAT_VERSION
    ? {
        ...migratedManifest,
        pages: [...registeredPages, ...discoveredPages],
        navigation: appendDiscoveredPages(migratedManifest.navigation, registeredPages, discoveredPages),
      }
    : migratedManifest
  const shapeDiagnostics = validateManifestShape(reconciledManifest)
  const { pages, diagnostics: pageDiagnostics } = validatePages(paths.root, reconciledManifest)
  const normalizedNavigation = normalizeNavigation(reconciledManifest?.navigation, pages)
  const needsNavigationRepair = migratedManifest?.formatVersion === 2
    && (!migratedManifest.navigation || !normalizedNavigation.valid)
  const manifest = reconciledManifest && reconciledManifest.formatVersion === NOTEBOOK_FORMAT_VERSION
    ? { ...reconciledManifest, navigation: normalizedNavigation.navigation }
    : reconciledManifest
  const navigationDiagnostics = normalizedNavigation.diagnostic ? [normalizedNavigation.diagnostic] : []
  const sites = listSiteFiles(paths.root)
  const dataScopeDiagnostics = prototypeDataScopeConflicts(paths.root, pages)
  const gitignoreDiagnostics = customDraftIgnoreDiagnostics(paths.root)
  const diagnostics = [...manifestDiagnostics, ...shapeDiagnostics, ...pageDiagnostics, ...dataScopeDiagnostics, ...navigationDiagnostics, ...gitignoreDiagnostics]
  const hasMissingPayload = diagnostics.some(({ code }) => code === 'MISSING_PAGE_PAYLOAD' || code === 'MISSING_SITE_DESCRIPTOR')
  const hasStructuralError = diagnostics.some(({ code }) => !RECOVERABLE_PAGE_DIAGNOSTICS.has(code) && code !== 'INVALID_NAVIGATION')

  return {
    status: hasStructuralError ? 'invalid' : 'valid',
    root: paths.root,
    manifest,
    pages,
    sites,
    diagnostics,
    hasMissingPayload,
    needsMigration,
    needsPageRegistration,
    needsNavigationRepair,
  }
}

function backupAndWriteNormalizedManifest(paths, snapshot) {
  const backupDirectory = path.join(paths.runtime, 'migrations')
  fs.mkdirSync(backupDirectory, { recursive: true })
  const backupName = snapshot.needsMigration
    ? 'hypercanvas.notebook.v1.json'
    : 'hypercanvas.notebook.v2.before-reconciliation.json'
  const backupPath = path.join(backupDirectory, backupName)
  if (!isFile(backupPath)) fs.copyFileSync(paths.manifest, backupPath)
  writeJsonAtomic(paths.manifest, snapshot.manifest)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Persist the reconciled v2 registry and navigation for one Notebook. */
export function writeNotebookManifest(root, manifest) {
  const paths = notebookPaths(root)
  if (!isFile(paths.manifest) || manifest?.formatVersion !== NOTEBOOK_FORMAT_VERSION) {
    const error = new Error('A valid manifest-v2 Notebook is required for page mutations.')
    error.code = 'INVALID_NOTEBOOK'
    throw error
  }
  writeJsonAtomic(paths.manifest, manifest)
  return inspectNotebook(paths.root)
}

/** Register a created page and place it in the requested virtual section. */
export function registerNotebookPage(root, input, { sectionId = null, sectionTitle = null, insertAfterPageId = null } = {}) {
  const snapshot = inspectNotebook(root)
  if (snapshot.status !== 'valid' || !snapshot.manifest) return null
  const pathKey = typeof input?.path === 'string' ? input.path.replaceAll('\\', '/') : null
  const match = snapshot.manifest.pages.find(page => (pathKey && page.path === pathKey)
    || (input?.siteId && page.type === 'site' && page.siteId === input.siteId)
    || (input?.id && page.id === input.id))
  let page = match
  let manifest = snapshot.manifest

  if (!page) {
    const type = input?.type
    if (!NOTEBOOK_PAGE_TYPES.includes(type)) return null
    const idSource = pathKey || input.siteId || input.id || `${type}:${input.title || ''}`
    page = {
      ...input,
      id: input.id || deterministicId(type, idSource),
      ...(pathKey ? { path: pathKey } : {}),
    }
    const pages = [...manifest.pages, page]
    const navigation = appendDiscoveredPages(manifest.navigation, manifest.pages, [page])
    manifest = { ...manifest, pages, navigation }
  }

  if (input.title && page.title !== input.title) {
    const pages = manifest.pages.map(item => item.id === page.id ? { ...item, title: input.title } : item)
    page = pages.find(item => item.id === page.id)
    manifest = { ...manifest, pages }
  }

  if (sectionId || sectionTitle) {
    const currentPage = page
    let section = sectionId
      ? manifest.navigation.files.sections.find(item => item.id === sectionId)
      : manifest.navigation.files.sections.find(item => item.title.toLocaleLowerCase() === String(sectionTitle).trim().toLocaleLowerCase())
    if (!section && sectionTitle) {
      manifest = {
        ...manifest,
        navigation: applyNavigationOperation(manifest.navigation, manifest.pages, {
          type: 'createSection', title: String(sectionTitle).trim(), index: manifest.navigation.files.entries.length,
        }),
      }
      section = manifest.navigation.files.sections.at(-1)
    }
    if (section) {
      const pageIds = section.pageIds.filter(id => id !== currentPage.id)
      manifest = {
        ...manifest,
        navigation: applyNavigationOperation(manifest.navigation, manifest.pages, {
          type: 'movePage', layout: 'filesSections', pageId: currentPage.id, sectionId: section.id, index: pageIds.length,
        }),
      }
    }
  }

  if (!sectionId && !sectionTitle && insertAfterPageId && insertAfterPageId !== page.id) {
    const target = manifest.pages.find(item => item.id === insertAfterPageId)
    if (target && manifest.navigation.mode === 'type' && target.type === page.type) {
      const order = manifest.navigation.type.order[page.type]
      const index = order.indexOf(target.id)
      if (index >= 0) manifest = {
        ...manifest,
        navigation: applyNavigationOperation(manifest.navigation, manifest.pages, {
          type: 'movePage', layout: 'type', pageId: page.id, index: index + 1,
        }),
      }
    } else if (target && manifest.navigation.mode === 'files') {
      if (manifest.navigation.sectionsEnabled) {
        const targetSection = manifest.navigation.files.sections.find(section => section.pageIds.includes(target.id))
        const sectionIdToUse = targetSection?.id || null
        if (targetSection) {
          manifest = {
            ...manifest,
            navigation: applyNavigationOperation(manifest.navigation, manifest.pages, {
              type: 'movePage', layout: 'filesSections', pageId: page.id, sectionId: sectionIdToUse,
              index: targetSection.pageIds.indexOf(target.id) + 1,
            }),
          }
        } else {
          const rootEntries = manifest.navigation.files.entries.filter(entry => entry.type === 'page')
          const index = rootEntries.findIndex(entry => entry.pageId === target.id)
          if (index >= 0) manifest = {
            ...manifest,
            navigation: applyNavigationOperation(manifest.navigation, manifest.pages, {
              type: 'movePage', layout: 'filesSections', pageId: page.id, index: index + 1,
            }),
          }
        }
      } else {
        const index = manifest.navigation.files.flatOrder.indexOf(target.id)
        if (index >= 0) manifest = {
          ...manifest,
          navigation: applyNavigationOperation(manifest.navigation, manifest.pages, {
            type: 'movePage', layout: 'filesFlat', pageId: page.id, index: index + 1,
          }),
        }
      }
    }
  }

  if (!snapshot.needsPageRegistration && manifest === snapshot.manifest && !input.title) return page
  writeNotebookManifest(snapshot.root, manifest)
  return page
}

/** Remove a primary page and all of its references from every saved layout. */
export function unregisterNotebookPage(root, selector) {
  const snapshot = inspectNotebook(root)
  if (snapshot.status !== 'valid' || !snapshot.manifest) return false
  const page = snapshot.manifest.pages.find(item => (selector?.id && item.id === selector.id)
    || (selector?.path && item.path === String(selector.path).replaceAll('\\', '/'))
    || (selector?.siteId && item.type === 'site' && item.siteId === selector.siteId))
  if (!page) return false

  const pages = snapshot.manifest.pages.filter(item => item.id !== page.id)
  const navigation = clone(snapshot.manifest.navigation)
  navigation.type.order[page.type] = navigation.type.order[page.type].filter(id => id !== page.id)
  navigation.files.flatOrder = navigation.files.flatOrder.filter(id => id !== page.id)
  navigation.files.entries = navigation.files.entries.filter(entry => !(entry.type === 'page' && entry.pageId === page.id))
  for (const section of navigation.files.sections) section.pageIds = section.pageIds.filter(id => id !== page.id)
  writeNotebookManifest(snapshot.root, { ...snapshot.manifest, pages, navigation })
  return true
}

/** Update display metadata without changing stable identity or layout order. */
export function updateNotebookPage(root, selector, updates = {}) {
  const snapshot = inspectNotebook(root)
  if (snapshot.status !== 'valid' || !snapshot.manifest) return null
  const page = snapshot.manifest.pages.find(item => (selector?.id && item.id === selector.id)
    || (selector?.path && item.path === String(selector.path).replaceAll('\\', '/'))
    || (selector?.siteId && item.type === 'site' && item.siteId === selector.siteId))
  if (!page) return null
  const pages = snapshot.manifest.pages.map(item => item.id === page.id ? { ...item, ...updates, id: item.id, type: item.type } : item)
  writeNotebookManifest(snapshot.root, { ...snapshot.manifest, pages })
  return pages.find(item => item.id === page.id)
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
      if (current.needsMigration || current.needsPageRegistration || current.needsNavigationRepair) backupAndWriteNormalizedManifest(paths, current)
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
