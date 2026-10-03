import { loadFlow, listFlows, listPrototypes, getPrototypeMetadata, listFolders, getFolderMetadata, listCanvases, getCanvasData } from './loader.js'

/**
 * Deterministic hash from a string — used for seeding generative placeholders.
 * @param {string} str
 * @returns {number}
 */
export function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/**
 * Append `tokens` from flow/prototype data as URL search params.
 * Filters out reserved keys (`flow`, `scene`) and non-scalar values.
 *
 * @param {string} url - Base URL (may already contain query params)
 * @param {object|null|undefined} tokens - Key-value pairs to append
 * @returns {string} URL with token params appended
 */
export function appendTokens(url, tokens) {
  if (!tokens || typeof tokens !== 'object') return url
  const reserved = new Set(['flow', 'scene'])
  const entries = Object.entries(tokens).filter(
    ([k, v]) => v != null && !reserved.has(k) && typeof v !== 'object',
  )
  if (entries.length === 0) return url
  const sep = url.includes('?') ? '&' : '?'
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return `${url}${sep}${qs}`
}

/**
 * Resolve the target route path for a flow.
 *
 * Priority:
 * 1. If flow name matches a known route (case-insensitive), use that route
 * 2. If flow data has an explicit top-level `route`, or `meta.route` / `flowMeta.route`, use that
 * 3. If flow data has `_route` (inferred from file path by Vite plugin), use that
 * 4. Fall back to root "/"
 *
 * Flows with `meta.default: true` targeting a route omit the `?flow=` param.
 * If the flow data contains a `tokens` object, its entries are appended as query params.
 *
 * @param {string} flowName
 * @param {string[]} knownRoutes - Array of route names (e.g. ["Dashboard", "Repositories"])
 * @returns {string} Full path with optional ?flow= param
 */
export function resolveFlowRoute(flowName, knownRoutes = []) {
  let routeUrl
  let data = null

  // Case-insensitive match against known routes
  const matchedRoute = knownRoutes.find(r => r.toLowerCase() === flowName.toLowerCase())

  if (matchedRoute) {
    routeUrl = `/${matchedRoute}`
  } else {
    try {
      data = loadFlow(flowName)

      // Check for explicit route: top-level `route`, then meta.route, then legacy sceneMeta.route
      const explicitRoute = data?.route || data?.meta?.route || data?.flowMeta?.route || data?.sceneMeta?.route
      if (explicitRoute) {
        const normalized = explicitRoute.startsWith('/') ? explicitRoute : `/${explicitRoute}`
        routeUrl = data?.meta?.default === true
          ? normalized
          : `${normalized}?flow=${encodeURIComponent(flowName)}`
      } else if (data?._route) {
        // Use inferred route from file path (injected by Vite data plugin)
        routeUrl = data?.meta?.default === true
          ? data._route
          : `${data._route}?flow=${encodeURIComponent(flowName)}`
      } else {
        routeUrl = `/?flow=${encodeURIComponent(flowName)}`
      }
    } catch {
      routeUrl = `/?flow=${encodeURIComponent(flowName)}`
    }
  }

  // Load flow data for tokens if not already loaded (e.g. known-route early match)
  if (!data) {
    try { data = loadFlow(flowName) } catch { /* ignore */ }
  }

  return appendTokens(routeUrl, data?.tokens)
}

/** @deprecated Use resolveFlowRoute() */
export const resolveSceneRoute = resolveFlowRoute

/**
 * Get meta for a flow (title, description, author, etc).
 *
 * @param {string} flowName
 * @returns {{ title?: string, description?: string, author?: string | string[] } | null}
 */
export function getFlowMeta(flowName) {
  try {
    const data = loadFlow(flowName)
    return data?.meta || data?.flowMeta || data?.sceneMeta || null
  } catch {
    return null
  }
}

/** @deprecated Use getFlowMeta() */
export const getSceneMeta = getFlowMeta

/**
 * Build a structured prototype index grouping flows by prototype,
 * and prototypes by folder.
 *
 * Returns an object with:
 * - folders: array of folder entries containing their prototypes
 * - prototypes: array of ungrouped prototype entries (not in any folder)
 * - globalFlows: flows not belonging to any prototype
 *
 * @param {string[]} [knownRoutes] - Array of known route names
 * @returns {{ folders: Array, prototypes: Array, globalFlows: Array }}
 */
