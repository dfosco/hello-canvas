/**
 * Artifact disk operations — create, edit, delete artifacts on the filesystem.
 *
 * Each operation validates first, then performs the FS mutation.
 */

import fs from 'node:fs'
import path from 'node:path'
import { validateArtifact, resolvePrototypeDir, toPascalCase } from './validate.js'
import { buildTemplateRecipeIndex, resolveTemplateRecipeEntry } from '../workshop/features/templateIndex.js'
import { renderPartialIndexJsx, findComponentFile, readWorkshopPartials } from '../workshop/features/partialRender.js'
import { SiteStore, SITE_CONFIG_FILE, updateSiteDescriptor } from '../site/site.js'

function contentDir(root, name) {
  return fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))
    ? path.join(root, name)
    : path.join(root, 'src', name)
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function prototypeJson(values) {
  const meta = {}
  if (values.title) meta.title = values.title
  if (values.description) meta.description = values.description
  if (values.author) meta.author = values.author
  if (values.icon) meta.icon = values.icon
  if (values.tags) meta.tags = values.tags
  if (values.team) meta.team = values.team
  const obj = { meta }
  if (values.url) obj.url = values.url
  return JSON.stringify(obj, null, 2) + '\n'
}

function prototypeIndexJsx(name) {
  const pascal = toPascalCase(name)
  return `export default function ${pascal}() {
  return (
    <div>
      <h1>${pascal}</h1>
    </div>
  )
}
`
}

function flowJson(globals = []) {
  return JSON.stringify({ $global: globals }, null, 2) + '\n'
}

function canvasJsonl(settings = {}) {
  const { grid, gridSize, colorMode, title, description, author, ...rest } = settings
  const event = {
    event: 'canvas_created',
    timestamp: new Date().toISOString(),
    title: title || '',
    grid: grid !== false,
    gridSize: gridSize ?? 24,
    colorMode: colorMode ?? 'auto',
    widgets: [],
    ...rest,
  }
  if (description) event.description = description
  if (author) event.author = author
  return JSON.stringify(event) + '\n'
}

function canvasJsx(name) {
  const pascal = toPascalCase(name)
  return `export default function ${pascal}Canvas() {
  return null
}
`
}

function componentJsx(pascal) {
  return `import styles from './${pascal}.module.css'

export default function ${pascal}({ children }) {
  return (
    <div className={styles.root}>
      {children}
    </div>
  )
}
`
}

function componentCss() {
  return `.root {
}
`
}

function componentStory(pascal, kebab) {
  return `import ${pascal} from './${pascal}.jsx'

export const name = '${kebab}'

export function Default() {
  return <${pascal}>Hello</${pascal}>
}
`
}

function pageJsx(pageName) {
  const pascal = toPascalCase(pageName.split('/').pop() || 'Page')
  return `export default function ${pascal}Page() {
  return (
    <div>
      <h1>${pascal}</h1>
    </div>
  )
}
`
}

function objectJson(body = {}) {
  return JSON.stringify(body, null, 2) + '\n'
}

function recordJson(entries = []) {
  return JSON.stringify(entries, null, 2) + '\n'
}

function createSite(values, root) {
  const store = new SiteStore(root)
  if (store.get(values.name)) return { success: false, errors: [{ field: 'name', message: `Site "${values.name}" already exists` }] }
  const site = store.upsert(updateSiteDescriptor({ id: values.name, title: values.title || values.name }, {
    title: values.title || values.name,
    description: values.description,
    productionBaseUrl: values.productionBaseUrl,
  }))
  const bindingUpdates = {
    ...(values.developmentBaseUrl ? { source: 'url', developmentBaseUrl: values.developmentBaseUrl } : {}),
    ...(values.startCommand ? { startCommand: values.startCommand } : {}),
  }
  const binding = Object.keys(bindingUpdates).length ? store.upsertBinding(site.id, bindingUpdates) : null
  return { success: true, created: values.name, site: { ...site, ...(binding ? { binding } : {}) }, files: [SITE_CONFIG_FILE] }
}

