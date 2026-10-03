import { parseCanvasId } from '../canvas/identity.js'

const ARTIFACT_INDEX_SCHEMA_VERSION = 1

/**
 * Folder-independent identity for a canvas, mirroring how prototypes are
 * matched across branches by their (folder-independent) `dirName`.
 *
 * The full canvas id is path-based (e.g. `widget/design-system`), so the same
 * canvas living at the root on one branch and inside a folder on another would
 * otherwise key differently and render as duplicate cross-branch cards. We key
 * by the canvas name instead — proto-scoped canvases keep their prototype
 * segment so two prototypes with same-named canvases never collide.
 */
export function canvasMatchKey(id) {
  const { namespace, segments, name } = parseCanvasId(String(id || ''))
  if (namespace === 'prototype') {
    const scope = segments.length >= 2 ? segments[segments.length - 2] : ''
    return scope ? `proto:${scope}/${name}` : `proto:${name}`
  }
  return name
}

/**
 * Collapse the remote canvas map (keyed by full path id) into a map keyed by
 * folder-independent match key, merging the branch lists of any entries that
 * resolve to the same canvas. This makes matching resilient to canvases that
 * moved between folders (or root ↔ folder) across branches, and keeps the
 * behavior correct for both freshly-aggregated and legacy indexes.
 */
function collapseRemoteCanvases(remoteCanvases) {
  const byKey = new Map()
  for (const [id, entry] of Object.entries(remoteCanvases || {})) {
    const key = canvasMatchKey(id)
    const existing = byKey.get(key)
    if (existing) {
      existing.entry = {
        ...existing.entry,
        branches: [...(existing.entry.branches || []), ...(entry?.branches || [])],
      }
    } else {
      byKey.set(key, { id, entry: { ...entry, branches: [...(entry?.branches || [])] } })
    }
  }
  return byKey
}

function stripBranchSegments(basePath) {
  let path = typeof basePath === 'string' && basePath.trim() ? basePath : '/'
  path = path.replace(/[?#].*$/, '')

  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) path = new URL(path).pathname
  } catch {
    path = '/'
  }

  if (!path.startsWith('/')) path = `/${path}`
  return path
    .replace(/\/+/g, '/')
    .replace(/\/branch--[^/]+(?=\/|$)/g, '')
    .replace(/\/+$|^\/+$/g, '')
}

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '')
}

