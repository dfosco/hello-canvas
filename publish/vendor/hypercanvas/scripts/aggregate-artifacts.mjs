#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const INDEX_FILENAME = 'artifacts.index.json'
const TMP_FILENAME = '.artifacts.index.json.tmp'
const SCHEMA_VERSION = 1

function compareBranchNames(a, b) {
  if (a.branch === 'main' && b.branch !== 'main') return -1
  if (b.branch === 'main' && a.branch !== 'main') return 1
  return String(a.branch || '').localeCompare(String(b.branch || ''))
}

function withTrailingSlash(folder) {
  if (!folder) return ''
  return folder.endsWith('/') ? folder : `${folder}/`
}

/**
 * Folder-independent identity for a canvas, mirroring prototype `dirName`
 * matching. Keeps cross-branch dedup stable when a canvas moves between
 * folders (or root ↔ folder). Proto-scoped canvases retain their prototype
 * segment so same-named canvases in different prototypes never collide.
 */
function canvasMatchKey(id) {
  let raw = String(id || '')
  let isProto = false
  if (raw.startsWith('proto:')) {
    isProto = true
    raw = raw.slice('proto:'.length)
  }
  const segments = raw.split('/').filter(Boolean)
  const name = segments[segments.length - 1] || raw
  if (isProto) {
    const scope = segments.length >= 2 ? segments[segments.length - 2] : ''
    return scope ? `proto:${scope}/${name}` : `proto:${name}`
  }
  return name
}

function generatedAtMs(manifest) {
  const value = Date.parse(manifest?.generatedAt || '')
  return Number.isNaN(value) ? 0 : value
}

function deriveFolder(manifest, dir, ghPagesDir) {
  if (dir === ghPagesDir) return ''
  if (typeof manifest.folder === 'string') return manifest.folder
  return path.basename(dir)
}

function deriveBranch(manifest, folder) {
  if (!folder) return 'main'
  if (typeof manifest.branch === 'string' && manifest.branch) return manifest.branch
  return manifest.deployBranch || folder.replace(/^branch--/, '')
}

function deriveDeployBranch(manifest, branch, folder) {
  if (!folder || branch === 'main') return 'main'
  if (typeof manifest.deployBranch === 'string' && manifest.deployBranch) return manifest.deployBranch
  return folder.replace(/^branch--/, '')
}

function readManifest(dir) {
  const manifestPath = path.join(dir, 'artifacts.json')
  const label = path.basename(dir) || dir

  let raw
  try {
    raw = fs.readFileSync(manifestPath, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.info(`[aggregate-artifacts] Skipping ${label}: artifacts.json not found`)
      return { manifest: null, readError: false }
    }
    console.warn(`[aggregate-artifacts] Skipping ${label}: could not read artifacts.json (${err.message})`)
    return { manifest: null, readError: true }
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (err) {
    console.warn(`[aggregate-artifacts] Skipping ${label}: malformed artifacts.json (${err.message})`)
    return { manifest: null, readError: false }
  }

  if (manifest?.schemaVersion !== SCHEMA_VERSION) {
    console.warn(`[aggregate-artifacts] Skipping ${label}: unsupported schemaVersion ${manifest?.schemaVersion}`)
    return { manifest: null, readError: false }
  }

  return { manifest, readError: false }
}

function listManifestDirs(ghPagesDir) {
  const entries = fs.readdirSync(ghPagesDir, { withFileTypes: true })
  const branchDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('branch--'))
    .map(entry => path.join(ghPagesDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))

  return [ghPagesDir, ...branchDirs]
}

function collectManifests(ghPagesDir) {
  const manifestsByFolder = new Map()
  let readErrorCount = 0

  for (const dir of listManifestDirs(ghPagesDir)) {
    const { manifest, readError } = readManifest(dir)
    if (readError) readErrorCount += 1
    if (!manifest) continue

    const folder = deriveFolder(manifest, dir, ghPagesDir)
    const current = { manifest, dir, folder }
    const previous = manifestsByFolder.get(folder)

    if (!previous) {
      manifestsByFolder.set(folder, current)
      continue
    }

    const previousBranch = deriveBranch(previous.manifest, previous.folder)
    const currentBranch = deriveBranch(manifest, folder)
    const keepCurrent = generatedAtMs(manifest) > generatedAtMs(previous.manifest)
    const keptBranch = keepCurrent ? currentBranch : previousBranch

    console.warn(
      `[aggregate-artifacts] Branch folder collision for "${folder || '(root)'}" between "${previousBranch}" and "${currentBranch}"; keeping "${keptBranch}"`,
    )

    if (keepCurrent) manifestsByFolder.set(folder, current)
  }

  if (readErrorCount > 1) {
    throw new Error(`Failed to read ${readErrorCount} artifacts manifests; preserving existing ${INDEX_FILENAME}`)
  }

  const manifests = [...manifestsByFolder.values()]
  if (manifests.length === 0) {
    throw new Error(`No readable artifacts.json manifests found; preserving existing ${INDEX_FILENAME}`)
  }

  return manifests
}