function resolveCanvasFile(root, name, folder) {
  const canvasDir = contentDir(root, 'canvas')
  const fileName = `${name}.canvas.jsonl`
  const candidates = folder
    ? [path.join(canvasDir, folder, fileName), path.join(canvasDir, `${folder}.folder`, fileName)]
    : [path.join(canvasDir, fileName)]
  return candidates.find(filePath => fs.existsSync(filePath)) ?? null
}

function canvasFiles(root, filePath) {
  const files = [path.relative(root, filePath)]
  const jsxPath = filePath.replace('.canvas.jsonl', '.canvas.jsx')
  if (fs.existsSync(jsxPath)) files.push(path.relative(root, jsxPath))
  return files
}

// ---------------------------------------------------------------------------
// Create operations
// ---------------------------------------------------------------------------

function createPrototype(values, root) {
  const prototypesDir = contentDir(root, 'prototypes')
  const targetDir = values.folder
    ? path.join(prototypesDir, `${values.folder}.folder`, values.name)
    : path.join(prototypesDir, values.name)

  const files = []
  const relDir = path.relative(root, targetDir)

  // Resolve partial (template/recipe) — if set, we'll write a templated
  // index.jsx and inject any $global objects into prototype.json.
  let partialEntry = null
  let partialError = null
  if (values.partial && !values.url) {
    const partials = buildTemplateRecipeIndex(root, readWorkshopPartials(root))
    partialEntry = resolveTemplateRecipeEntry(partials, values.partial)
    if (!partialEntry) {
      partialError = `Unknown template/recipe "${values.partial}"`
    }
  }
  if (partialError) {
    return { success: false, errors: [{ message: partialError }] }
  }

  // Pre-resolve the partial's component file *before* writing anything.
  // If the partial's template/recipe directory is missing or empty we'd
  // otherwise leave an orphan .prototype.json on disk and Vite would
  // then try (and fail) to lazy-load a non-existent index.jsx. Validate
  // first, write second.
  let componentFile = null
  if (partialEntry && !values.url) {
    const partialDir = contentDir(root, path.join(partialEntry.baseDir, partialEntry.name))
    componentFile = findComponentFile(partialDir)
    if (!componentFile) {
      return { success: false, errors: [{ message: `No .jsx or .tsx file found in src/${partialEntry.baseDir}/${partialEntry.name}/` }] }
    }
  }

  fs.mkdirSync(targetDir, { recursive: true })

  // Write .prototype.json (with $global from partial when applicable)
  const protoFile = `${values.name}.prototype.json`
  const protoBody = JSON.parse(prototypeJson(values))
  if (partialEntry?.globals?.length) {
    protoBody.$global = partialEntry.globals
  }
  fs.writeFileSync(path.join(targetDir, protoFile), JSON.stringify(protoBody, null, 2) + '\n', 'utf-8')
  files.push(`${relDir}/${protoFile}`)

  // Write index.jsx (only for non-external prototypes)
  if (!values.url) {
    const body = partialEntry
      ? renderPartialIndexJsx({
        partialEntry,
        componentFile,
        componentName: toPascalCase(values.name),
        title: values.title || values.name,
      })
      : prototypeIndexJsx(values.name)
    fs.writeFileSync(path.join(targetDir, 'index.jsx'), body, 'utf-8')
    files.push(`${relDir}/index.jsx`)
  }

  // Optionally create flow
  if (values.flow && !values.url) {
    const flowFile = `${values.name}.flow.json`
    fs.writeFileSync(path.join(targetDir, flowFile), flowJson(), 'utf-8')
    files.push(`${relDir}/${flowFile}`)
  }

  return { success: true, type: 'prototype', name: values.name, path: relDir, route: `/${values.name}`, files }
}

