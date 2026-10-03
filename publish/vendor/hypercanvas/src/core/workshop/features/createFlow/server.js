/**
 * Workshop API — flow creation and listing.
 *
 * Routes (mounted at /_storyboard/workshop/):
 *   GET  /flows  — list prototypes, existing flows, and available objects
 *   POST /flows  — create a new flow file
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import {
  buildTemplateRecipeIndex,
  resolveTemplateRecipeEntry,
} from '../templateIndex.js'
import { readWorkshopPartials } from '../partialRender.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toKebabCase(str) {
  return str
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function validateFlowName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Flow name is required' }
  }

  const kebab = toKebabCase(name.trim())

  if (!kebab) {
    return { valid: false, error: 'Name must contain at least one alphanumeric character' }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kebab)) {
    return { valid: false, error: 'Name must be kebab-case (lowercase letters, numbers, and hyphens)' }
  }

  return { valid: true, kebab }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'packages'])
const PAGE_EXT_RE = /\.(jsx|tsx|js|ts)$/

function toPascalCase(input) {
  return input
    .replace(/\[|\]/g, '')
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function humanize(kebab) {
  if (!kebab) return 'Page'
  return kebab
    .replace(/\[|\]/g, '')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

function normalizePathSlashes(value) {
  return value.replaceAll('\\', '/')
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function parsePrototypeFromFlowPath(relPath) {
  const normalized = normalizePathSlashes(relPath)
  if (!normalized.startsWith('src/prototypes/')) return null

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 4) return null

  if (parts[2].endsWith('.folder') && parts.length >= 5) {
    return {
      folder: parts[2].replace(/\.folder$/, ''),
      prototype: parts[3],
    }
  }

  return {
    folder: undefined,
    prototype: parts[2],
  }
}

function isExternalPrototype(prototypePath) {
  try {
    const raw = fs.readFileSync(prototypePath, 'utf-8')
    const parsed = parseJsonc(raw)
    return typeof parsed?.url === 'string' && parsed.url.trim().length > 0
  } catch {
    return false
  }
}

function findPrototypeDir(root, protoName, folderName) {
  const prototypesDir = path.join(root, 'src', 'prototypes')
  if (!fs.existsSync(prototypesDir)) {
    return { error: 'No prototypes directory found' }
  }

  const matches = []

  function scanDir(dir, folder) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.endsWith('.folder')) {
        scanDir(path.join(dir, entry.name), entry.name.replace(/\.folder$/, ''))
        continue
      }

      if (entry.name !== protoName) continue
      if (folderName && folder !== folderName) continue

      const protoDir = path.join(dir, entry.name)
      const prototypeFile = fs.readdirSync(protoDir).find((f) => f.endsWith('.prototype.json'))
      if (!prototypeFile) continue
      if (isExternalPrototype(path.join(protoDir, prototypeFile))) continue

      matches.push({ dir: protoDir, folder })
    }
  }

  scanDir(prototypesDir)

  if (matches.length === 0) {
    return { error: `Prototype "${protoName}" not found` }
  }

  if (!folderName && matches.length > 1) {
    return { error: `Prototype "${protoName}" is ambiguous; include its folder` }
  }

  return { dir: matches[0].dir, folder: matches[0].folder }
}

function normalizeRouteForPrototype(protoName, route) {
  if (typeof route !== 'string') return null
  const trimmed = route.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/')) return trimmed
  return `/${protoName}/${trimmed.replace(/^\/+/, '')}`
}

function isRouteInPrototype(protoName, route) {
  return route === `/${protoName}` || route.startsWith(`/${protoName}/`)
}

function findComponentFile(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
  const component = files.find((f) => /\.(jsx|tsx)$/.test(f) && !f.startsWith('_') && !f.includes('.test.'))
  return component ? component.replace(/\.(jsx|tsx)$/, '') : null
}

function generateBlankPageJsx(componentName, title) {
  return `export default function ${componentName}() {
  return (
    <div>
      <h1>${title}</h1>
      <p>Start building your page here.</p>
    </div>
  )
}
`
}

function generateTemplatePageJsx({ partialEntry, componentFile, componentName, title }) {
  const importPath = `@/${partialEntry.baseDir}/${partialEntry.name}/${componentFile}`
  return `import ${componentFile} from '${importPath}'

export default function ${componentName}() {
  return (
    <${componentFile} title="${title}">
      <h1>${title}</h1>
      <p>Start building your page here.</p>
    </${componentFile}>
  )
}
`
}

function createPageInPrototype({
  root,
  targetDir,
  protoName,
  protoFolder,
  createPage,
  templateRecipes,
}) {
  if (typeof createPage?.path !== 'string' || !createPage.path.trim()) {
    return { ok: false, status: 400, error: 'New page path is required' }
  }

  const rawPath = createPage.path.trim().replace(/^\/+/, '')
  const normalizedPath = createPage.path.trim().startsWith('/')
    ? createPage.path.trim()
    : `/${protoName}/${rawPath}`

  if (!isRouteInPrototype(protoName, normalizedPath)) {
    return { ok: false, status: 400, error: `New page path must be within "/${protoName}"` }
  }

  const relativePageRoute = normalizedPath.replace(new RegExp(`^/${protoName}/?`), '')
  if (!relativePageRoute) {
    return { ok: false, status: 400, error: 'New page path must include at least one segment after the prototype prefix' }
  }

  const parts = relativePageRoute.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) {
    return { ok: false, status: 400, error: 'New page path contains invalid segments' }
  }

  const safePartRe = /^[a-zA-Z0-9\-_.[\]]+$/
  if (parts.some((part) => !safePartRe.test(part))) {
    return {
      ok: false,
      status: 400,
      error: 'New page path can only include letters, numbers, "-", "_", ".", and [] for dynamic segments',
    }
  }

  const pageDirParts = parts.slice(0, -1)
  const pageName = parts[parts.length - 1]
  const pageFile = `${pageName}.jsx`
  const pageDir = path.join(targetDir, ...pageDirParts)
  const pageFilePath = path.join(pageDir, pageFile)

  if (fs.existsSync(pageFilePath)) {
    return { ok: false, status: 409, error: `Page "${normalizedPath}" already exists` }
  }

  let pageContent
  const titleBase = humanize(pageName)
  const componentName = toPascalCase(pageName) || 'Page'
  if (createPage.template) {
    const partialEntry = resolveTemplateRecipeEntry(templateRecipes, createPage.template, {
      prototype: protoName,
      folder: protoFolder,
    })
    if (!partialEntry) {
      const validNames = templateRecipes.map((p) => p.id).join(', ')
      return {
        ok: false,
        status: 400,
        error: `Unknown template/recipe "${createPage.template}". Available: ${validNames}`,
      }
    }

    const partialDir = path.join(root, 'src', partialEntry.baseDir, partialEntry.name)
    const componentFile = findComponentFile(partialDir)
    if (!componentFile) {
      return {
        ok: false,
        status: 400,
        error: `No .jsx or .tsx file found in src/${partialEntry.directory}/${partialEntry.name}/`,
      }
    }

    pageContent = generateTemplatePageJsx({
      partialEntry,
      componentFile,
      componentName,
      title: titleBase,
    })
  } else {
    pageContent = generateBlankPageJsx(componentName, titleBase)
  }

  fs.mkdirSync(pageDir, { recursive: true })
  fs.writeFileSync(pageFilePath, pageContent, 'utf-8')

  return {
    ok: true,
    createdPagePath: path.relative(root, pageFilePath),
    createdPageRoute: normalizedPath,
  }
}

function listPrototypeRoutes(protoDir, protoName) {
  const routes = []

  function scanDir(dir, routeParts = []) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), [...routeParts, entry.name])
        continue
      }
      if (!PAGE_EXT_RE.test(entry.name)) continue
      if (entry.name.startsWith('_')) continue

      const baseName = entry.name.replace(PAGE_EXT_RE, '')
      const fileRouteParts = baseName === 'index' ? routeParts : [...routeParts, baseName]
      const suffix = fileRouteParts.length > 0 ? `/${fileRouteParts.join('/')}` : ''
      routes.push(`/${protoName}${suffix}`)
    }
  }

  scanDir(protoDir)
  return Array.from(new Set(routes)).sort((a, b) => a.localeCompare(b))
}

/**
 * List prototypes by scanning src/prototypes/, following .folder directories.
 * Returns array of { name, folder?, routes }.
 */
