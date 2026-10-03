/**
 * Workshop API — prototype creation and listing.
 *
 * Routes (mounted at /_storyboard/workshop/):
 *   GET  /prototypes  — list available folders and partials
 *   POST /prototypes  — create a new prototype (dir + metadata + page + optional flow)
 *
 * Recipes are defined in storyboard.config.json under workshop.partials.
 * Each entry has { type, name, globals? } where:
 *   - directory: "recipe" or "template" — maps to src/recipes/ or src/templates/
 *   - name: subdirectory name containing the component file
 *   - globals: optional array of $global names for prototype.json
 *
 * The server auto-discovers the main *.jsx or *.tsx component file
 * in that directory and generates the appropriate index.jsx import.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  buildTemplateRecipeIndex,
  resolveTemplateRecipeEntry,
} from '../templateIndex.js'
import { readWorkshopPartials } from '../partialRender.js'

const FLOW_SKELETON = JSON.stringify({ $global: [] }, null, 2) + '\n'

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

function toPascalCase(kebab) {
  return kebab
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

function humanize(kebab) {
  return toPascalCase(kebab).replace(/([A-Z])/g, ' $1').trim()
}

function validatePrototypeName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Prototype name is required' }
  }

  const kebab = toKebabCase(name.trim())

  if (!kebab) {
    return { valid: false, error: 'Name must contain at least one alphanumeric character' }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kebab)) {
    return { valid: false, error: 'Name must be kebab-case (lowercase letters, numbers, and hyphens)' }
  }

  const reserved = ['index', 'app', '_app']
  if (reserved.includes(kebab)) {
    return { valid: false, error: `"${kebab}" is a reserved name` }
  }

  return { valid: true, kebab }
}

function listFolders(root) {
  const prototypesDir = path.join(root, 'src', 'prototypes')
  if (!fs.existsSync(prototypesDir)) return []

  return fs.readdirSync(prototypesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith('.folder'))
    .map((d) => d.name.replace('.folder', ''))
}

/**
 * Find the main component file (*.jsx or *.tsx) in a recipe/template directory.
 * Returns the filename without extension, or null if not found.
 */
function findComponentFile(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
  const component = files.find((f) => /\.(jsx|tsx)$/.test(f) && !f.startsWith('_') && !f.includes('.test.'))
  return component ? component.replace(/\.(jsx|tsx)$/, '') : null
}

/**
 * Generate a blank React component (no template/recipe).
 */
function generateBlankIndexJsx(componentName, title) {
  return `export default function ${componentName}() {
  return (
    <div>
      <h1>${title}</h1>
      <p>Start building your prototype here.</p>
    </div>
  )
}
`
}

/**
 * Generate the index.jsx content for a new prototype.
 *
 * @param {object} partialEntry - Config entry { type, name }
 * @param {string} componentFile - Component filename without extension
 * @param {string} componentName - PascalCase name for the new prototype
 * @param {string} title - Human-readable title
 */
function generateIndexJsx({ partialEntry, componentFile, componentName, title }) {
  const importPath = `@/${partialEntry.baseDir}/${partialEntry.name}/${componentFile}`

  if (partialEntry.kind === 'template') {
    return `import ${componentFile} from '${importPath}'

export default function ${componentName}() {
  return (
    <${componentFile} title="${title}">
      <h1>${title}</h1>
      <p>Start building your prototype here.</p>
    </${componentFile}>
  )
}
`
  }

  // recipe
  return `import ${componentFile} from '${importPath}'

export default function ${componentName}() {
  return (
    <${componentFile}>
      <h1>${title}</h1>
      <p>Start building your prototype here.</p>
    </${componentFile}>
  )
}
`
}