function createCanvas(values, root) {
  const canvasDir = contentDir(root, 'canvas')

  // Folder resolution mirrors the canvas-server /create endpoint:
  //   - if folder is empty → write at root
  //   - if <folder>.folder/ exists → use it (workspace grouping)
  //   - if <folder>/ exists       → use it (multi-page grouping)
  //   - otherwise create a new dir per `folderKind`
  //     ("workspace" → .folder/, default "pages" → plain dir)
  let targetDir = canvasDir
  let usedFolderKind = null
  if (values.folder) {
    const dotFolderDir = path.join(canvasDir, `${values.folder}.folder`)
    const plainDir = path.join(canvasDir, values.folder)
    if (fs.existsSync(dotFolderDir)) {
      targetDir = dotFolderDir
      usedFolderKind = 'workspace'
    } else if (fs.existsSync(plainDir) && fs.statSync(plainDir).isDirectory()) {
      targetDir = plainDir
      usedFolderKind = 'pages'
    } else {
      const useWorkspace = values.folderKind === 'workspace'
      targetDir = useWorkspace ? dotFolderDir : plainDir
      usedFolderKind = useWorkspace ? 'workspace' : 'pages'
    }
  }
  fs.mkdirSync(targetDir, { recursive: true })

  const files = []
  const fileName = `${values.name}.canvas.jsonl`
  const filePath = path.join(targetDir, fileName)
  const relPath = path.relative(root, filePath)

  fs.writeFileSync(filePath, canvasJsonl({
    grid: values.grid,
    title: values.title || values.name,
    description: values.description,
  }), 'utf-8')
  files.push(relPath)

  if (values.jsx) {
    const jsxFile = `${values.name}.canvas.jsx`
    fs.writeFileSync(path.join(targetDir, jsxFile), canvasJsx(values.name), 'utf-8')
    files.push(path.relative(root, path.join(targetDir, jsxFile)))
  }

  // Route always strips `.folder/` (per the data plugin), so both kinds
  // produce the same `/canvas/<folder>/<name>` URL shape.
  const canvasRoute = `/canvas/${values.folder ? `${values.folder}/` : ''}${values.name}`
  return {
    success: true,
    type: 'canvas',
    name: values.name,
    path: path.relative(root, targetDir),
    route: canvasRoute,
    folderKind: usedFolderKind,
    files,
  }
}

function createComponent(values, root) {
  const componentsDir = contentDir(root, 'components')
  const pascal = toPascalCase(values.name)
  const targetDir = values.directory
    ? path.join(componentsDir, values.directory, pascal)
    : path.join(componentsDir, pascal)

  fs.mkdirSync(targetDir, { recursive: true })

  const files = []
  const relDir = path.relative(root, targetDir)

  fs.writeFileSync(path.join(targetDir, `${pascal}.jsx`), componentJsx(pascal), 'utf-8')
  files.push(`${relDir}/${pascal}.jsx`)

  fs.writeFileSync(path.join(targetDir, `${pascal}.module.css`), componentCss(), 'utf-8')
  files.push(`${relDir}/${pascal}.module.css`)

  fs.writeFileSync(path.join(targetDir, `${values.name}.story.jsx`), componentStory(pascal, values.name), 'utf-8')
  files.push(`${relDir}/${values.name}.story.jsx`)

  return { success: true, type: 'component', name: values.name, path: relDir, files }
}

function createFlow(values, root) {
  const prototypesDir = contentDir(root, 'prototypes')
  const protoDir = resolvePrototypeDir(prototypesDir, values.prototype, values.folder)
  if (!protoDir) {
    return { success: false, error: `Prototype "${values.prototype}" not found` }
  }

  const flowFile = `${values.name}.flow.json`
  const flowPath = path.join(protoDir, flowFile)
  const relPath = path.relative(root, flowPath)

  let content
  if (values['copy-from']) {
    const sourceFlow = path.join(protoDir, `${values['copy-from']}.flow.json`)
    if (fs.existsSync(sourceFlow)) {
      content = fs.readFileSync(sourceFlow, 'utf-8')
    } else {
      content = flowJson(values.globals || [])
    }
  } else {
    content = flowJson(values.globals || [])
  }

  fs.writeFileSync(flowPath, content, 'utf-8')
  return { success: true, type: 'flow', name: values.name, path: relPath, route: `/${values.prototype}?flow=${encodeURIComponent(values.name)}`, files: [relPath] }
}