function listPrototypes(root) {
  const prototypesDir = path.join(root, 'src', 'prototypes')
  if (!fs.existsSync(prototypesDir)) return []

  const results = []

  function scanDir(dir, folder) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.endsWith('.folder')) {
        scanDir(path.join(dir, entry.name), entry.name.replace('.folder', ''))
      } else {
        const protoDir = path.join(dir, entry.name)
        const prototypeFile = fs.readdirSync(protoDir).find((f) => f.endsWith('.prototype.json'))
        if (!prototypeFile) continue

        const prototypePath = path.join(protoDir, prototypeFile)
        if (!isExternalPrototype(prototypePath)) {
          results.push({
            name: entry.name,
            ...(folder ? { folder } : {}),
            routes: listPrototypeRoutes(protoDir, entry.name),
          })
        }
      }
    }
  }

  scanDir(prototypesDir)
  return results
}

/**
 * List existing flow files from the src/ tree.
 * Returns array of { name, title, path, prototype?, folder?, route? }.
 */
function listFlows(root) {
  const results = []

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        scanDir(path.join(dir, entry.name))
      } else if (/\.flow\.jsonc?$/.test(entry.name)) {
        const flowName = entry.name.replace(/\.flow\.jsonc?$/, '')
        const filePath = path.join(dir, entry.name)
        const relPath = path.relative(root, filePath)
        const flowPrototype = parsePrototypeFromFlowPath(relPath)

        let title = flowName
        let route
        try {
          const raw = fs.readFileSync(filePath, 'utf-8')
          const parsed = parseJsonc(raw)
          if (parsed?.meta?.title) title = parsed.meta.title
          if (typeof parsed?.meta?.route === 'string') route = parsed.meta.route
        } catch { /* ignore */ }

        results.push({
          name: flowName,
          title,
          path: relPath,
          ...(flowPrototype ? { prototype: flowPrototype.prototype } : {}),
          ...(flowPrototype?.folder ? { folder: flowPrototype.folder } : {}),
          ...(route ? { route } : {}),
        })
      }
    }
  }

  scanDir(path.join(root, 'src'))
  return results
}

