/**
 * Artifact validation — schema + semantic validation for all artifact types.
 *
 * Validates against JSON Schema definitions and performs semantic checks
 * (uniqueness, reference existence, mutual exclusivity).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cache loaded schemas
const schemaCache = new Map()

const VALID_TYPES = ['prototype', 'canvas', 'component', 'flow', 'object', 'record', 'page', 'site']
const RESERVED_NAMES = new Set(['index', 'app', '_app'])
// eslint-disable-next-line no-unused-vars -- reserved for future validation
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// eslint-disable-next-line no-unused-vars -- reserved for future validation
const PATH_PATTERN = /^[a-z0-9/[\]_-]+$/
// eslint-disable-next-line no-unused-vars -- reserved for future validation
const MAX_NAME_LENGTH = 64

function contentDir(root, name) {
  return fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))
    ? path.join(root, name)
    : path.join(root, 'src', name)
}

/**
 * Load a schema by artifact type.
 */
function loadSchema(type) {
  if (schemaCache.has(type)) return schemaCache.get(type)
  const schemaPath = path.join(__dirname, 'schemas', `${type}.schema.json`)
  if (!fs.existsSync(schemaPath)) return null
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))
  schemaCache.set(type, schema)
  return schema
}

/**
 * Normalize input values (coerce types, apply defaults).
 */
function normalizeValues(type, values) {
  const normalized = { ...values }

  // Map 'content' field to type-specific fields (UI sends 'content' for objects/records)
  if (normalized.content && type === 'object' && !normalized.body) {
    try { normalized.body = JSON.parse(normalized.content) } catch { normalized.body = {} }
    delete normalized.content
  }
  if (normalized.content && type === 'record' && !normalized.entries) {
    try { normalized.entries = JSON.parse(normalized.content) } catch { normalized.entries = [] }
    delete normalized.content
  }

  // Coerce author string to array
  if (typeof normalized.author === 'string') {
    normalized.author = normalized.author.split(',').map(a => a.trim()).filter(Boolean)
  }

  // Coerce globals string to array
  if (typeof normalized.globals === 'string') {
    normalized.globals = normalized.globals.split(',').map(g => g.trim()).filter(Boolean)
  }

  // Normalize name to kebab-case (skip for components which use PascalCase)
  if (normalized.name && typeof normalized.name === 'string' && type !== 'component') {
    normalized.name = normalized.name
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  return normalized
}

/**
 * Validate schema constraints (required fields, patterns, types).
 */
function validateSchema(type, values) {
  const schema = loadSchema(type)
  if (!schema) return [{ field: '_type', message: `Unknown artifact type: ${type}` }]

  const errors = []
  const props = schema.properties || {}
  const required = schema.required || []

  // Check required fields
  for (const field of required) {
    if (values[field] === undefined || values[field] === null || values[field] === '') {
      errors.push({ field, message: `${field} is required` })
    }
  }

  // Check field constraints
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue
    const prop = props[field]
    if (!prop) continue

    // Pattern check (for strings)
    if (prop.pattern && typeof value === 'string') {
      const re = new RegExp(prop.pattern)
      if (!re.test(value)) {
        errors.push({ field, message: `${field} must match pattern ${prop.pattern}` })
      }
    }

    // Max length
    if (prop.maxLength && typeof value === 'string' && value.length > prop.maxLength) {
      errors.push({ field, message: `${field} must be at most ${prop.maxLength} characters` })
    }

    // URL format
    if (prop.format === 'uri' && typeof value === 'string') {
      try {
        new URL(value)
      } catch {
        errors.push({ field, message: `${field} must be a valid URL` })
      }
    }
  }

  // Mutual exclusivity
  if (schema.mutuallyExclusive) {
    for (const group of schema.mutuallyExclusive) {
      const present = group.filter(f => values[f] !== undefined && values[f] !== false)
      if (present.length > 1) {
        errors.push({ field: present.join(', '), message: `${present.join(' and ')} are mutually exclusive` })
      }
    }
  }

  return errors
}

function prototypeSlugExists(prototypesDir, name) {
  const visit = directory => {
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return false }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const candidate = path.join(directory, entry.name)
      if (entry.name === name) {
        let children = []
        try { children = fs.readdirSync(candidate) } catch { children = [] }
        if (children.some(file => file.endsWith('.prototype.json')) || children.some(file => /^index\.(jsx|js|tsx|ts)$/.test(file))) return true
      }
      if (visit(candidate)) return true
    }
    return false
  }
  return visit(prototypesDir)
}