function createObject(values, root) {
  let targetDir
  if (values.prototype) {
    const prototypesDir = contentDir(root, 'prototypes')
    const protoDir = resolvePrototypeDir(prototypesDir, values.prototype, values.folder)
    if (!protoDir) return { success: false, error: `Prototype "${values.prototype}" not found` }
    targetDir = protoDir
  } else {
    targetDir = contentDir(root, 'data')
  }
  fs.mkdirSync(targetDir, { recursive: true })

  const fileName = `${values.name}.object.json`
  const filePath = path.join(targetDir, fileName)
  const relPath = path.relative(root, filePath)

  fs.writeFileSync(filePath, objectJson(values.body || {}), 'utf-8')
  return { success: true, type: 'object', name: values.name, path: relPath, files: [relPath] }
}

function createRecord(values, root) {
  let targetDir
  if (values.prototype) {
    const prototypesDir = contentDir(root, 'prototypes')
    const protoDir = resolvePrototypeDir(prototypesDir, values.prototype, values.folder)
    if (!protoDir) return { success: false, error: `Prototype "${values.prototype}" not found` }
    targetDir = protoDir
  } else {
    targetDir = contentDir(root, 'data')
  }
  fs.mkdirSync(targetDir, { recursive: true })

  const fileName = `${values.name}.record.json`
  const filePath = path.join(targetDir, fileName)
  const relPath = path.relative(root, filePath)

  fs.writeFileSync(filePath, recordJson(values.entries || []), 'utf-8')
  return { success: true, type: 'record', name: values.name, path: relPath, files: [relPath] }
}