function joinAbsolutePath(parts) {
  const path = parts
    .filter(part => part != null && String(part).length > 0)
    .join('/')
    .replace(/\/+/g, '/')

  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

function artifactIndexUrl(basePath) {
  const branchBasePath = stripBranchSegments(basePath)
  return joinAbsolutePath([branchBasePath, 'artifacts.index.json'])
}

export async function fetchArtifactIndex(basePath) {
  try {
    const res = await fetch(artifactIndexUrl(basePath))
    if (!res?.ok) return null

    const data = await res.json()
    if (data?.schemaVersion !== ARTIFACT_INDEX_SCHEMA_VERSION) return null
    return data
  } catch {
    return null
  }
}

export function buildBranchArtifactHref(branchBasePath, folder, route) {
  const base = stripBranchSegments(branchBasePath)
  return joinAbsolutePath([base, trimSlashes(folder), trimSlashes(route)])
}

function cloneBranchEntries(branches) {
  return Array.isArray(branches) ? branches.map(branch => ({ ...branch })) : []
}

function sortBranchEntries(branches) {
  return [...branches].sort((a, b) => {
    const aBranch = a?.branch || ''
    const bBranch = b?.branch || ''
    if (aBranch === 'main' && bBranch !== 'main') return -1
    if (bBranch === 'main' && aBranch !== 'main') return 1
    return aBranch.localeCompare(bBranch)
  })
}

function branchesForLocalCard(remoteEntry, currentBranch) {
  const branches = cloneBranchEntries(remoteEntry?.branches)
  const filtered = currentBranch
    ? branches.filter(branch => branch.branch !== currentBranch)
    : branches
  return sortBranchEntries(filtered)
}

function branchTime(branch) {
  const time = Date.parse(branch?.lastModified || '')
  return Number.isFinite(time) ? time : 0
}

function pickHomeBranch(branches) {
  const entries = cloneBranchEntries(branches)
  if (entries.length === 0) return null
  return entries.find(branch => branch.branch === 'main') || entries.sort((a, b) => branchTime(b) - branchTime(a))[0]
}

function branchTitle(branch, fallback) {
  return branch?.title || branch?.name || fallback
}

function createBranchOnlyPrototype(id, remoteEntry) {
  const branches = sortBranchEntries(cloneBranchEntries(remoteEntry?.branches))
  const homeBranch = pickHomeBranch(branches)
  const name = branchTitle(homeBranch, id)

  return {
    id: `branch-proto:${id}`,
    name,
    dirName: id,
    description: homeBranch?.description || null,
    author: null,
    gitAuthor: null,
    lastModified: homeBranch?.lastModified || null,
    icon: null,
    team: null,
    tags: null,
    hideFlows: true,
    folder: homeBranch?.folderName || null,
    isExternal: !!homeBranch?.isExternal,
    externalUrl: homeBranch?.externalUrl || null,
    isPrivate: false,
    flows: [],
    isBranchOnly: true,
    branches,
    homeBranch,
    route: homeBranch?.route || `/${id}`,
  }
}

function createBranchOnlyCanvas(id, remoteEntry) {
  const branches = sortBranchEntries(cloneBranchEntries(remoteEntry?.branches))
  const homeBranch = pickHomeBranch(branches)
  const name = branchTitle(homeBranch, id)

  return {
    id: `branch-canvas:${id}`,
    name,
    dirName: id,
    description: homeBranch?.description || null,
    route: homeBranch?.route || `/canvas/${id}`,
    folder: homeBranch?.folderName || null,
    isCanvas: true,
    isPrivate: false,
    author: null,
    gitAuthor: null,
    _canvasMeta: null,
    _group: null,
    isBranchOnly: true,
    branches,
    homeBranch,
  }
}

function sortByTitle(a, b) {
  return (a?.name || '').localeCompare(b?.name || '')
}

function sortByUpdated(a, b) {
  return branchTime(b) - branchTime(a)
}

function folderByUpdated(a, b) {
  const aItems = [...(a?.prototypes || []), ...(a?.canvases || [])]
  const bItems = [...(b?.prototypes || []), ...(b?.canvases || [])]
  const aMax = Math.max(0, ...aItems.map(branchTime))
  const bMax = Math.max(0, ...bItems.map(branchTime))
  return bMax - aMax
}

function sortedFolder(folder, sortPrototypes, sortCanvases = sortByTitle) {
  return {
    ...folder,
    prototypes: [...(folder.prototypes || [])].sort(sortPrototypes),
    canvases: [...(folder.canvases || [])].sort(sortCanvases),
  }
}

function buildSorted({ folders, prototypes, canvases }) {
  return {
    title: {
      prototypes: [...prototypes].sort(sortByTitle),
      canvases: [...canvases].sort(sortByTitle),
      folders: [...folders].map(folder => sortedFolder(folder, sortByTitle)).sort(sortByTitle),
    },
    updated: {
      prototypes: [...prototypes].sort(sortByUpdated),
      canvases: [...canvases].sort(sortByTitle),
      folders: [...folders].map(folder => sortedFolder(folder, sortByUpdated)).sort(folderByUpdated),
    },
  }
}

export function mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, currentBranch) {
  if (remoteIndex == null) return localIndex

  const baseIndex = localIndex || {}
  const remotePrototypes = remoteIndex.prototypes || {}
  const remoteCanvasesByKey = collapseRemoteCanvases(remoteIndex.canvases)
  const localPrototypeIds = new Set()
  const localCanvasKeys = new Set()

  const enrichPrototype = (proto) => {
    const id = proto?.dirName
    if (id) localPrototypeIds.add(id)
    const remoteEntry = id ? remotePrototypes[id] : null
    if (!remoteEntry) return { ...proto }
    return { ...proto, branches: branchesForLocalCard(remoteEntry, currentBranch) }
  }

  const enrichCanvas = (canvas) => {
    const id = canvas?.dirName
    const key = id ? canvasMatchKey(id) : null
    if (key) localCanvasKeys.add(key)
    const remote = key ? remoteCanvasesByKey.get(key) : null
    if (!remote) return { ...canvas }
    return { ...canvas, branches: branchesForLocalCard(remote.entry, currentBranch) }
  }

  const folders = (baseIndex.folders || []).map(folder => ({
    ...folder,
    prototypes: (folder.prototypes || []).map(enrichPrototype),
    canvases: (folder.canvases || []).map(enrichCanvas),
  }))
  const prototypes = (baseIndex.prototypes || []).map(enrichPrototype)
  const canvases = (baseIndex.canvases || []).map(enrichCanvas)

  for (const [id, remoteEntry] of Object.entries(remotePrototypes)) {
    if (!localPrototypeIds.has(id)) prototypes.push(createBranchOnlyPrototype(id, remoteEntry))
  }

  for (const [key, { id, entry }] of remoteCanvasesByKey) {
    if (!localCanvasKeys.has(key)) canvases.push(createBranchOnlyCanvas(id, entry))
  }

  return {
    ...baseIndex,
    folders,
    prototypes,
    canvases,
    globalFlows: [...(baseIndex.globalFlows || [])],
    sorted: buildSorted({ folders, prototypes, canvases }),
  }
}