/**
 * Validate semantic constraints (uniqueness, references, reserved names).
 */
function validateSemantic(type, values, root) {
  const errors = []

  // Reserved name check
  if (['prototype', 'page'].includes(type) && RESERVED_NAMES.has(values.name)) {
    errors.push({ field: 'name', message: `"${values.name}" is a reserved name` })
  }

  // Uniqueness checks
  if (type === 'prototype') {
    const prototypesDir = contentDir(root, 'prototypes')
    const isNotebook = fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))
    const targetDir = !isNotebook && values.folder
      ? path.join(prototypesDir, `${values.folder}.folder`, values.name)
      : path.join(prototypesDir, values.name)
    if (fs.existsSync(targetDir) || (isNotebook && prototypeSlugExists(prototypesDir, values.name))) {
      errors.push({ field: 'name', message: `Prototype "${values.name}" already exists${values.folder ? ` in folder "${values.folder}"` : ''}` })
    }
  }

  if (type === 'canvas') {
    const canvasDir = contentDir(root, 'canvas')
    const fileName = `${values.name}.canvas.jsonl`
    const isNotebook = fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))
    const candidates = values.folder && !isNotebook
      ? [path.join(canvasDir, values.folder, fileName), path.join(canvasDir, `${values.folder}.folder`, fileName)]
      : [path.join(canvasDir, fileName)]
    if (candidates.some(candidate => fs.existsSync(candidate))) {
      errors.push({ field: 'name', message: `Canvas "${values.name}" already exists` })
    }
  }

  if (type === 'component') {
    const componentsDir = contentDir(root, 'components')
    const pascal = toPascalCase(values.name)
    const targetDir = values.directory
      ? path.join(componentsDir, values.directory, pascal)
      : path.join(componentsDir, pascal)
    if (fs.existsSync(targetDir)) {
      errors.push({ field: 'name', message: `Component "${values.name}" already exists` })
    }
  }

  // Reference existence checks
  if (type === 'flow' || type === 'page') {
    const prototypesDir = contentDir(root, 'prototypes')
    const protoDir = resolvePrototypeDir(prototypesDir, values.prototype, values.folder)
    if (!protoDir) {
      errors.push({ field: 'prototype', message: `Prototype "${values.prototype}" not found` })
    } else if (type === 'flow') {
      // Check duplicate flow name
      const flowFile = path.join(protoDir, `${values.name}.flow.json`)
      if (fs.existsSync(flowFile)) {
        errors.push({ field: 'name', message: `Flow "${values.name}" already exists in prototype "${values.prototype}"` })
      }
    }
  }

  return errors
}

/**
 * Resolve a prototype directory by name, searching in folder and root.
 */
function resolvePrototypeDir(prototypesDir, name, folder) {
  if (!fs.existsSync(prototypesDir)) return null

  // Try with folder
  if (folder) {
    const folderPath = path.join(prototypesDir, `${folder}.folder`, name)
    if (fs.existsSync(folderPath)) return folderPath
    const altPath = path.join(prototypesDir, folder, name)
    if (fs.existsSync(altPath)) return altPath
  }

  // Try root
  const rootPath = path.join(prototypesDir, name)
  if (fs.existsSync(rootPath)) return rootPath

  // Search all folders
  if (fs.existsSync(prototypesDir)) {
    const entries = fs.readdirSync(prototypesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.folder')) {
        const candidate = path.join(prototypesDir, entry.name, name)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }

  return null
}

function toPascalCase(kebab) {
  return kebab
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

/**
 * Main validation entry point.
 *
 * @param {string} type - Artifact type
 * @param {object} values - Input values
 * @param {string} root - Project root directory
 * @returns {{ valid: boolean, errors?: Array<{field: string, message: string}>, normalized?: object }}
 */
export function validateArtifact(type, values, root) {
  if (!VALID_TYPES.includes(type)) {
    return { valid: false, errors: [{ field: '_type', message: `Unknown artifact type: "${type}". Valid types: ${VALID_TYPES.join(', ')}` }] }
  }

  // 1. Normalize
  const normalized = normalizeValues(type, values)

  // 2. Schema validation
  const schemaErrors = validateSchema(type, normalized)
  if (schemaErrors.length > 0) {
    return { valid: false, errors: schemaErrors }
  }

  // 3. Semantic validation
  const semanticErrors = validateSemantic(type, normalized, root)
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors }
  }

  return { valid: true, normalized }
}

export { VALID_TYPES, loadSchema, resolvePrototypeDir, toPascalCase }