/**
 * List available object names from the src/ tree.
 */
function listObjects(root) {
  const results = []

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        scanDir(path.join(dir, entry.name))
      } else if (/\.object\.jsonc?$/.test(entry.name)) {
        results.push(entry.name.replace(/\.object\.jsonc?$/, ''))
      }
    }
  }

  scanDir(path.join(root, 'src'))
  return results
}

function generateFlowJson({ title, author, description, globals, sourceData, route }) {
  let data = sourceData ? { ...sourceData } : {}

  data.meta = {
    ...(sourceData?.meta || {}),
    title,
  }

  if (author) {
    const authors = author.split(',').map((a) => a.trim()).filter(Boolean)
    data.meta.author = authors.length === 1 ? authors[0] : authors
  }

  if (description) {
    data.meta.description = description
  }

  if (route) {
    data.meta.route = route
  }

  if (globals && globals.length > 0) {
    data.$global = globals
  } else if (!sourceData) {
    data.$global = []
  }

  return JSON.stringify(data, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Create the flows API route handler.
 * @param {object} ctx - Server context ({ root, sendJson, workshopConfig })
 */
export function createFlowsHandler(ctx) {
  const { root, sendJson, workshopConfig = {} } = ctx
  const getTemplateRecipes = () => {
    const partials = readWorkshopPartials(root)
    return buildTemplateRecipeIndex(root, partials.length ? partials : workshopConfig.partials)
  }

  return async (req, res, { body, path: routePath, method }) => {
    const templateRecipes = getTemplateRecipes()

    if (routePath === '/flows' && method === 'GET') {
      const prototypes = listPrototypes(root)
      const flows = listFlows(root)
      const objects = listObjects(root)
      sendJson(res, 200, { prototypes, flows, objects, partials: templateRecipes })
      return
    }

    if (routePath === '/pages' && method === 'GET') {
      const prototypes = listPrototypes(root)
      sendJson(res, 200, { prototypes, partials: templateRecipes })
      return
    }

    if (routePath === '/pages' && method === 'POST') {
      const {
        prototype: protoName,
        folder: folderName,
        path: pagePath,
        template,
      } = body

      if (!protoName || typeof protoName !== 'string' || !protoName.trim()) {
        sendJson(res, 400, { error: 'Prototype is required when creating a page' })
        return
      }

      const resolvedPrototype = findPrototypeDir(root, protoName.trim(), folderName)
      if (!resolvedPrototype.dir) {
        sendJson(res, 400, { error: resolvedPrototype.error || `Prototype "${protoName}" not found` })
        return
      }

      const pageResult = createPageInPrototype({
        root,
        targetDir: resolvedPrototype.dir,
        protoName: protoName.trim(),
        protoFolder: resolvedPrototype.folder,
        createPage: { path: pagePath, template },
        templateRecipes,
      })

      if (!pageResult.ok) {
        sendJson(res, pageResult.status, { error: pageResult.error })
        return
      }

      sendJson(res, 201, {
        success: true,
        path: pageResult.createdPagePath,
        route: pageResult.createdPageRoute,
        files: [pageResult.createdPagePath],
      })
      return
    }

    if (routePath === '/flows' && method === 'POST') {
      const {
        name,
        title: customTitle,
        prototype: protoName,
        folder: folderName,
        existingFlow,
        author,
        description,
        globals = [],
        copyFrom,
        startingPage,
        createPage,
      } = body

      // Validate name
      const validation = validateFlowName(name)
      if (!validation.valid) {
        sendJson(res, 400, { error: validation.error })
        return
      }

      const { kebab } = validation
      const title = customTitle || humanize(kebab)

      if (!protoName || typeof protoName !== 'string' || !protoName.trim()) {
        sendJson(res, 400, { error: 'Prototype is required when creating a flow' })
        return
      }

      // Determine target directory
      const resolvedPrototype = findPrototypeDir(root, protoName.trim(), folderName)
      if (!resolvedPrototype.dir) {
        sendJson(res, 400, { error: resolvedPrototype.error || `Prototype "${protoName}" not found` })
        return
      }
      const targetDir = resolvedPrototype.dir

      // Check for existing flow file
      const flowFileName = `${kebab}.flow.json`
      const flowFilePath = path.join(targetDir, flowFileName)
      if (fs.existsSync(flowFilePath)) {
        sendJson(res, 409, { error: `Flow "${kebab}" already exists in this location` })
        return
      }

      // Load source flow data if copying
      let sourceData = null
      const selectedExistingFlow = typeof existingFlow === 'string' && existingFlow.trim()
        ? existingFlow.trim()
        : (typeof copyFrom === 'string' && copyFrom.trim() ? copyFrom.trim() : '')
      if (selectedExistingFlow) {
        let sourceFlowPath
        if (selectedExistingFlow.includes('/') || selectedExistingFlow.includes('\\')) {
          if (path.isAbsolute(selectedExistingFlow)) {
            sendJson(res, 400, { error: 'Existing flow path must be relative to repository root' })
            return
          }
          sourceFlowPath = path.resolve(root, selectedExistingFlow)
        } else {
          sourceFlowPath = path.join(targetDir, `${selectedExistingFlow.replace(/\.flow\.jsonc?$/, '')}.flow.json`)
          if (!fs.existsSync(sourceFlowPath)) {
            const jsoncPath = sourceFlowPath.replace(/\.flow\.json$/, '.flow.jsonc')
            if (fs.existsSync(jsoncPath)) sourceFlowPath = jsoncPath
          }
        }

        if (!sourceFlowPath || !fs.existsSync(sourceFlowPath)) {
          sendJson(res, 400, { error: `Existing flow not found: ${selectedExistingFlow}` })
          return
        }

        if (!/\.flow\.jsonc?$/.test(sourceFlowPath)) {
          sendJson(res, 400, { error: 'Existing flow must be a .flow.json or .flow.jsonc file' })
          return
        }

        if (!isPathInside(targetDir, sourceFlowPath)) {
          sendJson(res, 400, { error: 'Existing flow must belong to the selected prototype' })
          return
        }

        try {
          const raw = fs.readFileSync(sourceFlowPath, 'utf-8')
          sourceData = parseJsonc(raw)
        } catch {
          sendJson(res, 400, { error: `Failed to read source flow: ${selectedExistingFlow}` })
          return
        }
      }

      let createdPagePath = null
      let createdPageRoute = null
      if (createPage) {
        const pageResult = createPageInPrototype({
          root,
          targetDir,
          protoName,
          protoFolder: resolvedPrototype.folder,
          createPage,
          templateRecipes,
        })
        if (!pageResult.ok) {
          sendJson(res, pageResult.status, { error: pageResult.error })
          return
        }
        createdPagePath = pageResult.createdPagePath
        createdPageRoute = pageResult.createdPageRoute
      }

      const normalizedStartingPage = normalizeRouteForPrototype(protoName, startingPage)
      if (normalizedStartingPage && !isRouteInPrototype(protoName, normalizedStartingPage)) {
        sendJson(res, 400, { error: `Starting page must be within "/${protoName}"` })
        return
      }

      // Ensure target directory exists
      fs.mkdirSync(targetDir, { recursive: true })

      // Generate and write flow file
      const route = normalizedStartingPage || createdPageRoute
      const content = generateFlowJson({ title, author, description, globals, sourceData, route })
      fs.writeFileSync(flowFilePath, content, 'utf-8')

      const relPath = path.relative(root, flowFilePath)
      const files = [relPath]
      if (createdPagePath) files.push(createdPagePath)
      sendJson(res, 201, {
        success: true,
        path: relPath,
        files,
        ...(createdPagePath ? { createdPagePath } : {}),
      })
      return
    }

    // Unmatched routes fall through — the server plugin compositor handles 404
  }
}
