import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { globSync } from 'glob'
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser'
import { materializeFromText } from '../../core/canvas/materializer.js'
import { toCanvasId } from '../../core/canvas/identity.js'
import { isCanvasWriteInFlight } from '../../core/canvas/writeGuard.js'
import { getConfig } from '../../core/stores/configSchema.js'
import { renderInlineBootstrapScript } from '../../core/stores/themeBootstrap.js'
import { generateThemesCss, GENERATED_THEMES_CSS_FILENAME } from '../../core/styles/generateThemesCss.js'
import { list as listRunningServers } from '../../core/worktree/serverRegistry.js'
import { listWorktrees } from '../../core/worktree/port.js'
import { buildArtifactManifest, resolveManifestEnv } from '../../core/data/artifactManifest.js'
import { createIsolationMiddleware } from '../canvas/isolation/createIsolationMiddleware.js'
import { notebookPrototypeRouteSource } from '../../core/notebook/vite-routes-plugin.js'

const VIRTUAL_MODULE_ID = 'virtual:storyboard-data-index'
const RESOLVED_ID = '\0' + VIRTUAL_MODULE_ID
// Notebook prototype route map, served by this plugin (not the notebook-routes
// plugin) because the data plugin is part of every consumer's Vite config —
// the library's isolated `prototypes.html` entry can therefore import it in
// notebook runtimes and scaffold repos alike. Without it the iframe entry
// only sees application-root prototypes (`/src/prototypes/**`) and renders
// Notebook prototypes as a blank route.
const PROTOTYPE_ROUTES_VIRTUAL_ID = 'virtual:storyboard-notebook-prototype-routes'

let _onHotPoolConfigChange = null
export function setOnHotPoolConfigChange(fn) { _onHotPoolConfigChange = fn }

const GLOB_PATTERN = '**/*.{flow,scene,object,record,prototype,folder,component}.{json,jsonc}'
const CANVAS_GLOB_PATTERN = '**/*.canvas.jsonl'
const CANVAS_META_GLOB_PATTERN = '**/*.meta.json'
const STORY_GLOB_PATTERN = '**/*.story.{jsx,tsx}'

/**
 * Extract the data name and type suffix from a file path.
 * Flows, records, and objects inside src/prototypes/{Name}/ get prefixed with
 * the prototype name (e.g. "Dashboard/default", "Dashboard/helpers").
 * Directories ending in .folder/ are skipped when extracting prototype scope.
 *
 * e.g. "src/data/default.flow.json"                → { name: "default",           suffix: "flow" }
 *      "src/prototypes/Dashboard/default.flow.json" → { name: "Dashboard/default", suffix: "flow" }
 *      "src/prototypes/Dashboard/helpers.object.json"→ { name: "Dashboard/helpers", suffix: "object" }
 *      "src/prototypes/X.folder/Dashboard/default.flow.json" → { name: "Dashboard/default", suffix: "flow", folder: "X" }
 */
/**
 * Parse top-level named exports (Capitalized identifiers) from a story
 * source file. Mirrors the regex used by canvas/server.js:parseExportNames
 * so that downstream UI (CanvasCreateMenu, WidgetArtifactDialog) can decide
 * between rendering a single component vs a component-set without a runtime
 * import of the story module.
 */
function parseStoryExportNames(filePath) {
  try {
    const src = fs.readFileSync(filePath, 'utf-8')
    const names = []
    const re = /export\s+(?:function|const|class)\s+([A-Z]\w*)/g
    let m
    while ((m = re.exec(src)) !== null) names.push(m[1])
    return names
  } catch { return [] }
}