function createPage(values, root) {
  const prototypesDir = contentDir(root, 'prototypes')
  const protoDir = resolvePrototypeDir(prototypesDir, values.prototype, values.folder)
  if (!protoDir) {
    return { success: false, error: `Prototype "${values.prototype}" not found` }
  }

  const pagesDir = path.join(protoDir, 'pages')
  const pagePath = path.join(pagesDir, `${values.path}.jsx`)
  const pageDir = path.dirname(pagePath)
  fs.mkdirSync(pageDir, { recursive: true })

  const relPath = path.relative(root, pagePath)
  fs.writeFileSync(pagePath, pageJsx(values.path), 'utf-8')

  return { success: true, type: 'page', name: values.path, path: relPath, route: `/${values.prototype}/${values.path}`, files: [relPath] }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const creators = {
  prototype: createPrototype,
  canvas: createCanvas,
  component: createComponent,
  flow: createFlow,
  object: createObject,
  record: createRecord,
  page: createPage,
  site: createSite,
}

/**
 * Create an artifact. Validates first, then performs FS operations.
 */
export function createArtifact(type, values, root) {
  const validation = validateArtifact(type, values, root)
  if (!validation.valid) {
    return { success: false, errors: validation.errors }
  }

  const creator = creators[type]
  if (!creator) {
    return { success: false, errors: [{ field: '_type', message: `No creator for type: ${type}` }] }
  }

  try {
    return creator(validation.normalized, root)
  } catch (err) {
    return { success: false, errors: [{ field: '_fs', message: err.message }] }
  }
}

/**
 * Edit artifact metadata.
 */
export function editArtifact(type, name, updates, root) {
  if (type === 'site') {
    const store = new SiteStore(root)
    const current = store.get(name)
    if (!current) return { success: false, error: `Site "${name}" not found` }
    const updated = store.upsert(updateSiteDescriptor(current, updates))
    const bindingUpdates = {
      ...(updates.startCommand !== undefined ? { startCommand: updates.startCommand } : {}),
      ...(updates.developmentBaseUrl !== undefined ? { developmentBaseUrl: updates.developmentBaseUrl } : {}),
    }
    const binding = Object.keys(bindingUpdates).length ? store.upsertBinding(current.id, bindingUpdates) : store.getBinding(current.id)
    return { success: true, updated: { ...updated, ...(binding ? { binding } : {}) }, files: [SITE_CONFIG_FILE] }
  }
  if (type === 'prototype') {
    const prototypesDir = contentDir(root, 'prototypes')
    const protoDir = resolvePrototypeDir(prototypesDir, name, updates.folder)
    if (!protoDir) {
      return { success: false, error: `Prototype "${name}" not found` }
    }

    const files = fs.readdirSync(protoDir)
    const protoJsonFile = files.find(f => f.endsWith('.prototype.json'))
    if (!protoJsonFile) {
      return { success: false, error: `No .prototype.json file found in "${name}"` }
    }

    const protoJsonPath = path.join(protoDir, protoJsonFile)
    const json = JSON.parse(fs.readFileSync(protoJsonPath, 'utf-8'))
    if (!json.meta) json.meta = {}

    if (updates.title !== undefined) json.meta.title = updates.title
    if (updates.description !== undefined) json.meta.description = updates.description
    if (updates.author !== undefined) {
      json.meta.author = typeof updates.author === 'string'
        ? updates.author.split(',').map(a => a.trim()).filter(Boolean)
        : updates.author
    }
    if (updates.icon !== undefined) json.meta.icon = updates.icon
    if (updates.tags !== undefined) json.meta.tags = updates.tags
    if (updates.team !== undefined) json.meta.team = updates.team
    if (updates.url !== undefined) json.url = updates.url

    fs.writeFileSync(protoJsonPath, JSON.stringify(json, null, 2) + '\n', 'utf-8')
    return { success: true, updated: name, files: [path.relative(root, protoJsonPath)] }
  }

  if (type === 'canvas') {
    const filePath = resolveCanvasFile(root, name, updates.folder)
    if (!filePath) return { success: false, error: `Canvas "${name}" not found` }

    const dir = path.dirname(filePath)
    const metaPath = path.join(dir, `${path.basename(dir).replace(/\.folder$/, '')}.meta.json`)
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      for (const key of ['title', 'description', 'author']) {
        if (updates[key] !== undefined) meta[key] = updates[key]
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
      return { success: true, updated: name, files: [path.relative(root, metaPath)] }
    }
    const text = fs.readFileSync(filePath, 'utf-8')
    const lines = text.split('\n').filter(Boolean)
    if (lines.length === 0) return { success: false, error: `Canvas "${name}" is empty` }
    const firstEvent = JSON.parse(lines[0])
    for (const key of ['title', 'description', 'author']) {
      if (updates[key] !== undefined) firstEvent[key] = updates[key]
    }
    lines[0] = JSON.stringify(firstEvent)
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
    return { success: true, updated: name, files: [path.relative(root, filePath)] }
  }

  return { success: false, error: `Edit not yet supported for type: ${type}` }
}

/**
 * Delete an artifact.
 */
export function deleteArtifact(type, name, options, root) {
  const { folder } = options || {}

  if (type === 'site') {
    const file = SITE_CONFIG_FILE
    return new SiteStore(root).remove(name) ? { success: true, deleted: name, files: [file] } : { success: false, error: `Site "${name}" not found` }
  }

  if (type === 'prototype') {
    const prototypesDir = contentDir(root, 'prototypes')
    const protoDir = resolvePrototypeDir(prototypesDir, name, folder)
    if (!protoDir) {
      return { success: false, error: `Prototype "${name}" not found` }
    }
    const resolved = path.resolve(protoDir)
    if (!resolved.startsWith(path.resolve(prototypesDir))) {
      return { success: false, error: 'Invalid path — outside prototypes directory' }
    }
    const files = fs.readdirSync(protoDir, { recursive: true }).map(file => path.relative(root, path.join(protoDir, file)))
    fs.rmSync(protoDir, { recursive: true, force: true })
    return { success: true, deleted: name, files }
  }

  if (type === 'canvas') {
    const filePath = resolveCanvasFile(root, name, folder)
    if (!filePath) {
      return { success: false, error: `Canvas "${name}" not found` }
    }
    const files = canvasFiles(root, filePath)
    fs.unlinkSync(filePath)
    // Also remove .jsx companion if it exists
    const jsxPath = filePath.replace('.canvas.jsonl', '.canvas.jsx')
    if (fs.existsSync(jsxPath)) fs.unlinkSync(jsxPath)
    return { success: true, deleted: name, files }
  }

  if (type === 'component') {
    const componentsDir = contentDir(root, 'components')
    const pascal = toPascalCase(name)
    const targetDir = options?.directory
      ? path.join(componentsDir, options.directory, pascal)
      : path.join(componentsDir, pascal)
    if (!fs.existsSync(targetDir)) {
      return { success: false, error: `Component "${name}" not found` }
    }
    fs.rmSync(targetDir, { recursive: true, force: true })
    return { success: true, deleted: name }
  }

  if (type === 'flow') {
    const prototypesDir = contentDir(root, 'prototypes')
    const protoDir = resolvePrototypeDir(prototypesDir, options?.prototype, folder)
    if (!protoDir) {
      return { success: false, error: `Prototype "${options?.prototype}" not found` }
    }
    const flowPath = path.join(protoDir, `${name}.flow.json`)
    if (!fs.existsSync(flowPath)) {
      return { success: false, error: `Flow "${name}" not found` }
    }
    fs.unlinkSync(flowPath)
    return { success: true, deleted: name }
  }

  if (type === 'object') {
    const filePath = path.join(contentDir(root, 'data'), `${name}.object.json`)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Object "${name}" not found` }
    }
    fs.unlinkSync(filePath)
    return { success: true, deleted: name }
  }

  if (type === 'record') {
    const filePath = path.join(contentDir(root, 'data'), `${name}.record.json`)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Record "${name}" not found` }
    }
    fs.unlinkSync(filePath)
    return { success: true, deleted: name }
  }

  return { success: false, error: `Delete not supported for type: ${type}` }
}

