import { randomUUID } from 'node:crypto'

export const NOTEBOOK_PAGE_TYPES = Object.freeze(['prototype', 'canvas', 'site'])
export const NOTEBOOK_NAVIGATION_MODES = Object.freeze(['type', 'files'])

function navigationError(message) {
  const error = new Error(message)
  error.code = 'INVALID_NAVIGATION'
  return error
}

function operationError(message) {
  const error = new Error(message)
  error.code = 'INVALID_NAVIGATION_OPERATION'
  return error
}

function idsByType(pages) {
  const ids = Object.fromEntries(NOTEBOOK_PAGE_TYPES.map(type => [type, []]))
  for (const page of pages) if (ids[page?.type]) ids[page.type].push(page.id)
  return ids
}

function clampIndex(index, length) {
  const numeric = Number.isInteger(index) ? index : length
  return Math.max(0, Math.min(numeric, length))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Build all three independent page arrangements. `legacyGroups` is an
 * ordered array of { id, title, pageIds } groups imported once from legacy
 * filesystem organization; subsequent normalization never rediscovers it.
 */
export function createDefaultNavigation(pages, { legacyGroups = [] } = {}) {
  const pageIds = pages.map(page => page.id)
  const knownIds = new Set(pageIds)
  const sections = []
  const assigned = new Set()

  for (const group of legacyGroups) {
    const members = (Array.isArray(group?.pageIds) ? group.pageIds : [])
      .filter(id => knownIds.has(id) && !assigned.has(id))
    const id = typeof group?.id === 'string' && group.id.trim()
      ? group.id
      : `section-${randomUUID().replaceAll('-', '')}`
    const title = typeof group?.title === 'string' && group.title.trim() ? group.title.trim() : 'Section'
    if (!members.length || sections.some(section => section.id === id)) continue
    sections.push({ id, title, pageIds: members })
    for (const pageId of members) assigned.add(pageId)
  }

  const filesEntries = []
  const emittedSections = new Set()
  for (const pageId of pageIds) {
    const section = sections.find(item => item.pageIds.includes(pageId))
    if (section) {
      if (!emittedSections.has(section.id)) {
        filesEntries.push({ type: 'section', sectionId: section.id })
        emittedSections.add(section.id)
      }
    } else {
      filesEntries.push({ type: 'page', pageId })
    }
  }

  return {
    mode: 'type',
    sectionsEnabled: true,
    type: {
      groups: [...NOTEBOOK_PAGE_TYPES],
      order: idsByType(pages),
    },
    files: {
      flatOrder: pageIds,
      entries: filesEntries,
      sections,
    },
  }
}

function invalidNavigation(detail, pages) {
  const fallback = createDefaultNavigation(pages)
  return {
    navigation: fallback,
    valid: false,
    diagnostic: {
      code: 'INVALID_NAVIGATION',
      message: `Notebook navigation is malformed (${detail}); showing the complete fallback inventory.`,
      path: 'navigation',
    },
  }
}

function exactIdList(value, expected, label) {
  if (!Array.isArray(value)) throw navigationError(`${label} must be an array`)
  const allowed = new Set(expected)
  const seen = new Set()
  for (const id of value) {
    if (typeof id !== 'string' || !allowed.has(id)) throw navigationError(`${label} contains an unknown page`)
    if (seen.has(id)) throw navigationError(`${label} contains a duplicate page`)
    seen.add(id)
  }
  if (seen.size !== allowed.size) throw navigationError(`${label} omits registered pages`)
  return [...value]
}

/** Validate saved arrangements without ever returning a partial inventory. */
export function normalizeNavigation(value, pages) {
  if (value == null) return { navigation: createDefaultNavigation(pages), valid: true, diagnostic: null }

  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw navigationError('the value must be an object')
    if (!NOTEBOOK_NAVIGATION_MODES.includes(value.mode)) throw navigationError('the mode is unknown')
    if (typeof value.sectionsEnabled !== 'boolean') throw navigationError('sectionsEnabled must be a boolean')
    const groupedIds = idsByType(pages)
    const allIds = pages.map(page => page.id)
    const allowedTypes = new Set(NOTEBOOK_PAGE_TYPES)
    const groups = value.type?.groups
    if (!Array.isArray(groups) || groups.length !== allowedTypes.size || new Set(groups).size !== allowedTypes.size || groups.some(type => !allowedTypes.has(type))) {
      throw navigationError('Type group order must contain Prototype, Canvas, and Site once each')
    }
    const typeOrder = {}
    for (const type of NOTEBOOK_PAGE_TYPES) typeOrder[type] = exactIdList(value.type?.order?.[type], groupedIds[type], `Type ${type} order`)
    const flatOrder = exactIdList(value.files?.flatOrder, allIds, 'Flat Files order')
    const sections = value.files?.sections
    const entries = value.files?.entries
    if (!Array.isArray(sections) || !Array.isArray(entries)) throw navigationError('Files entries and sections must be arrays')

    const sectionById = new Map()
    for (const section of sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) throw navigationError('a section must be an object')
      if (typeof section.id !== 'string' || !section.id.trim() || sectionById.has(section.id)) throw navigationError('section IDs must be non-empty and unique')
      if (typeof section.title !== 'string' || !section.title.trim()) throw navigationError('section titles must be non-empty')
      sectionById.set(section.id, {
        id: section.id,
        title: section.title.trim(),
        pageIds: Array.isArray(section.pageIds) ? [...section.pageIds] : null,
      })
    }

    const referencedPages = new Set()
    const referencedSections = new Set()
    const normalizedEntries = []
    for (const entry of entries) {
      if (entry?.type === 'page' && typeof entry.pageId === 'string') {
        if (!allIds.includes(entry.pageId) || referencedPages.has(entry.pageId)) throw navigationError('Files entries contain an unknown or duplicate page')
        referencedPages.add(entry.pageId)
        normalizedEntries.push({ type: 'page', pageId: entry.pageId })
      } else if (entry?.type === 'section' && typeof entry.sectionId === 'string') {
        if (!sectionById.has(entry.sectionId) || referencedSections.has(entry.sectionId)) throw navigationError('Files entries contain an unknown or duplicate section')
        referencedSections.add(entry.sectionId)
        normalizedEntries.push({ type: 'section', sectionId: entry.sectionId })
      } else {
        throw navigationError('Files entries may reference only a page or one-level section')
      }
    }

    const normalizedSections = []
    for (const section of sectionById.values()) {
      if (!referencedSections.has(section.id)) throw navigationError('a section is not present in Files root order')
      if (!section.pageIds) throw navigationError('section pageIds must be an array')
      for (const pageId of section.pageIds) {
        if (!allIds.includes(pageId) || referencedPages.has(pageId)) throw navigationError('sections contain an unknown or duplicate page')
        referencedPages.add(pageId)
      }
      normalizedSections.push(section)
    }
    if (referencedPages.size !== allIds.length) throw navigationError('Files sectioned order omits registered pages')

    return {
      navigation: {
        mode: value.mode,
        sectionsEnabled: value.sectionsEnabled,
        type: { groups: [...groups], order: typeOrder },
        files: { flatOrder, entries: normalizedEntries, sections: normalizedSections },
      },
      valid: true,
      diagnostic: null,
    }
  } catch (error) {
    return invalidNavigation(error.message, pages)
  }
}