function addPrototype(index, manifestInfo, item) {
  const id = item?.artifactId || item?.id
  if (!id) return

  const { manifest, folder } = manifestInfo
  const branch = deriveBranch(manifest, folder)
  const key = String(id)

  if (!index.prototypes[key]) {
    index.prototypes[key] = { id: key, branches: [] }
  }

  index.prototypes[key].branches.push({
    branch,
    folder: withTrailingSlash(folder),
    title: item.title ?? item.id ?? key,
    route: item.route ?? null,
    isExternal: Boolean(item.isExternal),
    externalUrl: item.externalUrl ?? null,
    folderName: item.folder ?? null,
    sha: manifest.sha ?? null,
    lastModified: item.lastModified ?? null,
  })
}

function addCanvas(index, manifestInfo, item) {
  const id = item?.artifactId || item?.id
  if (!id) return

  const { manifest, folder } = manifestInfo
  const branch = deriveBranch(manifest, folder)
  const key = canvasMatchKey(id)

  if (!index.canvases[key]) {
    index.canvases[key] = { id: key, branches: [] }
  }

  index.canvases[key].branches.push({
    branch,
    folder: withTrailingSlash(folder),
    name: item.name ?? item.id ?? key,
    route: item.route ?? null,
    folderName: item.folder ?? null,
    sha: manifest.sha ?? null,
    lastModified: item.lastModified ?? null,
  })
}

function sortArtifactMap(map) {
  const sorted = {}

  for (const key of Object.keys(map).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = {
      ...map[key],
      branches: [...map[key].branches].sort(compareBranchNames),
    }
  }

  return sorted
}

function buildIndex(manifests) {
  const index = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    branches: [],
    prototypes: {},
    canvases: {},
  }

  for (const manifestInfo of manifests) {
    const { manifest, folder } = manifestInfo
    const branch = deriveBranch(manifest, folder)
    const deployBranch = deriveDeployBranch(manifest, branch, folder)

    index.branches.push({ branch, deployBranch, folder })

    for (const item of Array.isArray(manifest.prototypes) ? manifest.prototypes : []) {
      addPrototype(index, manifestInfo, item)
    }

    for (const item of Array.isArray(manifest.canvases) ? manifest.canvases : []) {
      addCanvas(index, manifestInfo, item)
    }
  }

  index.branches = [...index.branches].sort(compareBranchNames)
  index.prototypes = sortArtifactMap(index.prototypes)
  index.canvases = sortArtifactMap(index.canvases)

  return index
}

function writeIndex(ghPagesDir, index) {
  const targetPath = path.join(ghPagesDir, INDEX_FILENAME)
  const tmpPath = path.join(ghPagesDir, TMP_FILENAME)
  const contents = `${JSON.stringify(index, null, 2)}\n`

  fs.writeFileSync(tmpPath, contents, 'utf8')
  fs.renameSync(tmpPath, targetPath)

  return targetPath
}

function aggregateArtifacts(ghPagesDir) {
  const resolvedDir = path.resolve(ghPagesDir)
  const manifests = collectManifests(resolvedDir)
  const index = buildIndex(manifests)
  return writeIndex(resolvedDir, index)
}

function main() {
  const ghPagesDir = process.argv[2]

  if (!ghPagesDir) {
    console.error('Usage: node aggregate-artifacts.mjs <gh-pages-dir>')
    process.exit(1)
  }

  try {
    const targetPath = aggregateArtifacts(ghPagesDir)
    console.info(`[aggregate-artifacts] Wrote ${targetPath}`)
  } catch (err) {
    console.error(`[aggregate-artifacts] ${err.message}`)
    process.exit(1)
  }
}

main()