/**
 * List artifacts of a given type.
 */
export function listArtifacts(type, options, root) {
  const { folder } = options || {}

  if (type === 'site') return { type, items: new SiteStore(root).list() }

  if (type === 'prototype') {
    const prototypesDir = contentDir(root, 'prototypes')
    if (!fs.existsSync(prototypesDir)) return { type, items: [] }
    return { type, items: scanPrototypes(prototypesDir, folder) }
  }

  if (type === 'canvas') {
    const canvasDir = contentDir(root, 'canvas')
    if (!fs.existsSync(canvasDir)) return { type, items: [] }
    return { type, items: scanCanvases(canvasDir, folder, root) }
  }

  if (type === 'component') {
    const componentsDir = contentDir(root, 'components')
    if (!fs.existsSync(componentsDir)) return { type, items: [] }
    return { type, items: scanComponents(componentsDir, root) }
  }

  return { type, items: [] }
}

function scanPrototypes(prototypesDir, filterFolder) {
  const items = []
  const entries = fs.readdirSync(prototypesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    if (entry.name.endsWith('.folder')) {
      const folderName = entry.name.replace('.folder', '')
      if (filterFolder && filterFolder !== folderName) continue
      const folderPath = path.join(prototypesDir, entry.name)
      const subs = fs.readdirSync(folderPath, { withFileTypes: true })
      for (const sub of subs) {
        if (!sub.isDirectory()) continue
        items.push({ name: sub.name, folder: folderName, path: `src/prototypes/${entry.name}/${sub.name}` })
      }
    } else if (!filterFolder) {
      items.push({ name: entry.name, folder: null, path: `src/prototypes/${entry.name}` })
    }
  }

  return items
}

function scanCanvases(canvasDir, filterFolder, root) {
  const items = []
  const scanDir = (dir, folder) => {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), entry.name)
      } else if (entry.name.endsWith('.canvas.jsonl')) {
        const name = entry.name.replace('.canvas.jsonl', '')
        if (!filterFolder || folder === filterFolder) {
          items.push({ name, folder: folder || null, path: path.relative(root, path.join(dir, entry.name)) })
        }
      }
    }
  }
  scanDir(canvasDir, null)
  return items
}

function scanComponents(componentsDir, root) {
  const items = []
  const entries = fs.readdirSync(componentsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    items.push({ name: entry.name, path: path.relative(root, path.join(componentsDir, entry.name)) })
  }
  return items
}