function generatePrototypeJson({ title, author, description, partialEntry, url }) {
  const meta = { title }
  if (author) {
    meta.author = author.split(',').map((a) => a.trim()).filter(Boolean)
  }
  if (description) {
    meta.description = description
  }

  const json = { meta }

  if (url) {
    json.url = url
  }

  if (partialEntry?.globals?.length) {
    json.$global = partialEntry.globals
  }

  return JSON.stringify(json, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Create the prototypes API route handler.
 * @param {object} ctx - Server context ({ root, sendJson, workshopConfig })
 */
export function createPrototypesHandler(ctx) {
  const { root, sendJson, workshopConfig = {} } = ctx
  const getTemplateRecipes = () => {
    const partials = readWorkshopPartials(root)
    return buildTemplateRecipeIndex(root, partials.length ? partials : workshopConfig.partials)
  }

  return async (req, res, { body, path: routePath, method }) => {
    const templateRecipes = getTemplateRecipes()

    if (routePath === '/prototypes' && method === 'GET') {
      const folders = listFolders(root)
      sendJson(res, 200, { folders, partials: templateRecipes })
      return
    }

    if (routePath === '/prototypes' && method === 'POST') {
      const {
        name,
        title: customTitle,
        folder,
        partial: partialName,
        author,
        description,
        createFlow = false,
        url,
      } = body

      // Validate name
      const validation = validatePrototypeName(name)
      if (!validation.valid) {
        sendJson(res, 400, { error: validation.error })
        return
      }

      const { kebab } = validation
      const componentName = toPascalCase(kebab)
      const title = customTitle || humanize(kebab)

      // Validate URL for external prototypes
      if (url !== undefined && url !== null) {
        if (typeof url !== 'string' || !url.trim()) {
          sendJson(res, 400, { error: 'URL must be a non-empty string' })
          return
        }
        try {
          const parsedUrl = new URL(url)
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            sendJson(res, 400, { error: 'URL must use http: or https: protocol' })
            return
          }
        } catch {
          sendJson(res, 400, { error: 'URL must be a valid absolute URL (e.g. https://example.com)' })
          return
        }
      }

      const isExternal = Boolean(url)

      // Determine target directory
      const prototypesDir = path.join(root, 'src', 'prototypes')
      let targetDir

      if (folder) {
        const folderDir = path.join(prototypesDir, `${folder}.folder`)
        if (!fs.existsSync(folderDir)) {
          sendJson(res, 400, { error: `Folder "${folder}" does not exist` })
          return
        }
        targetDir = path.join(folderDir, kebab)
      } else {
        targetDir = path.join(prototypesDir, kebab)
      }

      if (fs.existsSync(targetDir)) {
        sendJson(res, 409, { error: `Prototype "${kebab}" already exists` })
        return
      }

      // Create directory
      fs.mkdirSync(targetDir, { recursive: true })

      // Write prototype.json
      const protoJsonName = `${kebab}.prototype.json`
      fs.writeFileSync(
        path.join(targetDir, protoJsonName),
        generatePrototypeJson({ title, author, description, partialEntry: null, url: isExternal ? url : undefined }),
      )

      const relDir = targetDir.replace(root + '/', '')
      const result = {
        success: true,
        path: relDir,
        isExternal,
        files: [`${relDir}/${protoJsonName}`],
      }

      if (isExternal) {
        result.externalUrl = url
        sendJson(res, 201, result)
        return
      }

      // Non-external: generate index.jsx and optional flow

      // Look up recipe in config (optional — blank prototype if none)
      const partialEntry = partialName
        ? resolveTemplateRecipeEntry(templateRecipes, partialName)
        : null

      if (partialName && !partialEntry) {
        const validNames = templateRecipes.map((r) => r.id).join(', ')
        sendJson(res, 400, { error: `Unknown recipe "${partialName}". Available: ${validNames}` })
        return
      }

      // Re-write prototype.json with partial globals if needed
      if (partialEntry) {
        fs.writeFileSync(
          path.join(targetDir, protoJsonName),
          generatePrototypeJson({ title, author, description, partialEntry }),
        )
      }

      let content

      if (!partialEntry) {
        content = generateBlankIndexJsx(componentName, title)
      } else {
        const partialDir = path.join(root, 'src', partialEntry.baseDir, partialEntry.name)
        const componentFile = findComponentFile(partialDir)
        if (!componentFile) {
          sendJson(res, 400, { error: `No .jsx or .tsx file found in src/${partialEntry.baseDir}/${partialEntry.name}/` })
          return
        }

        content = generateIndexJsx({ partialEntry, componentFile, componentName, title })
      }

      // Write index.jsx
      fs.writeFileSync(path.join(targetDir, 'index.jsx'), content, 'utf-8')
      result.route = `/${kebab}`
      result.files.push(`${relDir}/index.jsx`)

      // Optionally create flow.json
      if (createFlow) {
        const flowName = `${kebab}.flow.json`
        const flowPath = path.join(targetDir, flowName)
        fs.writeFileSync(flowPath, FLOW_SKELETON, 'utf-8')
        result.files.push(`${relDir}/${flowName}`)
        result.flowPath = `${relDir}/${flowName}`
      }

      sendJson(res, 201, result)
      return
    }

    // DELETE /prototypes — delete a prototype directory
    if (routePath === '/prototypes' && method === 'DELETE') {
      const { name, folder } = body

      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'Prototype name is required' })
        return
      }

      const prototypesDir = path.join(root, 'src', 'prototypes')
      let targetDir

      if (folder) {
        targetDir = path.join(prototypesDir, `${folder}.folder`, name)
        if (!fs.existsSync(targetDir)) {
          targetDir = path.join(prototypesDir, folder, name)
        }
      } else {
        targetDir = path.join(prototypesDir, name)
      }

      if (!fs.existsSync(targetDir)) {
        sendJson(res, 404, { error: `Prototype "${name}" not found` })
        return
      }

      // Safety: verify it's actually inside src/prototypes/
      const resolved = path.resolve(targetDir)
      if (!resolved.startsWith(path.resolve(prototypesDir))) {
        sendJson(res, 400, { error: 'Invalid path' })
        return
      }

      try {
        fs.rmSync(targetDir, { recursive: true, force: true })
        sendJson(res, 200, { success: true, deleted: name })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to delete prototype: ${err.message}` })
      }
      return
    }

    // PUT /prototypes — update prototype metadata
    if (routePath === '/prototypes' && method === 'PUT') {
      const { name, folder, title, description, author } = body

      if (!name || typeof name !== 'string') {
        sendJson(res, 400, { error: 'Prototype name is required' })
        return
      }

      const prototypesDir = path.join(root, 'src', 'prototypes')
      let targetDir

      if (folder) {
        targetDir = path.join(prototypesDir, `${folder}.folder`, name)
        if (!fs.existsSync(targetDir)) {
          targetDir = path.join(prototypesDir, folder, name)
        }
      } else {
        targetDir = path.join(prototypesDir, name)
      }

      if (!fs.existsSync(targetDir)) {
        sendJson(res, 404, { error: `Prototype "${name}" not found` })
        return
      }

      // Find the .prototype.json file
      const files = fs.readdirSync(targetDir)
      const protoJsonFile = files.find(f => f.endsWith('.prototype.json'))

      if (!protoJsonFile) {
        sendJson(res, 404, { error: `No .prototype.json file found in "${name}"` })
        return
      }

      try {
        const protoJsonPath = path.join(targetDir, protoJsonFile)
        const json = JSON.parse(fs.readFileSync(protoJsonPath, 'utf-8'))

        if (!json.meta) json.meta = {}
        if (title !== undefined) json.meta.title = title
        if (description !== undefined) json.meta.description = description
        if (author !== undefined) {
          json.meta.author = typeof author === 'string'
            ? author.split(',').map(a => a.trim()).filter(Boolean)
            : author
        }

        fs.writeFileSync(protoJsonPath, JSON.stringify(json, null, 2) + '\n', 'utf-8')
        sendJson(res, 200, { success: true, updated: name })
      } catch (err) {
        sendJson(res, 500, { error: `Failed to update prototype metadata: ${err.message}` })
      }
      return
    }

    // Unmatched routes fall through — the server plugin compositor handles 404
  }
}