function parseDataFile(filePath) {
  const base = path.basename(filePath)

  // Handle .canvas.jsonl files
  const canvasJsonlMatch = base.match(/^(.+)\.canvas\.jsonl$/)
  if (canvasJsonlMatch) {
    if (canvasJsonlMatch[1].startsWith('_')) return null
    const normalized = filePath.replace(/\\/g, '/')
    if (normalized.split('/').some(seg => seg.startsWith('_'))) return null

    const baseName = canvasJsonlMatch[1]
    let name = baseName
    let inferredRoute = null
    const canvasFolderMatch = normalized.match(/(?:^|\/)src\/canvas\/([^/]+)\.folder\//)
    const canvasFolderName = canvasFolderMatch ? canvasFolderMatch[1] : null
    const folderDirMatch = normalized.match(/(?:^|\/)src\/prototypes\/([^/]+)\.folder\//)
    const folderName = folderDirMatch ? folderDirMatch[1] : null

    // Preserve legacy route aliases while retaining the source path in the
    // page identity. Route collisions are surfaced by the Notebook catalog.
    const stripDraft = (p) => p.split('/').filter(seg => seg !== 'drafts').join('/')
    const canvasCheck = normalized.match(/(?:^|\/)src\/canvas\//)
    if (canvasCheck) {
      const dirPath = normalized.substring(0, normalized.lastIndexOf('/'))
      // Path-based ID: include folder context for uniqueness.
      // .folder dirs contribute their name (sans .folder suffix) to the ID.
      const idBase = (dirPath + '/')
        .replace(/^.*?src\/canvas\//, '')
        .replace(/\.folder\/?/g, '/')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
      name = idBase ? `${idBase}/${baseName}` : baseName
      inferredRoute = '/canvas/' + stripDraft(name)
      inferredRoute = inferredRoute.replace(/\/+/g, '/').replace(/\/$/, '') || '/canvas'
    }
    const protoCheck = normalized.match(/(?:^|\/)src\/prototypes\//)
    if (!canvasCheck && protoCheck) {
      const dirPath = normalized.substring(0, normalized.lastIndexOf('/'))
      // For prototypes, .folder is purely organizational — strip entirely
      const idBase = (dirPath + '/')
        .replace(/^.*?src\/prototypes\//, '')
        .replace(/[^/]*\.folder\/?/g, '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '')
      name = idBase ? `${idBase}/${baseName}` : baseName
      inferredRoute = '/canvas/' + stripDraft(name)
      inferredRoute = inferredRoute.replace(/\/+/g, '/').replace(/\/$/, '') || '/canvas'
    }
    // Derive the legacy workspace group while preserving the old route alias.
    const groupBase = stripDraft(name)
    const groupSlashIdx = groupBase.lastIndexOf('/')
    const group = canvasFolderName || (groupSlashIdx > 0 ? groupBase.substring(0, groupSlashIdx) : null)
    // Extract a relative path for toCanvasId (it expects src/canvas/... or src/prototypes/...)
    const canvasIdInput = normalized.replace(/^.*?(src\/(?:canvas|prototypes)\/)/, '$1')
    const id = toCanvasId(canvasIdInput)
    return { name, suffix: 'canvas', ext: 'jsonl', folder: canvasFolderName || folderName, inferredRoute, id, group }
  }

  // Handle canvas .meta.json files
  const metaMatch = base.match(/^(.+)\.meta\.json$/)
  if (metaMatch) {
    const normalized = filePath.replace(/\\/g, '/')
    // Only handle meta files inside src/canvas/ directories
    const canvasCheck = normalized.match(/(?:^|\/)src\/canvas\//)
    if (!canvasCheck) return null
    // Skip _-prefixed
    if (metaMatch[1].startsWith('_')) return null
    if (normalized.split('/').some(seg => seg.startsWith('_'))) return null
    return { name: metaMatch[1], suffix: 'canvas-meta', ext: 'json', inferredRoute: null }
  }

  // Handle .story.jsx / .story.tsx files
  const storyMatch = base.match(/^(.+)\.story\.(jsx|tsx)$/)
  if (storyMatch) {
    if (storyMatch[1].startsWith('_')) return null
    const normalized = filePath.replace(/\\/g, '/')
    if (normalized.split('/').some(seg => seg.startsWith('_'))) return null
    const name = storyMatch[1]
    let inferredRoute = null

    // All stories route under /components/ regardless of directory location
    const canvasCheck = normalized.match(/(?:^|\/)src\/canvas\//)
    const componentsCheck = normalized.match(/(?:^|\/)src\/components\//)
    // Keep the preexisting route alias so collisions stay explicit.
    const stripDraft = (p) => p.split('/').filter(seg => seg !== 'drafts').join('/')
    if (canvasCheck) {
      const dirPath = normalized.substring(0, normalized.lastIndexOf('/'))
      const routeBase = (dirPath + '/')
        .replace(/^.*?src\/canvas\//, '')
        .replace(/[^/]*\.folder\/?/g, '')
        .replace(/\/$/, '')
      inferredRoute = '/components/' + (routeBase ? routeBase + '/' : '') + name
      inferredRoute = stripDraft(inferredRoute).replace(/\/+/g, '/').replace(/\/$/, '') || '/components'
    } else if (componentsCheck) {
      const dirPath = normalized.substring(0, normalized.lastIndexOf('/'))
      const routeBase = (dirPath + '/')
        .replace(/^.*?src\/components\//, '')
        .replace(/[^/]*\.folder\/?/g, '')
        .replace(/\/$/, '')
      inferredRoute = '/components/' + (routeBase ? routeBase + '/' : '') + name
      inferredRoute = stripDraft(inferredRoute).replace(/\/+/g, '/').replace(/\/$/, '') || '/components'
    }

    return { name, suffix: 'story', ext: storyMatch[2], inferredRoute }
  }

  const match = base.match(/^(.+)\.(flow|scene|object|record|prototype|folder|component)\.(jsonc?)$/)
  if (!match) return null

  // Skip _-prefixed internal files.
  if (match[1].startsWith('_')) return null

  // Skip files inside _-prefixed directories
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.split('/').some(seg => seg.startsWith('_'))) return null
  // Normalize .scene → .flow for backward compatibility
  const suffix = match[2] === 'scene' ? 'flow' : match[2]
  let name = match[1]

  // Detect if this file is inside a .folder/ directory
  const folderDirMatch = normalized.match(/(?:^|\/)src\/prototypes\/([^/]+)\.folder\//)
  const folderName = folderDirMatch ? folderDirMatch[1] : null

  // Folder metadata files are keyed by their folder directory name (sans .folder suffix)
  if (suffix === 'folder') {
    if (folderName) {
      name = folderName
    }
    return { name, suffix, ext: match[3] }
  }

  // Prototype metadata files are keyed by their prototype directory name
  // (skip .folder/ and `drafts/` segments when determining prototype name).
  if (suffix === 'prototype') {
    const protoMatch = normalized.match(/(?:^|\/)src\/prototypes\/(?:(?:[^/]+\.folder|drafts)\/)*([^/]+)\//)
    if (protoMatch) {
      name = protoMatch[1]
    }
    return { name, suffix, ext: match[3], folder: folderName }
  }

  // Component metadata files are keyed by their component config basename.
  if (suffix === 'component') {
    return { name, suffix, ext: match[3] }
  }

  // Scope flows, records, and objects inside src/prototypes/{Name}/ with a prefix
  // (skip .folder/ and `drafts/` segments when determining prototype name).
  const protoMatch = normalized.match(/(?:^|\/)src\/prototypes\/(?:(?:[^/]+\.folder|drafts)\/)*([^/]+)\//)
  if (protoMatch) {
    name = `${protoMatch[1]}/${name}`
  }

  // Infer route for prototype-scoped flows from their file path.
  // Mirrors the generouted route regex: strip src/prototypes/, *.folder/,
  // and `drafts/` segments.
  let inferredRoute = null
  if (suffix === 'flow') {
    const protoCheck = normalized.match(/(?:^|\/)src\/prototypes\//)
    if (protoCheck) {
      const dirPath = normalized.substring(0, normalized.lastIndexOf('/'))
      inferredRoute = '/' + dirPath
        .replace(/^.*?src\/prototypes\//, '')
        .replace(/[^/]*\.folder\//g, '')
        .split('/').filter(seg => seg !== 'drafts').join('/')
      // Normalize trailing slash and double slashes
      inferredRoute = inferredRoute.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    }
  }

  return { name, suffix, ext: match[3], inferredRoute }
}

/**
 * Batch-fetch git metadata (author + lastModified) for multiple files in a
 * single subprocess, avoiding per-file git overhead during startup.
 *
 * Returns a Map<absPath, { gitAuthor: string|null, lastModified: string|null }>
 */
function batchGitMetadata(root, filePaths) {
  const result = new Map()
  if (filePaths.length === 0) return result

  // Initialize all entries
  for (const fp of filePaths) {
    result.set(fp, { gitAuthor: null, lastModified: null })
  }

  try {
    // Batch lastModified: one git log call with all paths
    // git log -1 gives the most recent commit touching any of these paths,
    // but we need per-path data. Use --name-only to correlate.
    // For efficiency, use a single git log with --format and --name-only
    // that outputs one record per commit touching these files.
    const allDirs = [...new Set(filePaths.map(fp => path.dirname(fp)))]
    const dirsArg = allDirs.map(d => `"${d}"`).join(' ')

    // Get lastModified per directory in one call using git log --format
    // We output "MARKER<sep>dir<sep>date" per commit, then take the latest per dir.
    const logResult = execSync(
      `git log --format="%aI" --name-only -- ${dirsArg}`,
      { cwd: root, encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 },
    ).trim()

    if (logResult) {
      const dirDates = new Map() // dir → most recent date
      let currentDate = null
      for (const line of logResult.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
          currentDate = trimmed
          continue
        }
        if (!currentDate) continue
        const dir = path.dirname(path.resolve(root, trimmed))
        if (!dirDates.has(dir)) {
          dirDates.set(dir, currentDate)
        }
      }
      for (const fp of filePaths) {
        const dir = path.dirname(fp)
        const entry = result.get(fp)
        if (dirDates.has(dir) && entry) {
          entry.lastModified = dirDates.get(dir)
        }
      }
    }
  } catch { /* git not available or failed — leave nulls */ }

  // Batch gitAuthor: use git log for each file's creation author.
  // Unfortunately --follow --diff-filter=A doesn't combine well with multiple
  // paths, so batch them in a single shell invocation using a for loop.
  try {
    const relPaths = filePaths.map(fp => path.relative(root, fp))
    // Build a shell script that outputs "PATH<tab>AUTHOR" per file
    const cmds = relPaths.map(rp =>
      `echo -n "${rp}\\t"; git log --follow --diff-filter=A --format="%aN" -- "${rp}" | tail -1`
    ).join('; ')
    const authorResult = execSync(cmds, {
      cwd: root, encoding: 'utf-8', timeout: 10000, shell: true, maxBuffer: 1024 * 1024,
    }).trim()

    if (authorResult) {
      for (const line of authorResult.split('\n')) {
        const tabIdx = line.indexOf('\t')
        if (tabIdx < 0) continue
        const relPath = line.slice(0, tabIdx)
        const author = line.slice(tabIdx + 1).trim()
        if (!author) continue
        const absPath2 = path.resolve(root, relPath)
        const entry = result.get(absPath2)
        if (entry) entry.gitAuthor = author
      }
    }
  } catch { /* git not available */ }

  return result
}

/**
 * Scan the repo for all data files, validate uniqueness, return the index.
 */
function buildIndex(root, opts = {}) {
  const { contentOnly = false } = opts
  // Fixtures exercise the file formats but are not workspace artifacts. Indexing
  // them exposes read-only test canvases in the UI, where mutations then fail.
  const ignore = ['node_modules/**', 'dist/**', '.git/**', '.worktrees/**', 'worktrees/**', 'public/**', 'fixtures/**', 'desktop/resources/**', 'artifacts/**']
  if (contentOnly) ignore.push('publish/**', '.storyboard/**')
  const files = globSync(contentOnly ? `**/*.{flow,scene,object,record,prototype,folder,component}.{json,jsonc}` : GLOB_PATTERN, { cwd: root, ignore, absolute: false })
  const canvasFiles = globSync(CANVAS_GLOB_PATTERN, { cwd: root, ignore, absolute: false })
  const canvasMetaFiles = globSync(CANVAS_META_GLOB_PATTERN, { cwd: root, ignore, absolute: false })
  const storyFiles = globSync(STORY_GLOB_PATTERN, { cwd: root, ignore, absolute: false })

  // Detect nested .folder/ directories (not supported)
  // Scan directories directly since empty nested folders have no data files
  const folderDirs = globSync(contentOnly ? 'prototypes/**/*.folder' : 'src/prototypes/**/*.folder', { cwd: root, ignore, absolute: false })
  for (const dir of folderDirs) {
    const normalized = dir.replace(/\\/g, '/')
    const segments = normalized.split('/').filter(s => s.endsWith('.folder'))
    if (segments.length > 1) {
      throw new Error(
        `[storyboard-data] Nested .folder directories are not supported.\n` +
        `  Found at: ${dir}\n` +
        `  Folders can only be one level deep inside src/prototypes/.`
      )
    }
  }

  const index = { flow: {}, object: {}, record: {}, prototype: {}, folder: {}, component: {}, canvas: {}, 'canvas-meta': {}, story: {} }
  const seen = {} // "name.suffix" or "id.suffix" → absolute path (for duplicate detection)
  const dataScopeConflicts = []
  const protoFolders = {} // prototype name → folder name (for injection)
  const flowRoutes = {} // flow name → inferred route (for _route injection)
  const canvasRoutes = {} // canvas name → inferred route
  const canvasAliases = {} // basename → canonical ID (only when unique)
  const canvasNameCount = {} // canvas basename → count (for ambiguity detection)
  const canvasGroups = {} // canvas name → group name (shared folder prefix)
  const storyRoutes = {} // story name → inferred route

  for (const relPath of [...files, ...canvasFiles, ...canvasMetaFiles, ...storyFiles]) {
    const parsed = parseDataFile(contentOnly && !relPath.startsWith('src/') ? `src/${relPath}` : relPath)
    if (!parsed) continue

    // Canvas files use path-based IDs for dedup; others use basename
    const dedupKey = parsed.suffix === 'canvas' && parsed.id
      ? `${parsed.id}.${parsed.suffix}`
      : `${parsed.name}.${parsed.suffix}`
    const absPath = path.resolve(root, relPath)

    if (seen[dedupKey]) {
      if (['flow', 'object', 'record'].includes(parsed.suffix) && parsed.name.includes('/')) {
        dataScopeConflicts.push({ key: dedupKey, name: parsed.name, suffix: parsed.suffix, paths: [seen[dedupKey], absPath] })
        delete index[parsed.suffix][parsed.name]
        delete flowRoutes[parsed.name]
        seen[dedupKey] = absPath
        continue
      }
      const hint = parsed.suffix === 'folder'
          ? '  Folder names must be unique across the project.'
          : parsed.suffix === 'canvas'
          ? '  Canvas IDs must be unique. Move or rename one file to resolve the collision.'
          : '  Flows, records, and objects are scoped to their prototype directory.\n' +
            '  If both files are global (outside src/prototypes/), rename one to avoid the collision.'

      throw new Error(
        `[storyboard-data] Duplicate ${parsed.suffix} "${parsed.id || parsed.name}"\n` +
        `  Found at: ${seen[dedupKey]}\n` +
        `  And at:   ${absPath}\n` +
        hint
      )
    }

    seen[dedupKey] = absPath

    // Canvas: index only by canonical ID. Basename aliases go in a separate map
    // so listCanvases() and viewfinder don't show duplicates.
    if (parsed.suffix === 'canvas' && parsed.id) {
      index.canvas[parsed.id] = absPath
      // Track basename for alias resolution (only when unique)
      canvasNameCount[parsed.name] = (canvasNameCount[parsed.name] || 0) + 1
      if (canvasNameCount[parsed.name] === 1) {
        canvasAliases[parsed.name] = parsed.id
      } else {
        delete canvasAliases[parsed.name]
      }
    } else {
      index[parsed.suffix][parsed.name] = absPath
    }

    // Track which folder a prototype belongs to
    if (parsed.suffix === 'prototype' && parsed.folder) {
      protoFolders[parsed.name] = parsed.folder
    }

    // Track inferred routes for flows
    if (parsed.suffix === 'flow' && parsed.inferredRoute) {
      flowRoutes[parsed.name] = parsed.inferredRoute
    }

    // Track inferred routes for canvases (keyed by canonical ID)
    if (parsed.suffix === 'canvas' && parsed.inferredRoute) {
      const canvasKey = parsed.id || parsed.name
      canvasRoutes[canvasKey] = parsed.inferredRoute
    }

    // Track canvas groups (canvases sharing a folder prefix)
    // Use canonical ID as key to match the canvas index
    if (parsed.suffix === 'canvas' && parsed.group) {
      const groupKey = parsed.id || parsed.name
      canvasGroups[groupKey] = parsed.group
    }

    // Track inferred routes for stories
    if (parsed.suffix === 'story' && parsed.inferredRoute) {
      storyRoutes[parsed.name] = parsed.inferredRoute
    }

  }

  return { index, protoFolders, flowRoutes, canvasRoutes, canvasAliases, canvasGroups, storyRoutes, dataScopeConflicts }
}

/**
 * Recursively walk a parsed JSON value and replace `${varName}` patterns
 * in every string value. Only string values are processed — keys, numbers,
 * booleans, and null are left untouched.
 */
function resolveTemplateVars(obj, vars) {
  if (typeof obj === 'string') {
    let result = obj
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`\${${key}}`, value)
    }
    return result
  }
  if (Array.isArray(obj)) return obj.map(item => resolveTemplateVars(item, vars))
  if (obj !== null && typeof obj === 'object') {
    const out = {}
    for (const [key, value] of Object.entries(obj)) {
      out[key] = resolveTemplateVars(value, vars)
    }
    return out
  }
  return obj
}

/**
 * Compute path-based template variables for a data file.
 *
 * - currentDir:      directory of the file, relative to project root
 * - currentProto:    path to the prototype directory (e.g. src/prototypes/main.folder/Example)
 * - currentProtoDir: path to the first parent *.folder directory (e.g. src/prototypes/main.folder)
 */
function computeTemplateVars(absPath, root) {
  const relPath = path.relative(root, absPath).replace(/\\/g, '/')
  const currentDir = path.dirname(relPath).replace(/\\/g, '/')

  const protoMatch = relPath.match(/^(src\/prototypes\/(?:[^/]+\.folder\/)?[^/]+)\//)
  const currentProto = protoMatch && !protoMatch[1].endsWith('.folder') ? protoMatch[1] : ''

  const folderMatch = relPath.match(/^(src\/prototypes\/[^/]+\.folder)\//)
  const currentProtoDir = folderMatch ? folderMatch[1] : ''

  return { currentDir, currentProto, currentProtoDir }
}

/**
 * Generate the virtual module source code.
 * Reads each data file, parses JSONC at build time, and emits pre-parsed
 * JavaScript objects — no runtime parsing needed.
 */
/**
 * Detect the indent style used by an existing JSON source. Falls back to
 * tabs when the source is empty or single-line.
 */
function detectFormatting(raw) {
  const m = raw.match(/^(\t|[ ]+)(?=["{[])/m)
  if (!m) return { tabSize: 1, insertSpaces: false }
  if (m[1] === '\t') return { tabSize: 1, insertSpaces: false }
  return { tabSize: m[1].length, insertSpaces: true }
}

/**
 * Read storyboard.config.json from the project root (if it exists).
 * Returns the parsed and defaulted config object, or null if not found.
 */
function readConfig(root, coreRoot = root) {
  const configPath = path.resolve(root, 'storyboard.config.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const errors = []
    const config = parseJsonc(raw, errors)
    // Treat malformed JSON (e.g. mid-edit partial saves) as missing config
    if (errors.length > 0) return readBaselineConfig(coreRoot, configPath)
    return { config: getConfig(config), configPath }
  } catch {
    return readBaselineConfig(coreRoot, configPath)
  }
}

/**
 * Fallback for when the consumer's `storyboard.config.json` is missing or
 * malformed. Reads the canonical baseline from the storyboard package
 * itself (workspace or installed copy), then merges through getConfig so
 * the runtime never sees a missing themes block or other required keys.
 *
 * Returns `{ config: null }` only if no baseline is found anywhere, which
 * preserves the historical contract for callers that handle null.
 */
function readBaselineConfig(root, configPath) {
  const baseline = readCoreConfigFile(root, 'storyboard.config.json')
  if (baseline) return { config: getConfig(baseline), configPath }
  return { config: null, configPath }
}

/**
   * Read toolbar.config.json from @dfosco/hypercanvas.
 * Returns the full config object with modes array.
 * Falls back to hardcoded defaults if not found.
 */
function readModesConfig(root) {
  const fallback = {
    modes: [
      { name: 'prototype', label: 'Navigate', hue: '#2a2a2a' },
      { name: 'inspect', label: 'Develop', hue: '#7655a4' },
      { name: 'present', label: 'Collaborate', hue: '#2a9d8f' },
      { name: 'plan', label: 'Canvas', hue: '#4a7fad' },
    ],
  }

  // Try local workspace path first (monorepo), then node_modules
  const candidates = [
    path.resolve(root, 'packages/storyboard/toolbar.config.json'),
    path.resolve(root, 'packages/storyboard/configs/modes.config.json'),
    path.resolve(root, 'node_modules/@dfosco/hypercanvas/toolbar.config.json'),
    path.resolve(root, 'node_modules/@dfosco/hypercanvas/configs/modes.config.json'),
  ]

  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.modes) && parsed.modes.length > 0) {
        return { modes: parsed.modes }
      }
    } catch {
      // try next candidate
    }
  }

  return fallback
}

/**
 * Read a JSON/JSONC file, returning null on failure.
 */
function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const errors = []
    const parsed = parseJsonc(raw, errors)
    return errors.length === 0 ? parsed : null
  } catch {
    return null
  }
}

/**
 * Find a core config file from either the monorepo workspace or node_modules.
 */
function readCoreConfigFile(root, filename) {
  const candidates = [
    path.resolve(root, `packages/storyboard/${filename}`),
    path.resolve(root, `node_modules/@dfosco/hypercanvas/${filename}`),
  ]
  for (const p of candidates) {
    const parsed = readJsonFile(p)
    if (parsed) return parsed
  }
  return null
}

/**
 * Resolve the absolute path of a library config file (returns the first
 * candidate that exists, or null). Used by syncScaffoldDir to copy raw
 * file contents (including comments) rather than re-serializing parsed JSON.
 */
function resolveCoreConfigFilePath(root, filename) {
  const candidates = [
    path.resolve(root, `packages/storyboard/${filename}`),
    path.resolve(root, `node_modules/@dfosco/hypercanvas/${filename}`),
  ]
  for (const p of candidates) {
    try { fs.accessSync(p); return p } catch { /* try next */ }
  }
  return null
}

const SCAFFOLD_README = `# .storyboard/scaffold/

This directory is **always rewritten on dev-server boot** to reflect the
library's current default config files. The Storyboard server **never reads
config from this directory** — these files are reference copies for you to
customize.

## How to customize

1. Pick the config file you want to override (e.g. \`terminal.config.json\`).
2. **Copy it to your project root** (next to \`storyboard.config.json\`).
3. Edit only the keys you care about — leaf-level merge means everything
   else continues to inherit the library defaults, so future updates
   (new agents, new readiness signals, etc.) reach you automatically.

## Why a separate directory?

- Customers who don't want to customize don't see config clutter at the root.
- Customers who do want to customize have all the defaults available as a
  living reference, version-bumped with every storyboard release.
- Files at the root override the defaults; missing files mean "use library
  defaults". No empty placeholder files cluttering the project.

## What's in here

| File | What it covers |
|------|----------------|
| \`storyboard.config.json\` | Top-level config: themes, surfaces, modes, comments, workshop, customer-mode, repository |
| \`terminal.config.json\` | Terminal widgets + canvas agent CLIs (copilot/claude/codex/opencode) |
| \`toolbar.config.json\` | Toolbar tool registry + visibility |
| \`commandpalette.config.json\` | Command palette entries |
| \`paste.config.json\` | URL → widget paste rules |
| \`widgets.config.json\` | Widget defaults (size, behavior) |

Don't edit files in this directory — your changes will be overwritten on
the next dev-server boot. Always copy to the project root first.
`

const SCAFFOLD_FILES = [
  'storyboard.config.json',
  'terminal.config.json',
  'toolbar.config.json',
  'commandpalette.config.json',
  'paste.config.json',
  'widgets.config.json',
  'mascot.config.json',
]

/**
 * Sync `.storyboard/scaffold/` with the library's current default config
 * files. Always overwrites — users must copy to the project root to
 * customize. Idempotent and best-effort.
 */
function syncScaffoldDir(root) {
  const scaffoldDir = path.resolve(root, '.storyboard', 'scaffold')
  try { fs.mkdirSync(scaffoldDir, { recursive: true }) } catch { /* empty */ }

  const readmePath = path.resolve(scaffoldDir, 'README.md')
  try { fs.writeFileSync(readmePath, SCAFFOLD_README) } catch { /* empty */ }

  for (const filename of SCAFFOLD_FILES) {
    const src = resolveCoreConfigFilePath(root, filename)
    if (!src) continue
    const dest = path.resolve(scaffoldDir, filename)
    try {
      const raw = fs.readFileSync(src, 'utf-8')
      fs.writeFileSync(dest, raw)
    } catch { /* skip on error */ }
  }
}

/**
 * Deep-merge helper (same as loader.js deepMerge but available at build time).
 * Arrays are replaced, not concatenated. Objects are recursively merged.
 */
function deepMergeBuild(target, source) {
  if (!source || typeof source !== 'object') return target
  if (!target || typeof target !== 'object') return source
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMergeBuild(tv, sv)
    } else if (Array.isArray(sv) && Array.isArray(tv) && sv.length > 0 && tv.length > 0 && sv[0]?.id && tv[0]?.id) {
      // Id-based array merge: override matching entries by id, keep the rest, append new ones
      const targetMap = new Map(tv.map(item => [item.id, item]))
      for (const item of sv) {
        targetMap.set(item.id, item.id && targetMap.has(item.id)
          ? deepMergeBuild(targetMap.get(item.id), item)
          : item)
      }
      result[key] = [...targetMap.values()]
    } else {
      result[key] = sv
    }
  }
  return result
}

/**
 * Build the unified config object by reading and merging all config sources.
 *
 * Priority (lowest → highest):
 *   configSchema defaults → core domain configs → storyboard.config.json → user domain configs
 *
 * Domain-specific config files (toolbar.config.json, commandpalette.config.json, etc.)
 * always win over storyboard.config.json — specificity beats generality.
 * Deep merge is used at every layer: objects are recursively merged (keys append),
 * arrays and scalars are replaced.
 *
 * Returns { unified, warnings } where warnings is an array of overlap messages.
 */
function buildUnifiedConfig(root, coreRoot = root) {
  const warnings = []

  // 1. Read core defaults (lowest priority domain configs)
  const coreToolbar = readCoreConfigFile(coreRoot, 'toolbar.config.json') || {}
  const coreCommandPalette = readCoreConfigFile(coreRoot, 'commandpalette.config.json') || {}
  const corePaste = readCoreConfigFile(coreRoot, 'paste.config.json') || {}
  const coreWidgets = readCoreConfigFile(coreRoot, 'widgets.config.json') || {}
  const coreTerminal = readCoreConfigFile(coreRoot, 'terminal.config.json') || {}

  // 2. Read storyboard.config.json (middle priority)
  // Use the schema-defaulted config for most things, but also read
  // the raw file to know which keys were explicitly set by the user.
  const { config: sbConfig } = readConfig(root, coreRoot)
  const rawSbConfig = readJsonFile(path.resolve(root, 'storyboard.config.json')) || {}

  // 3. Apply storyboard.config.json overrides on top of core domain configs.
  // Only merge when the user explicitly defined the key in storyboard.config.json
  // (not from configSchema defaults, which would overwrite core config with empty arrays).
  const afterSbToolbar = rawSbConfig.toolbar
    ? deepMergeBuild(coreToolbar, sbConfig.toolbar)
    : coreToolbar
  const afterSbCommandPalette = rawSbConfig.commandPalette
    ? deepMergeBuild(coreCommandPalette, sbConfig.commandPalette)
    : coreCommandPalette
  const afterSbPaste = rawSbConfig.paste
    ? deepMergeBuild(corePaste, sbConfig.paste || {})
    : corePaste
  const afterSbWidgets = rawSbConfig.widgets
    ? deepMergeBuild(coreWidgets, sbConfig.widgets || {})
    : coreWidgets
  // For terminal/agents, slot canvas.terminal + canvas.agents from storyboard.config.json
  // into the same shape as terminal.config.json so the merge is uniform.
  const rawCanvas = rawSbConfig.canvas || {}
  const sbTerminalLike = (rawSbConfig.hotPool || rawCanvas.terminal || rawCanvas.agents)
    ? {
        ...(rawCanvas.terminal ? { terminal: sbConfig.canvas.terminal } : {}),
        ...(rawCanvas.agents ? { agents: sbConfig.canvas.agents } : {}),
        ...(rawSbConfig.hotPool ? { hotPool: sbConfig.hotPool } : {}),
      }
    : null
  const afterSbTerminal = sbTerminalLike
    ? deepMergeBuild(coreTerminal, sbTerminalLike)
    : coreTerminal

  // 4. Read user domain config files (highest priority)
  const userFiles = [
    { domain: 'widgets', filename: 'widgets.config.json' },
    { domain: 'paste', filename: 'paste.config.json' },
    { domain: 'toolbar', filename: 'toolbar.config.json' },
    { domain: 'commandPalette', filename: 'commandpalette.config.json' },
    { domain: 'terminal', filename: 'terminal.config.json' },
  ]

  const userConfigs = {}
  for (const { domain, filename } of userFiles) {
    const filePath = path.resolve(root, filename)
    const parsed = readJsonFile(filePath)
    if (parsed) userConfigs[domain] = { data: parsed, filename }
  }

  // 5. Apply user domain configs on top of everything (highest priority)
  const finalToolbar = userConfigs.toolbar
    ? deepMergeBuild(afterSbToolbar, userConfigs.toolbar.data)
    : afterSbToolbar
  const finalCommandPalette = userConfigs.commandPalette
    ? deepMergeBuild(afterSbCommandPalette, userConfigs.commandPalette.data)
    : afterSbCommandPalette
  const finalPaste = userConfigs.paste
    ? deepMergeBuild(afterSbPaste, userConfigs.paste.data)
    : afterSbPaste
  const finalWidgets = userConfigs.widgets
    ? deepMergeBuild(afterSbWidgets, userConfigs.widgets.data)
    : afterSbWidgets
  const finalTerminal = userConfigs.terminal
    ? deepMergeBuild(afterSbTerminal, userConfigs.terminal.data)
    : afterSbTerminal

  // 6. Detect overlaps between storyboard.config.json and user domain configs
  const domainOverlapChecks = [
    { sbKey: 'toolbar', domain: 'toolbar', label: 'toolbar.config.json' },
    { sbKey: 'commandPalette', domain: 'commandPalette', label: 'commandpalette.config.json' },
    { sbKey: 'paste', domain: 'paste', label: 'paste.config.json' },
    { sbKey: 'widgets', domain: 'widgets', label: 'widgets.config.json' },
  ]
  for (const { sbKey, domain, label } of domainOverlapChecks) {
    if (rawSbConfig[sbKey] && userConfigs[domain]) {
      const overlaps = findOverlappingKeys(rawSbConfig[sbKey], userConfigs[domain].data)
      for (const key of overlaps) {
        warnings.push(`Config overlap: "${key}" is defined in both storyboard.config.json.${sbKey} and ${label} — ${label} wins.`)
      }
    }
  }
  // Terminal overlap check: storyboard.config.json.canvas.{terminal,agents} vs terminal.config.json
  if (sbTerminalLike && userConfigs.terminal) {
    const overlaps = findOverlappingKeys(sbTerminalLike, userConfigs.terminal.data)
    for (const key of overlaps) {
      warnings.push(`Config overlap: "${key}" is defined in both storyboard.config.json.canvas and terminal.config.json — terminal.config.json wins.`)
    }
  }

  // 7. Build the unified config object.
  // Start from the schema-defaulted sbConfig so every top-level key from
  // storyboard.config.json (and every schema default) flows to initConfig().
  // Then override the domain-specific slices that have their own dedicated
  // config files merged above (toolbar/commandPalette/paste/widgets/terminal).
  const sbCanvas = sbConfig?.canvas || {}
  const unified = {
    ...(sbConfig || {}),
    toolbar: finalToolbar,
    commandPalette: finalCommandPalette,
    paste: finalPaste,
    widgets: finalWidgets,
    hotPool: finalTerminal?.hotPool || sbConfig?.hotPool || {},
    canvas: {
      ...sbCanvas,
      terminal: deepMergeBuild(sbCanvas.terminal || {}, finalTerminal.terminal || {}),
      agents: deepMergeBuild(sbCanvas.agents || {}, finalTerminal.agents || {}),
      ...(finalTerminal.showAgentsInAddMenu !== undefined ? { showAgentsInAddMenu: finalTerminal.showAgentsInAddMenu } : {}),
    },
  }

  return { unified, warnings }
}

/**
 * Find top-level keys that exist in both objects (overlap detection).
 */
function findOverlappingKeys(a, b, prefix = '') {
  const overlaps = []
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return overlaps
  for (const key of Object.keys(a)) {
    if (key in b) {
      const path = prefix ? `${prefix}.${key}` : key
      overlaps.push(path)
    }
  }
  return overlaps
}

function extractPrototypeKnobs(parsed) {
  if (Array.isArray(parsed?.meta?.knobs)) return parsed.meta.knobs
  if (Array.isArray(parsed?.knobs)) return parsed.knobs
  return []
}

function extractComponentKnobs(parsed) {
  if (Array.isArray(parsed?.knobs)) return parsed.knobs
  if (Array.isArray(parsed?.meta?.knobs)) return parsed.meta.knobs
  return []
}

function viteModulePath(absPath, moduleRoot) {
  const relative = path.relative(moduleRoot, absPath)
  if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return '/' + relative.replace(/\\/g, '/')
  }
  return '/@fs/' + path.resolve(absPath).replace(/\\/g, '/')
}

function buildDiscoveryResult({ index, protoFolders, flowRoutes, canvasRoutes, canvasAliases, canvasGroups, storyRoutes, dataScopeConflicts = [] }, root, moduleRoot = root) {
  const discovery = {
    flows: {},
    objects: {},
    records: {},
    prototypes: {},
    prototypeKnobs: {},
    componentKnobs: {},
    folders: {},
    canvases: {},
    canvasAliases: canvasAliases || {},
    stories: {},
  }
  const INDEX_KEYS = ['flow', 'object', 'record', 'prototype', 'folder', 'canvas']
  const resultKeys = {
    flow: 'flows',
    object: 'objects',
    record: 'records',
    prototype: 'prototypes',
    folder: 'folders',
    canvas: 'canvases',
  }
  const resolvedFlowRoutes = {}

  // Batch-fetch git metadata for all prototype + canvas files in 1-2 subprocesses
  const gitPaths = [
    ...Object.values(index.prototype || {}),
    ...Object.values(index.canvas || {}),
  ]
  const gitMeta = batchGitMetadata(root, gitPaths)

  // Read canvas-meta files and build a directory-based lookup
  const canvasMetaByDir = {}
  for (const [, absPath] of Object.entries(index['canvas-meta'] || {})) {
    try {
      const raw = fs.readFileSync(absPath, 'utf-8')
      const parsed = parseJsonc(raw)
      if (parsed) {
        // Key by the parent directory path relative to src/canvas/
        const dirPath = path.dirname(absPath).replace(/\\/g, '/')
        const canvasRelDir = dirPath.replace(/^.*?src\/canvas\//, '')
        canvasMetaByDir[canvasRelDir] = parsed
        // Drafts canvases derive their group with `drafts/` stripped, so also
        // index the meta under the stripped dir so the group lookup matches.
        const canvasRelDirPublic = canvasRelDir.split('/').filter(seg => seg !== 'drafts').join('/')
        if (canvasRelDirPublic !== canvasRelDir) canvasMetaByDir[canvasRelDirPublic] = parsed
      }
    } catch { /* skip invalid meta files */ }
  }

  for (const suffix of INDEX_KEYS) {
    for (const [name, absPath] of Object.entries(index[suffix])) {
      const raw = fs.readFileSync(absPath, 'utf-8')
      let parsed = suffix === 'canvas'
        ? materializeFromText(raw)
        : parseJsonc(raw)

      // Auto-fill gitAuthor for prototype metadata from git history
      if (suffix === 'prototype' && parsed && !parsed.gitAuthor) {
        const meta = gitMeta.get(absPath)
        if (meta?.gitAuthor) {
          parsed = { ...parsed, gitAuthor: meta.gitAuthor }
        }
      }

      // Auto-fill lastModified from git history for prototypes and canvases
      if ((suffix === 'prototype' || suffix === 'canvas') && parsed) {
        const meta = gitMeta.get(absPath)
        if (meta?.lastModified) {
          parsed = { ...parsed, lastModified: meta.lastModified }
        }
      }

      // Inject folder association into prototype metadata
      if (suffix === 'prototype' && protoFolders[name]) {
        parsed = { ...parsed, folder: protoFolders[name] }
      }

      // Load prototype-level config overrides from the prototype directory.
      // Any config file placed alongside the .prototype.json becomes an override
      // for that domain when the prototype is active.
      if (suffix === 'prototype') {
        const protoDir = path.dirname(absPath)
        const protoConfigFiles = [
          { filename: 'toolbar.config.json', key: 'toolbarConfig' },
          { filename: 'commandpalette.config.json', key: 'commandPaletteConfig' },
          { filename: 'widgets.config.json', key: 'widgetsConfig' },
          { filename: 'paste.config.json', key: 'pasteConfig' },
        ]
        for (const { filename, key } of protoConfigFiles) {
          const cfgPath = path.join(protoDir, filename)
          if (fs.existsSync(cfgPath)) {
            try {
              const cfgRaw = fs.readFileSync(cfgPath, 'utf-8')
              const cfg = parseJsonc(cfgRaw)
              if (cfg) {
                parsed = { ...parsed, [key]: cfg }
              }
            } catch { /* skip invalid config */ }
          }
        }
      }

      // Inject inferred _route into flow data (explicit route takes precedence)
      if (suffix === 'flow' && flowRoutes[name] && !parsed?.route) {
        parsed = { ...parsed, _route: flowRoutes[name] }
      }

      // Track resolved route for multi-flow logging
      if (suffix === 'flow') {
        const route = parsed?.route || parsed?._route || null
        if (route) {
          resolvedFlowRoutes[name] = { route, isDefault: parsed?.meta?.default === true }
        }
      }

      // Auto-fill gitAuthor for canvas metadata from git history
      if (suffix === 'canvas' && parsed && !parsed.gitAuthor) {
        const meta = gitMeta.get(absPath)
        if (meta?.gitAuthor) {
          parsed = { ...parsed, gitAuthor: meta.gitAuthor }
        }
      }

      // Inject inferred route, group, and resolve JSX companion for canvases
      if (suffix === 'canvas') {
        if (canvasRoutes[name]) {
          parsed = { ...parsed, _route: canvasRoutes[name] }
        }
        if (canvasGroups[name]) {
          parsed = { ...parsed, _group: canvasGroups[name] }
        }
        // Inject canvas folder metadata from .meta.json
        if (canvasGroups[name] && canvasMetaByDir[canvasGroups[name]]) {
          parsed = { ...parsed, _canvasMeta: canvasMetaByDir[canvasGroups[name]] }
        }
        // Inject folder association
        const folderDirMatch = path.relative(root, absPath).replace(/\\/g, '/').match(/(?:^|\/)src\/(?:prototypes|canvas)\/([^/]+)\.folder\//)
        if (folderDirMatch) {
          parsed = { ...parsed, _folder: folderDirMatch[1] }
        }
        // Resolve JSX companion file path
        if (parsed?.jsx) {
          const jsxPath = path.resolve(path.dirname(absPath), parsed.jsx)
          if (fs.existsSync(jsxPath)) {
            const relJsx = viteModulePath(jsxPath, moduleRoot)
            parsed = { ...parsed, _jsxModule: relJsx }
          } else {
            console.warn(
              `[storyboard-data] Canvas "${name}" references JSX file "${parsed.jsx}" but it was not found at ${jsxPath}`
            )
          }
        }
      }

      // Resolve template variables (${currentDir}, ${currentProto}, ${currentProtoDir})
      const templateVars = computeTemplateVars(absPath, root)
      if (!templateVars.currentProto && raw.includes('${currentProto}')) {
        console.warn(
          `[storyboard-data] \${currentProto} used in "${path.relative(root, absPath)}" ` +
          `but file is not inside a prototype directory. Variable resolves to empty string.`
        )
      }
      if (!templateVars.currentProtoDir && raw.includes('${currentProtoDir}')) {
        console.warn(
          `[storyboard-data] \${currentProtoDir} used in "${path.relative(root, absPath)}" ` +
          `but file is not inside a .folder directory. Variable resolves to empty string.`
        )
      }
      parsed = resolveTemplateVars(parsed, templateVars)

      if (suffix === 'prototype') {
        discovery.prototypeKnobs[name] = extractPrototypeKnobs(parsed)
      }

      discovery[resultKeys[suffix]][name] = parsed
    }
  }

  for (const [name, absPath] of Object.entries(index.component || {})) {
    const raw = fs.readFileSync(absPath, 'utf-8')
    let parsed = parseJsonc(raw)
    parsed = resolveTemplateVars(parsed, computeTemplateVars(absPath, root))
    discovery.componentKnobs[name] = extractComponentKnobs(parsed)
  }

  // Generate story entries (code modules with dynamic imports, not JSON data)
  for (const [name, absPath] of Object.entries(index.story || {})) {
    const relModule = viteModulePath(absPath, moduleRoot)
    const storyMeta = { _storyModule: relModule, _exportNames: parseStoryExportNames(absPath) }
    if (storyRoutes[name]) {
      storyMeta._route = storyRoutes[name]
    }
    discovery.stories[name] = storyMeta
  }

  discovery._resolvedFlowRoutes = resolvedFlowRoutes
  if (dataScopeConflicts.length) discovery._dataScopeConflicts = dataScopeConflicts
  return discovery
}

export function buildDataDiscovery(root, opts = {}) {
  return buildDiscoveryResult(buildIndex(root, opts), root)
}

function generateModule(buildResult, root, applicationRoot = root) {
  const discovery = buildDiscoveryResult(buildResult, root, applicationRoot)
  const declarations = []
  const INDEX_KEYS = [
    ['flow', 'flows'],
    ['object', 'objects'],
    ['record', 'records'],
    ['prototype', 'prototypes'],
    ['folder', 'folders'],
    ['canvas', 'canvases'],
  ]
  const entries = { flow: [], object: [], record: [], prototype: [], folder: [], canvas: [] }
  const storyEntries = []
  const resolvedFlowRoutes = discovery._resolvedFlowRoutes || {}
  let i = 0

  for (const [suffix, key] of INDEX_KEYS) {
    for (const [name, parsed] of Object.entries(discovery[key])) {
      const varName = `_d${i++}`
      if (suffix === 'canvas' && parsed._jsxModule) {
        declarations.push(`const ${varName} = Object.assign(${JSON.stringify(parsed)}, { _jsxImport: () => import(${JSON.stringify(parsed._jsxModule)}) })`)
      } else {
        declarations.push(`const ${varName} = ${JSON.stringify(parsed)}`)
      }
      entries[suffix].push(`  ${JSON.stringify(name)}: ${varName}`)
    }
  }

  for (const [name, storyMeta] of Object.entries(discovery.stories || {})) {
    const varName = `_d${i++}`
    declarations.push(
      `const ${varName} = Object.assign(${JSON.stringify(storyMeta)}, { _storyImport: () => import(${JSON.stringify(storyMeta._storyModule)}) })`
    )
    storyEntries.push(`  ${JSON.stringify(name)}: ${varName}`)
  }

  const imports = [`import { init, initKnobs } from '@dfosco/hypercanvas/core'`]
  const initCalls = [
    `init({ flows, objects, records, prototypes, folders, canvases, stories })`,
    `initKnobs({ prototypeKnobs, componentKnobs })`,
  ]

  // Build unified config from all sources
  const { unified: unifiedConfig, warnings: configWarnings } = buildUnifiedConfig(root, applicationRoot)
  for (const w of configWarnings) {
    console.warn(`[storyboard] ⚠ ${w}`)
  }
    imports.push(`import { initConfig } from '@dfosco/hypercanvas/core'`)
  initCalls.push(`initConfig(${JSON.stringify(unifiedConfig)})`)

  // Feature flags from storyboard.config.json
  const { config } = readConfig(root, applicationRoot)
  if (config?.featureFlags && Object.keys(config.featureFlags).length > 0) {
    imports.push(`import { initFeatureFlags } from '@dfosco/hypercanvas/core'`)
    initCalls.push(`initFeatureFlags(${JSON.stringify(config.featureFlags)})`)
  }

  // Plugin configuration from storyboard.config.json
  if (config?.plugins && Object.keys(config.plugins).length > 0) {
    imports.push(`import { initPlugins } from '@dfosco/hypercanvas/core'`)
    initCalls.push(`initPlugins(${JSON.stringify(config.plugins)})`)
  }

  // Modes configuration from storyboard.config.json
  if (config?.modes) {
    imports.push(`import { initModesConfig, registerMode, syncModeClasses, initTools } from '@dfosco/hypercanvas/core'`)
    initCalls.push(`initModesConfig(${JSON.stringify(config.modes)})`)

    if (config.modes.enabled) {
      imports.push(`import '@dfosco/hypercanvas/modes.css'`)

      const modesConfig = readModesConfig(root)
      const modes = config.modes.defaults || modesConfig.modes
      for (const m of modes) {
        initCalls.push(`registerMode(${JSON.stringify(m.name)}, { label: ${JSON.stringify(m.label)} })`)
      }

      initCalls.push(`syncModeClasses()`)
    }
  }

  // UI config from storyboard.config.json (menu visibility overrides)
  if (config?.ui) {
    imports.push(`import { initUIConfig } from '@dfosco/hypercanvas/core'`)
    initCalls.push(`initUIConfig(${JSON.stringify(config.ui)})`)
  }

  // Customer mode config from storyboard.config.json
  if (config?.customerMode) {
    imports.push(`import { initCustomerModeConfig } from '@dfosco/hypercanvas/core'`)
    initCalls.push(`initCustomerModeConfig(${JSON.stringify(config.customerMode)})`)
  }

  // Client toolbar overrides from root toolbar.config.json
  const clientToolbarPath = path.resolve(root, 'toolbar.config.json')
  try {
    if (fs.existsSync(clientToolbarPath)) {
      const raw = fs.readFileSync(clientToolbarPath, 'utf-8')
      const errors = []
      const parsed = parseJsonc(raw, errors)
      if (parsed && errors.length === 0) {
        imports.push(`import { setClientToolbarOverrides } from '@dfosco/hypercanvas/core'`)
        initCalls.push(`setClientToolbarOverrides(${JSON.stringify(parsed)})`)
      }
    }
  } catch { /* skip if unreadable */ }

  // Log info when multiple flows target the same route
  const routeGroups = {}
  for (const [name, { route, isDefault }] of Object.entries(resolvedFlowRoutes)) {
    if (!routeGroups[route]) routeGroups[route] = []
    routeGroups[route].push({ name, isDefault })
  }
  for (const [route, flows] of Object.entries(routeGroups)) {
    if (flows.length > 1) {
      const defaults = flows.filter(f => f.isDefault)
      if (defaults.length > 1) {
        console.warn(
          `[storyboard-data] Warning: Route "${route}" has ${defaults.length} flows with meta.default: true.\n` +
          `  Only one flow per route should be marked as default.`
        )
      }
    }
  }

  return [
    imports.join('\n'),
    '',
    declarations.join('\n'),
    '',
    `const flows = {\n${entries.flow.join(',\n')}\n}`,
    `const objects = {\n${entries.object.join(',\n')}\n}`,
    `const records = {\n${entries.record.join(',\n')}\n}`,
    `const prototypes = {\n${entries.prototype.join(',\n')}\n}`,
    `const prototypeKnobs = ${JSON.stringify(discovery.prototypeKnobs || {})}`,
    `const componentKnobs = ${JSON.stringify(discovery.componentKnobs || {})}`,
    `const folders = {\n${entries.folder.join(',\n')}\n}`,
    `const canvases = {\n${entries.canvas.join(',\n')}\n}`,
    `const stories = {\n${storyEntries.join(',\n')}\n}`,
    '',
    `// Legacy basename → canonical ID aliases (only unique basenames)`,
    `const canvasAliases = ${JSON.stringify(discovery.canvasAliases || {})}`,
    '',
    '// Backward-compatible alias',
    'const scenes = flows',
    '',
    initCalls.join('\n'),
    '',
    `export { flows, scenes, objects, records, prototypes, prototypeKnobs, componentKnobs, folders, canvases, canvasAliases, stories }`,
    `export const index = { flows, scenes, objects, records, prototypes, prototypeKnobs, componentKnobs, folders, canvases, canvasAliases, stories }`,
    `export default index`,
    '',
    '// Live-patch canvas data on Hypercanvas server events so SPA navigation shows fresh state',
    'if (typeof window !== "undefined") {',
    '  window.addEventListener("storyboard:canvas-file-changed", (event) => {',
    '    const data = event.detail',
    '    if (!data) return',
    '    const id = data.canvasId || data.name',
    '    if (data.removed) {',
    '      delete canvases[id]',
    '    } else if (data.metadata) {',
    '      // Merge into existing entry to preserve build-time fields (_jsxModule, _jsxImport, etc.)',
    '      canvases[id] = canvases[id]',
    '        ? Object.assign({}, canvases[id], data.metadata)',
    '        : data.metadata',
    '    }',
    '    init({ flows, objects, records, prototypes, folders, canvases, stories })',
    '    initKnobs({ prototypeKnobs, componentKnobs })',
    '    document.dispatchEvent(new CustomEvent("storyboard:canvas-index-changed"))',
    '  })',
    '  window.addEventListener("storyboard:story-file-changed", (event) => {',
    '    const data = event.detail',
    '    if (!data) return',
    '    if (data.removed) {',
    '      delete stories[data.name]',
    '    } else {',
    '      stories[data.name] = { _storyModule: data._storyModule, _route: data._route,',
    '        _storyImport: () => import(/* @vite-ignore */ data._storyModule) }',
    '    }',
    '    init({ flows, objects, records, prototypes, folders, canvases, stories })',
    '    initKnobs({ prototypeKnobs, componentKnobs })',
    '    document.dispatchEvent(new CustomEvent("storyboard:story-index-changed"))',
    '  })',
    '}',
    '',
    '// Filesystem watcher updates arrive through Vite custom HMR events.',
    'if (import.meta.hot && typeof window !== "undefined") {',
    '  import.meta.hot.on("storyboard:canvas-file-changed", (data) => window.dispatchEvent(new CustomEvent("storyboard:canvas-file-changed", { detail: data })))',
    '  import.meta.hot.on("storyboard:story-file-changed", (data) => window.dispatchEvent(new CustomEvent("storyboard:story-file-changed", { detail: data })))',
    '}',
  ].join('\n')
}

/**
 * Resolve the on-disk path for the generated themes CSS file
 * (`themes.generated.css`, a sibling of `tailwind.css`). Returns null
 * when the styles dir lives inside a `node_modules` segment — consumers
 * import the pre-built `dist/tailwind.css` and must never trigger writes
 * into a published package's source tree.
 */
function resolveGeneratedThemesCssPath() {
  const stylesDir = path.dirname(new URL('../../core/styles/tailwind.css', import.meta.url).pathname)
  if (stylesDir.split(path.sep).includes('node_modules')) return null
  return path.join(stylesDir, GENERATED_THEMES_CSS_FILENAME)
}

/**
 * Write `themes.generated.css` next to `tailwind.css` from the project's
 * themes config. No-op when:
 *  - the styles dir is inside `node_modules` (consumer install, file ships
 *    pre-built via `dist/tailwind.css`), or
 *  - the new content is byte-identical to what's already on disk (avoids
 *    a chokidar → HMR feedback loop on every config touch).
 *
 * Returns the absolute path written (or null when skipped) so callers can
 * invalidate the corresponding Vite module graph entry.
 */
function writeThemesCssFile(rootDir, coreRoot = rootDir) {
  const outPath = resolveGeneratedThemesCssPath()
  if (!outPath) return null
  const { config: sbCfg } = readConfig(rootDir, coreRoot)
  const themesCfg = (sbCfg && sbCfg.theming) || getConfig({}).theming
  const next = generateThemesCss(themesCfg)
  try {
    const prev = fs.readFileSync(outPath, 'utf-8')
    if (prev === next) return outPath
  } catch { /* file may not exist yet */ }
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, next)
    return outPath
  } catch {
    return null
  }
}

/**
 * Vite plugin for storyboard data discovery.
 *
 * - Scans the repo for *.flow.json, *.scene.json (compat), *.object.json, *.record.json, *.canvas.jsonl, *.story.{jsx,tsx}
 * - Validates no two files share the same name+suffix (hard build error)
 * - Generates a virtual module `virtual:storyboard-data-index`
 * - Writes `themes.generated.css` next to `tailwind.css` exposing the
 *   `@custom-variant dark` Tailwind scaffolding for every configured
 *   theme surface (re-written on storyboard.config.json changes). A real
 *   on-disk file — not a virtual module — because `@tailwindcss/vite` and
 *   the standalone `tailwindcss` CLI resolve CSS `@import` paths through
 *   their own resolver that bypasses the Vite plugin chain.
 * - Watches for file additions/removals in dev mode
 */
export default function storyboardDataPlugin({ notebookRuntime = null } = {}) {
  let root = ''
  let applicationRoot = ''
  let discoveryRoot = ''
  let contentOnly = false
  let buildResult = null
  // Set by configResolved — true during `vite` (dev), false during `vite build`.
  let isBuild = false
  let outDir = ''

  // The active Notebook can switch at runtime via
  // /_storyboard/notebook-runtime/open, which only sets
  // HYPERCANVAS_NOTEBOOK_ROOT — no file watcher event fires for that.
  // Re-resolve the discovery root on every index request so the data
  // surface follows the switch, invalidating the cached index when the
  // root changed.
  function currentIndex() {
    const notebookRoot = notebookRuntime
      ? notebookRuntime.status().root
      : (process.env.HYPERCANVAS_NOTEBOOK_ROOT ? path.resolve(process.env.HYPERCANVAS_NOTEBOOK_ROOT) : null)
    const activeRoot = notebookRoot ?? root
    if (root && activeRoot !== discoveryRoot) {
      discoveryRoot = activeRoot
      contentOnly = activeRoot !== root
      buildResult = null
    }
    if (!buildResult) buildResult = buildIndex(discoveryRoot, { contentOnly })
    return buildResult
  }

  return {
    name: 'storyboard-data',
    enforce: 'pre',

    config() {
      return {
        optimizeDeps: {
          // @dfosco/hypercanvas is excluded (virtual module), so Vite
          // can't trace into its deps. Include the markdown pipeline entry
          // points so Vite pre-bundles the full chain — covers all transitive
          // CJS packages (debug, extend, etc.) without whack-a-mole.
          include: [
            'cmdk',
            'remark-parse', 'remark-gfm', 'remark-rehype',
            'rehype-raw', 'rehype-sanitize', 'rehype-stringify',
            'use-sync-external-store/shim', 'use-sync-external-store/shim/with-selector',
            'feather-icons', '@primer/octicons', 'ansi-to-html',
            // @primer/react ≥38 ships pre-compiled with React Compiler and
            // imports `c` from react-compiler-runtime (CJS). Pre-bundle both
            // so Vite generates the proper named-export interop.
            '@primer/react', 'react-compiler-runtime',
            // react-is ships as CJS and @primer/react imports `isElement` as a
            // named ESM import. Without pre-bundling, Vite serves the raw CJS
            // file which breaks the named import in the browser.
            'react-is',
          ],
          exclude: ['@dfosco/hypercanvas'],
        },
      }
    },

    configResolved(config) {
      root = config.root
      applicationRoot = root
      discoveryRoot = notebookRuntime
        ? (notebookRuntime.status().root || root)
        : (process.env.HYPERCANVAS_NOTEBOOK_ROOT ? path.resolve(process.env.HYPERCANVAS_NOTEBOOK_ROOT) : root)
      contentOnly = discoveryRoot !== root
      isBuild = config.command === 'build'
      outDir = path.resolve(root, config.build?.outDir || 'dist')

      // On dev boot, sync .storyboard/scaffold/ with the library's current
      // default config files so users always have an up-to-date copy-source
      // for customizations. Files in .storyboard/scaffold/ are NEVER read by
      // the server — only files at the project root are. Always overwrites.
      if (config.command === 'serve') {
        try { syncScaffoldDir(root) } catch { /* best-effort */ }
      }

      // Write `themes.generated.css` so Tailwind can resolve the @import in
      // tailwind.css on the very first request. Runs for both `serve` and
      // `build`; safely no-ops when the styles dir lives in node_modules.
      try { writeThemesCssFile(discoveryRoot, applicationRoot) } catch { /* best-effort */ }
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_ID
      if (id === PROTOTYPE_ROUTES_VIRTUAL_ID) return id
    },

    load(id) {
      if (id === RESOLVED_ID) {
        return generateModule(currentIndex(), discoveryRoot, applicationRoot)
      }
      if (id === PROTOTYPE_ROUTES_VIRTUAL_ID) {
        // Route maps follow the active Notebook only — application-root
        // prototypes are already covered by the entry's own glob.
        const notebookRoot = notebookRuntime
          ? notebookRuntime.status().root
          : (process.env.HYPERCANVAS_NOTEBOOK_ROOT ? path.resolve(process.env.HYPERCANVAS_NOTEBOOK_ROOT) : null)
        return notebookPrototypeRouteSource(notebookRoot)
      }
      return null
    },

    configureServer(server) {
      // ── Iframe-isolation middlewares ──────────────────────────────
      // Both `prototypes.html` (prototype embeds) and `stories.html`
      // (story / component-set widgets) follow the same recipe — see
      // .agents/plans/vite-isolation.md and internals/canvas/isolation/
      // for the shared primitive. The middleware factory keeps both
      // surfaces in lockstep so a fix to one benefits the other.
      const prototypesEntryPath = new URL('../canvas/isolation/prototypesEntry.jsx', import.meta.url).pathname
      server.middlewares.use(createIsolationMiddleware(
        {
          name: 'prototypes.html',
          entryPath: prototypesEntryPath,
          surface: 'prototype',
          title: 'Hypercanvas · Prototypes',
          getThemes: () => readConfig(discoveryRoot, applicationRoot).config.themes,
        },
        { renderInlineBootstrapScript, server },
      ))

      const storiesEntryPath = new URL('../canvas/isolation/storiesEntry.jsx', import.meta.url).pathname
      server.middlewares.use(createIsolationMiddleware(
        {
          name: 'stories.html',
          entryPath: storiesEntryPath,
          // Use the prototype surface so stories follow the same theme as
          // prototype embeds (users toggle "prototype" in the theme menu
          // and expect both surfaces to track together).
          surface: 'prototype',
          title: 'Hypercanvas · Stories',
          getThemes: () => readConfig(discoveryRoot, applicationRoot).config.themes,
        },
        { renderInlineBootstrapScript, server },
      ))

      // ── Notebook prototype route map invalidation ─────────────────
      // Notebook prototype files live outside the application root, so Vite's
      // own module graph never invalidates the route map when they change.
      // Mirror the notebook-routes plugin's triggers for the data-plugin-hosted
      // map. When that plugin is registered it owns the full-reload broadcast;
      // otherwise this is the only route map in play and must broadcast itself.
      function notebookRootForRoutes() {
        return notebookRuntime
          ? notebookRuntime.status().root
          : (process.env.HYPERCANVAS_NOTEBOOK_ROOT ? path.resolve(process.env.HYPERCANVAS_NOTEBOOK_ROOT) : null)
      }
      function invalidatePrototypeRouteMap() {
        const module = server.moduleGraph.getModuleById(PROTOTYPE_ROUTES_VIRTUAL_ID)
        if (module) server.moduleGraph.invalidateModule(module)
        // The notebook-routes plugin's own watcher handler already broadcasts
        // a full-reload for these events; avoid a second one.
        if (!server.__hypercanvasNotebookRoutesReload) server.ws.send({ type: 'full-reload' })
      }
      const updatePrototypeRoutes = (file = '') => {
        const notebookRoot = notebookRootForRoutes()
        if (!notebookRoot || !file.startsWith(notebookRoot)) return
        if (!file.includes(`${path.sep}prototypes${path.sep}`)) return
        invalidatePrototypeRouteMap()
      }
      server.watcher.on('add', updatePrototypeRoutes)
      server.watcher.on('change', updatePrototypeRoutes)
      server.watcher.on('unlink', updatePrototypeRoutes)

      // ── Stories list API ──────────────────────────────────────────
      // Serves the list of discovered stories for the CLI and UI story picker.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next()
        let url = req.url
        const baseNoTrail = (server.config.base || '/').replace(/\/$/, '')
        if (baseNoTrail && url.startsWith(baseNoTrail)) {
          url = url.slice(baseNoTrail.length) || '/'
        }
        if (!url.startsWith('/_storyboard/stories/list')) return next()

        const current = currentIndex()
        const storyEntries = Object.entries(current.index.story || {})
        const storyRoutes = current.storyRoutes || {}
        const stories = storyEntries.map(([name]) => ({
          name,
          route: storyRoutes[name] || null,
        }))

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ stories }))
      })

      // ── Config API ────────────────────────────────────────────────
      // Read and write storyboard.config.json with format-preserving edits.
      // GET  /_storyboard/config → { config, raw }
      // PUT  /_storyboard/config ← { updates: { "path.to.key": value, ... } }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next()
        let url = req.url
        const baseNoTrail = (server.config.base || '/').replace(/\/$/, '')
        if (baseNoTrail && url.startsWith(baseNoTrail)) {
          url = url.slice(baseNoTrail.length) || '/'
        }
        if (!url.startsWith('/_storyboard/config')) return next()
        // Exact match — avoid catching /_storyboard/config-something
        if (url !== '/_storyboard/config' && !url.startsWith('/_storyboard/config?')) return next()

        let configPath
        try {
          configPath = notebookRuntime
            ? notebookRuntime.resolve('storyboard.config.json')
            : path.resolve(discoveryRoot, 'storyboard.config.json')
        } catch (error) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error.message, code: error.code }))
          return
        }

        if (req.method === 'GET') {
          try {
            const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '{}'
            const { unified: config } = buildUnifiedConfig(discoveryRoot, applicationRoot)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ config, raw }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.method === 'PUT') {
          let body = ''
          for await (const chunk of req) body += chunk
          try {
            const { updates } = JSON.parse(body)
            if (!updates || typeof updates !== 'object') {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing updates object' }))
              return
            }

            const raw = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '{\n}\n'
            const formatting = detectFormatting(raw)
            let next = raw
            for (const [dotPath, value] of Object.entries(updates)) {
              const pathSegments = dotPath.split('.')
              const edits = modify(next, pathSegments, value, { formattingOptions: formatting })
              next = applyEdits(next, edits)
            }
            fs.writeFileSync(configPath, next, 'utf-8')

            if (_onHotPoolConfigChange && Object.keys(updates).some(k => k.startsWith('hotPool.'))) {
              try { _onHotPoolConfigChange() } catch { /* best effort */ }
            }

            const { unified: config } = buildUnifiedConfig(discoveryRoot, applicationRoot)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ config, raw: next }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        next()
      })

      // Watch for data file changes in dev mode
      const watcher = server.watcher
      const knownCanvasIds = new Set(Object.keys(currentIndex().index.canvas || {}))
      const pendingCanvasUnlinks = new Map()

      const parseWatchedFile = (filePath) => {
        // A Notebook switch changes discoveryRoot without restarting Vite.
        // Normalize watcher paths exactly like buildIndex() so an external
        // `canvas/foo.canvas.jsonl` is not re-added as `canvas/foo` alongside
        // its content-only `foo` identity.
        currentIndex()
        const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath)
        const relative = path.relative(discoveryRoot, absolute)
        const outsideDiscoveryRoot = relative === '..'
          || relative.startsWith(`..${path.sep}`)
          || path.isAbsolute(relative)
        if (contentOnly && outsideDiscoveryRoot) return null
        const normalized = relative.replace(/\\/g, '/')
        return parseDataFile(contentOnly ? `src/${normalized}` : normalized)
      }

      const triggerFullReload = () => {
        buildResult = null
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      }

      // Mark the virtual module as stale so the next page load rebuilds it,
      // but do NOT trigger a full-reload (avoids losing canvas editing state).
      const softInvalidate = () => {
        buildResult = null
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
      }

      // Read a canvas file and build HMR metadata for the client-side listener.
      const readCanvasMetadata = (filePath, parsed) => {
        try {
          const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(discoveryRoot, filePath)
          const raw = fs.readFileSync(absPath, 'utf-8')
          const materialized = materializeFromText(raw)
          const result = { ...materialized }
          // Inject _route and _folder the same way generateModule does
          if (parsed.inferredRoute) result._route = parsed.inferredRoute
          const folderDirMatch = path.relative(discoveryRoot, absPath).replace(/\\/g, '/').match(/(?:^|\/)(?:src\/)?(?:prototypes|canvas)\/([^/]+)\.folder\//)
          if (folderDirMatch) result._folder = folderDirMatch[1]
          return result
        } catch {
          return null
        }
      }

      const invalidate = (filePath) => {
        const normalized = filePath.replace(/\\/g, '/')
        // Canvas .jsonl content changes are mutated at runtime by the canvas
        // server API. A full-reload would create a feedback loop (save →
        // file change → reload → lose editing state). Instead, soft-invalidate
        // the virtual module (so page refresh picks up changes) and send a
        // custom HMR event with updated metadata so the canvas page and
        // viewfinder can react in place.
        if (/\.canvas\.jsonl$/.test(normalized)) {
          // If this file change was caused by the canvas server API, it has
          // already pushed an HMR event via pushCanvasUpdate(). Skip the
          // duplicate watcher-triggered event to prevent stale-data rollbacks.
          const absPath = path.resolve(root, filePath)
          if (!isCanvasWriteInFlight(absPath)) {
            const parsed = parseWatchedFile(filePath)
            if (parsed?.suffix === 'canvas' && parsed?.id) {
              const metadata = readCanvasMetadata(filePath, parsed)
              server.ws.send({
                type: 'custom',
                event: 'storyboard:canvas-file-changed',
                data: { canvasId: parsed.id, name: parsed.id, ...(metadata ? { metadata } : {}) },
              })
            }
          }
          softInvalidate()
          return
        }

        // Invalidate when any config file inside a prototype changes
        const protoConfigPattern = /\/(toolbar|commandpalette|widgets|paste|terminal)\.config\.json$/
        if (protoConfigPattern.test(normalized) && normalized.includes('/prototypes/')) {
          buildResult = null
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) {
            server.moduleGraph.invalidateModule(mod)
            server.ws.send({ type: 'full-reload', path: normalized })
          }
          return
        }

        // Invalidate when root toolbar.config.json changes
        if (normalized === path.resolve(root, 'toolbar.config.json').split(path.sep).join('/') ||
            normalized === path.resolve(root, 'toolbar.config.json')) {
          buildResult = null
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) {
            server.moduleGraph.invalidateModule(mod)
            server.ws.send({ type: 'full-reload', path: normalized })
          }
          return
        }

        const parsed = parseWatchedFile(filePath)
        // Also invalidate when files are added/removed inside .folder/ directories
        const inFolder = normalized.includes('.folder/')
        if (!parsed && !inFolder) return
        // Source files inside .folder/ dirs (jsx, css, etc.) are handled by
        // Vite's built-in HMR / React Fast Refresh — don't full-reload for them.
        if (!parsed && inFolder) return

        // Story file content changes are handled by Vite's built-in HMR
        // (React Fast Refresh). Only soft-invalidate the virtual module so
        // the next page load picks up updated metadata — don't full-reload,
        // which would destroy canvas state and cause embedded iframes to
        // reload unnecessarily.
        if (parsed?.suffix === 'story') {
          softInvalidate()
          return
        }

        // Rebuild index and invalidate virtual module
        buildResult = null
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      }

      const invalidateOnAddRemove = (filePath, eventType) => {
        const parsed = parseWatchedFile(filePath)
        const inFolder = filePath.replace(/\\/g, '/').includes('.folder/')
        if (!parsed && !inFolder) return
        // Source files (jsx, css, etc.) inside .folder/ dirs are handled by
        // Vite's built-in HMR — don't trigger a full-reload for them.
        if (!parsed && inFolder) return

        // Canvas writers/editors can emit unlink+add for an in-place save.
        // Treat canvas add/unlink as runtime data updates and never full-reload
        // from watcher events. Canvas pages sync from disk via custom WS events.
        if (parsed?.suffix === 'canvas') {
          const canvasId = parsed.id || parsed.name
          if (eventType === 'unlink') {
            const timer = setTimeout(() => {
              pendingCanvasUnlinks.delete(canvasId)
              knownCanvasIds.delete(canvasId)
              server.ws.send({
                type: 'custom',
                event: 'storyboard:canvas-file-changed',
                data: { canvasId, name: canvasId, removed: true },
              })
              softInvalidate()
            }, 1500)
            pendingCanvasUnlinks.set(canvasId, timer)
            return
          }

          if (eventType === 'add') {
            const metadata = readCanvasMetadata(filePath, parsed)
            const pending = pendingCanvasUnlinks.get(canvasId)
            if (pending) {
              // unlink+add pair = in-place save (atomic write), not a real remove
              clearTimeout(pending)
              pendingCanvasUnlinks.delete(canvasId)
              server.ws.send({
                type: 'custom',
                event: 'storyboard:canvas-file-changed',
                data: { canvasId, name: canvasId, ...(metadata ? { metadata } : {}) },
              })
              softInvalidate()
              return
            }

            if (knownCanvasIds.has(canvasId)) {
              server.ws.send({
                type: 'custom',
                event: 'storyboard:canvas-file-changed',
                data: { canvasId, name: canvasId, ...(metadata ? { metadata } : {}) },
              })
              softInvalidate()
              return
            }

            knownCanvasIds.add(canvasId)
            server.ws.send({
              type: 'custom',
              event: 'storyboard:canvas-file-changed',
              data: { canvasId, name: canvasId, ...(metadata ? { metadata } : {}) },
            })
            softInvalidate()
            return
          }
        }

        // Story add/remove: soft-invalidate + custom HMR event (full-reload
        // is blocked by the canvas reload guard). The virtual module HMR
        // handler live-patches `stories` and re-runs init().
        if (parsed?.suffix === 'story') {
          softInvalidate()
          const current = currentIndex()
          const storyRoutes = current.storyRoutes || {}
          const storyIndex = current.index.story || {}
          const name = parsed.name
          if (eventType === 'unlink') {
            server.ws.send({
              type: 'custom',
              event: 'storyboard:story-file-changed',
              data: { name, removed: true },
            })
          } else if (eventType === 'add' && storyIndex[name]) {
            const relModule = viteModulePath(storyIndex[name], applicationRoot)
            server.ws.send({
              type: 'custom',
              event: 'storyboard:story-file-changed',
              data: {
                name,
                _storyModule: relModule,
                _route: storyRoutes[name] || null,
              },
            })
          }
          return
        }

        // Non-canvas additions/removals and folder changes update the route/data graph.
        triggerFullReload()
      }

      // Watch storyboard.config.json for changes
      const { configPath } = readConfig(discoveryRoot, applicationRoot)
      watcher.add(configPath)

      // Watch all root domain config files for changes
      const domainConfigFiles = [
        'toolbar.config.json',
        'commandpalette.config.json',
        'paste.config.json',
        'widgets.config.json',
        'terminal.config.json',
      ].map(f => path.resolve(discoveryRoot, f))
      const watchedConfigPaths = new Set([configPath, ...domainConfigFiles])
      for (const p of domainConfigFiles) watcher.add(p)

      const invalidateConfig = (filePath) => {
        const resolved = path.resolve(filePath)
        if (watchedConfigPaths.has(resolved)) {
          buildResult = null
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) {
            server.moduleGraph.invalidateModule(mod)
            server.ws.send({ type: 'full-reload', path: resolved })
          }
          // Re-write themes.generated.css against the new themes/surfaces
          // and invalidate any Vite modules that imported it so Tailwind
          // re-runs with the updated `@custom-variant dark` selector list.
          const themesPath = writeThemesCssFile(discoveryRoot, applicationRoot)
          if (themesPath) {
            const mods = server.moduleGraph.getModulesByFile(themesPath)
            if (mods) {
              for (const m of mods) server.moduleGraph.invalidateModule(m)
            }
          }
        }
      }

      watcher.on('add', (filePath) => invalidateOnAddRemove(filePath, 'add'))
      watcher.on('unlink', (filePath) => invalidateOnAddRemove(filePath, 'unlink'))
      watcher.on('change', (filePath) => {
        invalidate(filePath)
        invalidateConfig(filePath)
      })

      // Cross-plugin hook: lets the artifact route force a synchronous index
      // rebuild + HMR notify after writing a new file, so the client doesn't
      // race chokidar (which can lag 50-300ms behind a writeFile call) and
      // hit a 404 on the just-created canvas/story/page.
      globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__ = (filePath, eventType = 'add') => {
        try {
          if (filePath) invalidateOnAddRemove(filePath, eventType)
          else softInvalidate()
        } catch { /* best-effort */ }
      }
    },

    // Guard against known invalid named imports from @primer/react.
    // The most common offender is `Octicon`, which lives in
    // `@primer/octicons-react`, not `@primer/react`. When a consumer
    // imports it from `@primer/react`, Vite happily pre-bundles the
    // dep and only fails at runtime with a cryptic
    // "does not provide an export named 'Octicon'" error from inside
    // `node_modules/.vite/deps/@primer_react.js`. Catch it here at
    // transform time with a clear, actionable error pointing to the
    // correct package.
    transform(code, id) {
      if (!/\.(jsx?|tsx?|mjs|cjs)(\?|$)/.test(id)) return null
      if (id.includes('/node_modules/')) return null
      if (!code.includes('@primer/react')) return null
      const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@primer\/react['"]/g
      let match
      while ((match = re.exec(code)) !== null) {
        const names = match[1]
          .split(',')
          .map(s => s.replace(/\s+as\s+\w+/, '').trim())
          .filter(Boolean)
        if (names.includes('Octicon')) {
          const before = code.slice(0, match.index)
          const line = before.split('\n').length
          const rel = id.replace(root + '/', '')
          throw new Error(
            `[storyboard] Invalid import in ${rel}:${line} — \`Octicon\` is not exported by \`@primer/react\`.\n` +
            `  Import the icon you need directly from \`@primer/octicons-react\` instead, e.g.:\n` +
            `    import { GearIcon } from '@primer/octicons-react'\n` +
            `  See AGENTS.md: "Use Primer Octicons from @primer/octicons-react for icons".`
          )
        }
      }
      return null
    },

    handleHotUpdate(ctx) {
      const normalized = ctx.file.replace(/\\/g, '/')
      if (/\.canvas\.jsonl$/.test(normalized)) {
        // Canvas JSONL: the watcher 'change' handler soft-invalidates and
        // emits a custom HMR event. Drop Vite's default full-reload.
        return []
      }

      // Prototype / component / template edits: defer to Fast Refresh.
      // Returning ctx.modules unchanged keeps Vite's normal HMR pipeline —
      // module-level updates flow, no full-reload fallback. If Fast Refresh
      // can't apply (mixed-export file etc.), the prototype-reload-guard
      // will still drop the resulting full-reload broadcast; the user can
      // hit reload manually for those edge cases.
      if (/\/src\/(prototypes|components|templates)\//.test(normalized)
          && /\.(jsx?|tsx?|mdx)$/.test(normalized)) {
        return ctx.modules
      }

      return undefined
    },

    // Inject __SB_BRANCHES__ + __SB_CURRENT_BRANCH__ into HTML so the
    // Viewfinder/BranchBar can reflect the live git state. With the
    // proxy/daemon removed, the URL no longer carries a /branch--<name>/
    // segment to parse, so we read `git branch --show-current` server-side.
    transformIndexHtml(html, ctx) {
      // Only inject in dev mode
      if (!ctx.server) return html

      let currentBranch = null
      try {
        currentBranch = execSync('git branch --show-current', { cwd: root, encoding: 'utf8' }).trim() || null
      } catch { /* not a git repo */ }

      const scripts = []
      if (currentBranch) {
        scripts.push(`<script>window.__SB_CURRENT_BRANCH__ = ${JSON.stringify(currentBranch)};</script>`)
      }

      try {
        const servers = listRunningServers()
        const runningByName = new Map(servers.map(s => [s.worktree, s]))
        const onDisk = listWorktrees()
        const allNames = new Set([...onDisk, ...runningByName.keys()])
        if (allNames.size > 0) {
          const branches = []
          for (const name of allNames) {
            if (name === 'main') continue
            const srv = runningByName.get(name)
            branches.push({
              branch: name,
              folder: `branch--${name}`,
              running: !!srv,
              port: srv?.port ?? null,
              url: srv ? `http://localhost:${srv.port}/storyboard/` : null,
            })
          }
          if (branches.length > 0) {
            scripts.push(`<script>window.__SB_BRANCHES__ = ${JSON.stringify(branches)};</script>`)
          }
        }
      } catch { /* fall through */ }

      if (scripts.length === 0) return html
      return html.replace('</head>', `${scripts.join('\n')}\n</head>`)
    },

    // Rebuild index on each build start
    buildStart() {
      buildResult = null
    },

    closeBundle() {
      if (!isBuild) return
      if (!outDir || !fs.existsSync(outDir)) return

      const discovery = buildDiscoveryResult(currentIndex(), discoveryRoot, applicationRoot)
      const env = resolveManifestEnv({ env: process.env, cwd: root })
      const manifest = buildArtifactManifest({ discovery, env })
      const outPath = path.resolve(outDir, 'artifacts.json')
      fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`)
    },

    // Emit terminal snapshots into the build so TerminalReadWidget can
    // fetch them as static files in production (no dev-server API).
    generateBundle() {
      // 1. Consolidated snapshot indexes (agents.snapshot.json + agents-txt.snapshot.json)
      const publicDir = path.resolve(discoveryRoot, 'assets/.storyboard-public/terminal-snapshots')
      const emittedIds = new Set()
      if (fs.existsSync(publicDir)) {
        for (const file of fs.readdirSync(publicDir)) {
          if (file !== 'agents.snapshot.json' && file !== 'agents-txt.snapshot.json') continue
          const full = path.join(publicDir, file)
          const source = fs.readFileSync(full, 'utf-8')
          this.emitFile({
            type: 'asset',
            fileName: `_storyboard/terminal-snapshots/${file}`,
            source,
          })
          if (file === 'agents.snapshot.json') {
            try {
              const parsed = JSON.parse(source)
              for (const id of Object.keys(parsed?.agents || {})) emittedIds.add(id)
            } catch { /* empty */ }
          }
        }
      }

      // 2. Legacy snapshots (nested by canvas dir) — skip if already in index
      const legacyDir = path.resolve(discoveryRoot, '.storyboard/terminal-snapshots')
      if (fs.existsSync(legacyDir)) {
        const walk = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              walk(full)
            } else if (entry.name.endsWith('.json') && !entry.name.startsWith('~')) {
              const widgetId = entry.name.replace(/\.json$/, '')
              if (emittedIds.has(widgetId)) continue
              const rel = path.relative(legacyDir, full).replace(/\\/g, '/')
              this.emitFile({
                type: 'asset',
                fileName: `_storyboard/terminal-snapshots/${rel}`,
                source: fs.readFileSync(full, 'utf-8'),
              })
            }
          }
        }
        walk(legacyDir)
      }
    },
  }
}

/**
 * Vite plugin that copies terminal snapshots into the build output
 * so TerminalReadWidget can fetch them as static files in production.
 *
 * Sources (in priority order):
 *   1. assets/.storyboard-public/terminal-snapshots/agents.snapshot.json (consolidated index — all agents)
 *   2. assets/.storyboard-public/terminal-snapshots/agents-txt.snapshot.json (text payloads, keyed by widgetId)
 *   3. .storyboard/terminal-snapshots/<canvasDir>/<widgetId>.json (legacy, nested)
 *
 * All are emitted to `_storyboard/terminal-snapshots/` in the build.
 */
export function terminalSnapshotPlugin() {
  return {
    name: 'storyboard-terminal-snapshots',

    generateBundle() {
      const publicDir = path.resolve('assets/.storyboard-public/terminal-snapshots')
      const emittedIds = new Set()
      if (fs.existsSync(publicDir)) {
        for (const file of fs.readdirSync(publicDir)) {
          if (file !== 'agents.snapshot.json' && file !== 'agents-txt.snapshot.json') continue
          const full = path.join(publicDir, file)
          const source = fs.readFileSync(full, 'utf-8')
          this.emitFile({
            type: 'asset',
            fileName: `_storyboard/terminal-snapshots/${file}`,
            source,
          })
          if (file === 'agents.snapshot.json') {
            try {
              const parsed = JSON.parse(source)
              for (const id of Object.keys(parsed?.agents || {})) emittedIds.add(id)
            } catch { /* empty */ }
          }
        }
      }

      const legacyDir = path.resolve('.storyboard/terminal-snapshots')
      if (fs.existsSync(legacyDir)) {
        const walk = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              walk(full)
            } else if (entry.name.endsWith('.json') && !entry.name.startsWith('~')) {
              const widgetId = entry.name.replace(/\.json$/, '')
              if (emittedIds.has(widgetId)) continue
              const rel = path.relative(legacyDir, full).replace(/\\/g, '/')
              this.emitFile({
                type: 'asset',
                fileName: `_storyboard/terminal-snapshots/${rel}`,
                source: fs.readFileSync(full, 'utf-8'),
              })
            }
          }
        }
        walk(legacyDir)
      }
    },
  }
}

// Exported for testing
export { resolveTemplateVars, computeTemplateVars, parseDataFile, buildDiscoveryResult }