function removeFromSectionedFiles(files, pageId) {
  for (const section of files.sections) section.pageIds = section.pageIds.filter(id => id !== pageId)
  files.entries = files.entries.filter(entry => !(entry.type === 'page' && entry.pageId === pageId))
}

function insertPageInSectionedFiles(files, pageId, sectionId, index) {
  if (sectionId) {
    const section = files.sections.find(item => item.id === sectionId)
    if (!section) throw operationError(`Section "${sectionId}" was not found`)
    section.pageIds.splice(clampIndex(index, section.pageIds.length), 0, pageId)
    return
  }
  const rootPageEntries = files.entries.filter(entry => entry.type === 'page')
  const target = clampIndex(index, rootPageEntries.length)
  let insertionIndex = files.entries.length
  if (target < rootPageEntries.length) {
    const nextPage = rootPageEntries[target].pageId
    insertionIndex = files.entries.findIndex(entry => entry.type === 'page' && entry.pageId === nextPage)
  }
  files.entries.splice(insertionIndex, 0, { type: 'page', pageId })
}

/** Apply a single explicit structural change and return a new valid layout. */
export function applyNavigationOperation(value, pages, operation) {
  const normalized = normalizeNavigation(value, pages)
  const current = clone(normalized.navigation)
  const op = operation?.type

  if (op === 'setMode') {
    if (!NOTEBOOK_NAVIGATION_MODES.includes(operation.mode)) throw operationError('Mode must be type or files')
    current.mode = operation.mode
  } else if (op === 'setSectionsEnabled') {
    if (typeof operation.enabled !== 'boolean') throw operationError('Section visibility must be boolean')
    current.sectionsEnabled = operation.enabled
  } else if (op === 'reorderTypeGroups') {
    const groups = operation.groups
    if (!Array.isArray(groups) || groups.length !== NOTEBOOK_PAGE_TYPES.length || new Set(groups).size !== NOTEBOOK_PAGE_TYPES.length || groups.some(type => !NOTEBOOK_PAGE_TYPES.includes(type))) {
      throw operationError('Type group order must contain each page type once')
    }
    current.type.groups = [...groups]
  } else if (op === 'movePage') {
    const page = pages.find(item => item.id === operation.pageId)
    if (!page) throw operationError('Page was not found')
    if (operation.layout === 'type') {
      const targetType = operation.targetType || page.type
      if (targetType !== page.type) throw operationError('A page cannot be moved into a different Type group')
      const order = current.type.order[page.type].filter(id => id !== page.id)
      order.splice(clampIndex(operation.index, order.length), 0, page.id)
      current.type.order[page.type] = order
    } else if (operation.layout === 'filesFlat') {
      const order = current.files.flatOrder.filter(id => id !== page.id)
      order.splice(clampIndex(operation.index, order.length), 0, page.id)
      current.files.flatOrder = order
    } else if (operation.layout === 'filesSections') {
      removeFromSectionedFiles(current.files, page.id)
      insertPageInSectionedFiles(current.files, page.id, operation.sectionId || null, operation.index)
    } else {
      throw operationError('Layout must be type, filesFlat, or filesSections')
    }
  } else if (op === 'createSection') {
    const title = String(operation.title || '').trim()
    if (!title) throw operationError('Section title is required')
    const id = String(operation.sectionId || `section-${randomUUID().replaceAll('-', '')}`)
    if (current.files.sections.some(section => section.id === id)) throw operationError(`Section "${id}" already exists`)
    const section = { id, title, pageIds: [] }
    current.files.sections.push(section)
    current.files.entries.splice(clampIndex(operation.index, current.files.entries.length), 0, { type: 'section', sectionId: id })
  } else if (op === 'renameSection') {
    const section = current.files.sections.find(item => item.id === operation.sectionId)
    const title = String(operation.title || '').trim()
    if (!section || !title) throw operationError('An existing section and non-empty title are required')
    section.title = title
  } else if (op === 'moveSection') {
    const entryIndex = current.files.entries.findIndex(entry => entry.type === 'section' && entry.sectionId === operation.sectionId)
    if (entryIndex < 0) throw operationError('Section was not found')
    const [entry] = current.files.entries.splice(entryIndex, 1)
    current.files.entries.splice(clampIndex(operation.index, current.files.entries.length), 0, entry)
  } else if (op === 'removeSection') {
    const sectionIndex = current.files.sections.findIndex(section => section.id === operation.sectionId)
    const entryIndex = current.files.entries.findIndex(entry => entry.type === 'section' && entry.sectionId === operation.sectionId)
    if (sectionIndex < 0 || entryIndex < 0) throw operationError('Section was not found')
    const [section] = current.files.sections.splice(sectionIndex, 1)
    current.files.entries.splice(entryIndex, 1, ...section.pageIds.map(pageId => ({ type: 'page', pageId })))
  } else {
    throw operationError(`Unknown navigation operation: ${String(op || '')}`)
  }

  const result = normalizeNavigation(current, pages)
  if (!result.valid) throw operationError(result.diagnostic.message)
  return result.navigation
}
