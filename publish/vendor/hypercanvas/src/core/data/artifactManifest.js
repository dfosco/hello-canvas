import { execFileSync } from 'node:child_process'
import process from 'node:process'

export const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function readGitValue(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

export function sanitizeBranchName(branch) {
  return String(branch ?? '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function resolveManifestEnv({ env = process.env, cwd = process.cwd() } = {}) {
  const branch = env.branch || env.GITHUB_REF_NAME || readGitValue(['branch', '--show-current'], cwd) || 'main'
  const deployBranch = env.deployBranch || sanitizeBranchName(branch)
  const folder = env.folder !== undefined
    ? env.folder
    : branch === 'main'
      ? ''
      : `branch--${deployBranch}`
  const sha = env.sha !== undefined
    ? env.sha
    : env.GITHUB_SHA || readGitValue(['rev-parse', 'HEAD'], cwd)

  return {
    branch,
    deployBranch,
    folder,
    sha: sha || null,
    generatedAt: env.generatedAt || isoNow(),
    basePath: env.basePath || env.VITE_BASE_PATH || '/',
  }
}

function asEntries(collection) {
  if (!collection) return []
  if (Array.isArray(collection)) {
    return collection.map((item) => [item?.id || item?.dirName || item?.name, item])
  }
  return Object.entries(collection)
}

function artifactMeta(item) {
  return item?.meta || item?._canvasMeta || {}
}

function isPrivateArtifact(item, id) {
  return Boolean(item?.isPrivate ?? item?._isPrivate) || String(id || '').split('/').includes('drafts')
}

function isCrossBranchEnabled(item) {
  if (item?.crossBranch === false) return false
  return artifactMeta(item)?.crossBranch !== false
}

function normalizeRoute(route) {
  if (!route) return null
  const value = String(route)
  return value.startsWith('/') ? value : `/${value}`
}

function normalizeTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function appendTokens(url, tokens) {
  if (!tokens || typeof tokens !== 'object') return url
  const reserved = new Set(['flow', 'scene'])
  const entries = Object.entries(tokens).filter(
    ([key, value]) => value != null && !reserved.has(key) && typeof value !== 'object',
  )
  if (entries.length === 0) return url
  const separator = url.includes('?') ? '&' : '?'
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  return `${url}${separator}${query}`
}

function resolveFlowRoute(flowKey, flowData = {}) {
  const explicitRoute = flowData.route || flowData.meta?.route || flowData.flowMeta?.route || flowData.sceneMeta?.route
  const baseRoute = normalizeRoute(explicitRoute || flowData._route)
  const route = baseRoute
    ? flowData.meta?.default === true
      ? baseRoute
      : `${baseRoute}?flow=${encodeURIComponent(flowKey)}`
    : `/?flow=${encodeURIComponent(flowKey)}`
  return appendTokens(route, flowData.tokens)
}

function prototypeFlows(discovery, dirName, proto) {
  if (Array.isArray(proto?.flows)) return proto.flows
  return asEntries(discovery?.flows)
    .filter(([flowKey]) => String(flowKey).startsWith(`${dirName}/`))
    .map(([flowKey, flowData]) => ({
      key: flowKey,
      name: String(flowKey).slice(String(dirName).length + 1),
      route: resolveFlowRoute(flowKey, flowData),
      meta: flowData?.meta || flowData?.flowMeta || flowData?.sceneMeta || null,
      data: flowData,
    }))
}

function resolvePrototypeRoute(discovery, dirName, proto, isExternal) {
  if (isExternal) return null
  if (proto?.route) return normalizeRoute(proto.route)
  const flows = prototypeFlows(discovery, dirName, proto)
  const defaultFlow = flows.find((flow) => flow?.meta?.default === true || flow?.data?.meta?.default === true)
  const flow = defaultFlow || flows[0]
  if (flow) return flow.route || resolveFlowRoute(flow.key || flow.name, flow.data || flow)
  return `/${dirName}`
}

function titleCase(value) {
  return String(value || '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function canvasRoute(canvasId, data) {
  return normalizeRoute(data?.route || data?._route) || `/canvas/${canvasId}`
}

function prototypeEntryMap(discovery) {
  const prototypes = new Map()
  for (const [key, proto = {}] of asEntries(discovery?.prototypes)) {
    const dirName = String(proto.dirName || proto.id || key)
    if (dirName) prototypes.set(dirName, proto)
  }
  for (const [flowKey] of asEntries(discovery?.flows)) {
    const slashIdx = String(flowKey).indexOf('/')
    if (slashIdx <= 0) continue
    const dirName = String(flowKey).slice(0, slashIdx)
    if (!prototypes.has(dirName)) prototypes.set(dirName, {})
  }
  return [...prototypes.entries()]
}

function buildPrototypeEntries(discovery) {
  return prototypeEntryMap(discovery)
    .filter(([dirName, proto]) => dirName && !isPrivateArtifact(proto, dirName) && isCrossBranchEnabled(proto))
    .map(([dirName, proto]) => {
      const meta = artifactMeta(proto)
      const isExternal = Boolean(proto.isExternal ?? proto.url ?? proto.externalUrl)
      return {
        id: dirName,
        dirName,
        title: meta.title || proto.title || proto.name || dirName,
        description: meta.description || proto.description || null,
        folder: proto.folder || null,
        isExternal,
        externalUrl: isExternal ? proto.externalUrl || proto.url || null : null,
        route: resolvePrototypeRoute(discovery, dirName, proto, isExternal),
        isPrivate: false,
        crossBranch: true,
        lastModified: normalizeTimestamp(proto.lastModified),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function canvasPageEntry(canvasId, data, isPrivate) {
  const segment = String(canvasId).split('/').pop()
  return {
    id: canvasId,
    name: data?.name || data?.title || titleCase(segment),
    route: canvasRoute(canvasId, data),
    isPrivate,
  }
}

function buildCanvasEntries(discovery) {
  const entries = []
  const seenGroups = new Map()

  for (const [key, data = {}] of asEntries(discovery?.canvases)) {
    const canvasId = String(data.id || data.dirName || key)
    if (!canvasId || isPrivateArtifact(data, canvasId) || !isCrossBranchEnabled(data)) continue

    const meta = artifactMeta(data)
    const group = data.group || data._group || null
    const folder = data.folder || data._folder || null
    const isPrivate = false
    const page = canvasPageEntry(canvasId, data, isPrivate)

    if (group && seenGroups.has(group)) {
      const existing = entries[seenGroups.get(group)]
      if (!existing.pages) {
        existing.pages = [{
          id: existing.id,
          name: existing.name,
          route: existing.route,
          isPrivate: existing.isPrivate,
        }]
      }
      existing.pages.push(page)
      continue
    }

    const pages = Array.isArray(data.pages)
      ? data.pages
        .map((item) => ({ ...item, id: item.id || item.dirName || item.name }))
        .filter((item) => item.id && !isPrivateArtifact(item, item.id))
        .map((item) => ({
          id: item.id,
          name: item.name || item.title || item.id,
          route: canvasRoute(item.id, item),
          isPrivate: false,
        }))
      : null

    const manifestEntry = {
      id: canvasId,
      name: meta.title || data.name || data.title || canvasId,
      folder,
      route: page.route,
      isPrivate,
      crossBranch: true,
      group,
      pages,
      lastModified: normalizeTimestamp(data.lastModified),
    }

    if (group) seenGroups.set(group, entries.length)
    entries.push(manifestEntry)
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id))
}

function buildFolderEntries(discovery) {
  return asEntries(discovery?.folders)
    .map(([key, folder = {}]) => {
      const name = folder.dirName || folder.id || key || folder.name
      return [String(name), folder]
    })
    .filter(([name, folder]) => name && !isPrivateArtifact(folder, name) && isCrossBranchEnabled(folder))
    .map(([name, folder]) => {
      const meta = artifactMeta(folder)
      return {
        name,
        title: folder.title || meta.title || name,
        isPrivate: false,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function buildArtifactManifest({ discovery = {}, env = {} } = {}) {
  const branch = env.branch || 'main'
  const deployBranch = env.deployBranch || sanitizeBranchName(branch)
  const folder = env.folder !== undefined
    ? env.folder
    : branch === 'main'
      ? ''
      : `branch--${deployBranch}`

  return {
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    branch,
    deployBranch,
    folder,
    sha: env.sha ?? null,
    generatedAt: env.generatedAt || isoNow(),
    basePath: env.basePath || '/',
    prototypes: buildPrototypeEntries(discovery),
    canvases: buildCanvasEntries(discovery),
    folders: buildFolderEntries(discovery),
  }
}