export function buildPrototypeIndex(knownRoutes = []) {
  const flows = listFlows()
  const protoMap = {}
  const globalFlows = []

  // Seed from .prototype.json metadata (even prototypes with no flows appear)
  for (const name of listPrototypes()) {
    const raw = getPrototypeMetadata(name)
    const meta = raw?.meta || raw || {}
    const isExternal = Boolean(raw?.url)
    const folder = raw?.folder || null
    const isPrivate = raw?._isPrivate || false
    protoMap[name] = {
      name: meta.title || name,
      dirName: name,
      description: meta.description || null,
      author: meta.author || null,
      gitAuthor: raw?.gitAuthor || null,
      lastModified: raw?.lastModified || null,
      icon: meta.icon || null,
      team: meta.team || null,
      tags: meta.tags || null,
      hideFlows: meta.hideFlows ?? raw?.hideFlows ?? true,
      folder,
      isExternal,
      externalUrl: isExternal ? raw.url : null,
      isPrivate,
      flows: [],
    }
  }

  for (const flowName of flows) {
    const slashIdx = flowName.indexOf('/')
    if (slashIdx > 0) {
      const protoName = flowName.substring(0, slashIdx)
      const shortName = flowName.substring(slashIdx + 1)

      if (!protoMap[protoName]) {
        protoMap[protoName] = {
          name: protoName,
          dirName: protoName,
          description: null,
          author: null,
          gitAuthor: null,
          lastModified: null,
          icon: null,
          team: null,
          tags: null,
          hideFlows: true,
          folder: null,
          isExternal: false,
          externalUrl: null,
          flows: [],
        }
      }

      protoMap[protoName].flows.push({
        key: flowName,
        name: shortName,
        route: resolveFlowRoute(flowName, knownRoutes),
        meta: getFlowMeta(flowName),
      })
    } else {
      globalFlows.push({
        key: flowName,
        name: flowName,
        route: resolveFlowRoute(flowName, knownRoutes),
        meta: getFlowMeta(flowName),
      })
    }
  }

  // Build folder entries from .folder.json metadata
  const folderMap = {}
  for (const folderName of listFolders()) {
    const raw = getFolderMetadata(folderName)
    const meta = raw?.meta || raw || {}
    folderMap[folderName] = {
      name: meta.title || folderName,
      dirName: folderName,
      description: meta.description || null,
      icon: meta.icon || null,
      isPrivate: !!raw?._isPrivate,
      prototypes: [],
    }
  }

  // Partition prototypes into folders vs ungrouped
  const ungrouped = []
  for (const proto of Object.values(protoMap)) {
    if (proto.folder && folderMap[proto.folder]) {
      folderMap[proto.folder].prototypes.push(proto)
    } else if (proto.folder) {
      // Folder referenced but no .folder.json — create an implicit folder
      folderMap[proto.folder] = {
        name: proto.folder,
        dirName: proto.folder,
        description: null,
        icon: null,
        isPrivate: false,
        prototypes: [proto],
      }
    } else {
      ungrouped.push(proto)
    }
  }

  const folders = Object.values(folderMap)
  const prototypes = ungrouped

  // Build canvas entries — collapse grouped pages into a single entry per group
  const canvasEntries = []
  const seenGroups = new Map() // group name → index in canvasEntries
  const toTitleCase = (s) => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  for (const canvasId of listCanvases()) {
    const data = getCanvasData(canvasId)
    if (!data) continue
    const meta = data._canvasMeta
    const group = data._group || null

    // Page name: use title from data, or derive from the file segment
    const fileSegment = canvasId.split('/').pop()
    const pageName = data.title || toTitleCase(fileSegment)

    const pageEntry = {
      id: canvasId,
      name: pageName,
      route: data._route || `/canvas/${canvasId}`,
      isPrivate: !!data._isPrivate,
    }

    // If this canvas belongs to a group we've already seen, add as a page
    if (group && seenGroups.has(group)) {
      const idx = seenGroups.get(group)
      const existing = canvasEntries[idx]
      if (!existing.pages) {
        // Retroactively add the first page
        const firstId = existing.dirName
        const firstData = getCanvasData(firstId)
        const firstSegment = firstId.split('/').pop()
        const firstName = firstData?.title || toTitleCase(firstSegment)
        existing.pages = [{
          id: firstId,
          name: firstName,
          route: existing.route,
          isPrivate: !!firstData?._isPrivate,
        }]
      }
      // If the existing card is private but this incoming page is public,
      // promote the public page to be the card's public face. The private
      // sibling stays as one of the group's pages (with its eye-off icon
      // in the dropdown). Without this swap, the workspace card would
      // inherit the title + privacy of whichever page happened to come
      // first in iteration order.
      const incomingIsPrivate = !!data._isPrivate
      if (existing.isPrivate && !incomingIsPrivate) {
        existing.name = meta?.title || data.title || canvasId
        existing.dirName = canvasId
        existing.description = meta?.description || data.description || null
        existing.route = data._route || `/canvas/${canvasId}`
        existing.folder = data._folder || existing.folder
        existing.isPrivate = false
        existing.author = meta?.author || data.author || existing.author
        existing.gitAuthor = data.gitAuthor || existing.gitAuthor
        existing._canvasMeta = meta || existing._canvasMeta
      }
      existing.pages.push(pageEntry)
      continue
    }

    // Preserve explicit legacy privacy metadata. Directory names no longer
    // have privacy semantics.
    const isPrivate = Boolean(data._isPrivate)
    const entry = {
      name: meta?.title || data.title || canvasId,
      dirName: canvasId,
      description: meta?.description || data.description || null,
      route: data._route || `/canvas/${canvasId}`,
      folder: data._folder || null,
      isCanvas: true,
      isPrivate,
      author: meta?.author || data.author || null,
      gitAuthor: data.gitAuthor || null,
      _canvasMeta: meta || null,
      _group: group,
    }
    if (group) seenGroups.set(group, canvasEntries.length)
    canvasEntries.push(entry)
  }

  // Sort grouped canvas pages by pageOrder from .meta.json
  for (const entry of canvasEntries) {
    if (!entry.pages || !entry._canvasMeta?.pageOrder) continue
    const orderMap = new Map()
    entry._canvasMeta.pageOrder.forEach((p, idx) => {
      const key = typeof p === 'string' ? p : p?.name
      if (key) orderMap.set(key, idx)
    })
    const stripDraft = (k) => (typeof k === 'string' ? k.split('/').filter(seg => seg !== 'drafts').join('/') : k)
    entry.pages.sort((a, b) => {
      const aKey = stripDraft(a.id ?? a.name)
      const bKey = stripDraft(b.id ?? b.name)
      const aIdx = orderMap.has(aKey) ? orderMap.get(aKey) : Infinity
      const bIdx = orderMap.has(bKey) ? orderMap.get(bKey) : Infinity
      return aIdx - bIdx
    })
  }

  // Add canvases to their folders or to ungrouped
  for (const canvas of canvasEntries) {
    if (canvas.folder && folderMap[canvas.folder]) {
      if (!folderMap[canvas.folder].canvases) folderMap[canvas.folder].canvases = []
      folderMap[canvas.folder].canvases.push(canvas)
    } else if (canvas.folder) {
      if (!folderMap[canvas.folder]) {
        folderMap[canvas.folder] = {
          name: canvas.folder,
          dirName: canvas.folder,
          description: null,
          icon: null,
          isPrivate: false,
          prototypes: [],
          canvases: [canvas],
        }
      } else {
        if (!folderMap[canvas.folder].canvases) folderMap[canvas.folder].canvases = []
        folderMap[canvas.folder].canvases.push(canvas)
      }
    }
  }

  const ungroupedCanvases = canvasEntries.filter(c => !c.folder)

  // Pre-sort by title (A-Z)
  const sortByTitle = (a, b) => (a.name || '').localeCompare(b.name || '')

  // Pre-sort by last updated (newest first, nulls last)
  const sortByUpdated = (a, b) => {
    const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0
    const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0
    return bTime - aTime
  }

  // Sort folder contents by their most recently updated prototype
  const folderByUpdated = (a, b) => {
    const aMax = Math.max(0, ...a.prototypes.map(p => p.lastModified ? new Date(p.lastModified).getTime() : 0))
    const bMax = Math.max(0, ...b.prototypes.map(p => p.lastModified ? new Date(p.lastModified).getTime() : 0))
    return bMax - aMax
  }

  return {
    folders,
    prototypes,
    canvases: ungroupedCanvases,
    globalFlows,
    sorted: {
      title: {
        prototypes: [...prototypes].sort(sortByTitle),
        canvases: [...ungroupedCanvases].sort(sortByTitle),
        folders: [...folders].map(f => ({
          ...f,
          prototypes: [...f.prototypes].sort(sortByTitle),
          canvases: [...(f.canvases || [])].sort(sortByTitle),
        })).sort(sortByTitle),
      },
      updated: {
        prototypes: [...prototypes].sort(sortByUpdated),
        canvases: [...ungroupedCanvases].sort(sortByTitle),
        folders: [...folders].map(f => ({
          ...f,
          prototypes: [...f.prototypes].sort(sortByUpdated),
          canvases: [...(f.canvases || [])].sort(sortByTitle),
        })).sort(folderByUpdated),
      },
    },
  }
}
