import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
export { normalizeSiteId, normalizeSiteRoute, normalizeSiteUrl, parseSiteUrl, resolveSiteUrl, resolveSiteDevelopmentUrl, sitePreviewPath, siteRouteFromPreviewUrl, siteRouteForUrl } from './contract.js'
import { normalizeSiteId, normalizeSiteUrl } from './contract.js'

export const SITE_FORMAT_VERSION = 1
export const SITE_CONFIG_FILE = '.storyboard/sites.config.json'
const LEGACY_SITE_RUNTIME_FILE = '.storyboard/sites.json'
export const SITE_RUNTIME_FILE = LEGACY_SITE_RUNTIME_FILE

export function isReservedSiteEnvironmentKey(key) {
  return /^(?:HYPERCANVAS|PASEO)_/i.test(String(key || ''))
}

function safeSiteEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isReservedSiteEnvironmentKey(key)))
}


export function normalizeSiteDescriptor(value = {}) {
  const id = normalizeSiteId(value.id)
  const deployments = {}
  for (const [name, deployment] of Object.entries(value.deployments ?? {})) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid Site deployment name: ${name}`)
    deployments[name] = { baseUrl: normalizeSiteUrl(deployment?.baseUrl, { label: `${name} base URL` }) }
  }
  const defaultDeployment = value.defaultDeployment ?? (deployments.production ? 'production' : Object.keys(deployments)[0] ?? null)
  if (defaultDeployment && !deployments[defaultDeployment]) throw new Error(`Unknown default Site deployment: ${defaultDeployment}`)
  return {
    $schema: 'https://schemas.dfosco.dev/hypercanvas/site/v1.json',
    formatVersion: SITE_FORMAT_VERSION,
    id,
    title: String(value.title ?? id),
    defaultDeployment,
    deployments,
    ...(value.description === undefined ? {} : { description: String(value.description ?? '') }),
    capture: { waitUntil: value.capture?.waitUntil ?? 'networkidle', delayMs: bounded(value.capture?.delayMs, 0, 30000, 250) },
  }
}

export function updateSiteDescriptor(current, updates = {}) {
  const next = { ...current }
  if (updates.title !== undefined) next.title = updates.title
  if (updates.description !== undefined) next.description = updates.description
  if (updates.deployments !== undefined) next.deployments = updates.deployments
  if (updates.defaultDeployment !== undefined) next.defaultDeployment = updates.defaultDeployment
  const productionBaseUrl = updates.productionBaseUrl !== undefined ? updates.productionBaseUrl : updates.deployUrl
  if (productionBaseUrl !== undefined) {
    const deployments = { ...(next.deployments || {}) }
    if (productionBaseUrl === null || String(productionBaseUrl).trim() === '') delete deployments.production
    else deployments.production = { ...deployments.production, baseUrl: String(productionBaseUrl).trim() }
    next.deployments = deployments
    if (next.defaultDeployment === 'production' && !deployments.production) {
      next.defaultDeployment = Object.keys(deployments)[0] ?? null
    }
  }
  return normalizeSiteDescriptor(next)
}

export function normalizeSiteBinding(value = {}) {
  const source = value.source ?? (value.startCommand || value.root || value.workspaceId || value.scriptName ? 'managed' : 'url')
  if (!['url', 'managed'].includes(source)) throw new Error(`Unsupported Site source: ${source}`)
  const developmentBaseUrl = value.developmentBaseUrl ? normalizeSiteUrl(value.developmentBaseUrl, { loopbackOnly: true, label: 'development base URL' }) : null
  if (!developmentBaseUrl && source !== 'managed') throw new Error('Missing required development base URL')
  return {
    source,
    ...(value.workspaceId ? { workspaceId: String(value.workspaceId).trim() } : {}),
    ...(value.scriptName ? { scriptName: String(value.scriptName).trim() } : {}),
    ...(value.serviceName ? { serviceName: String(value.serviceName).trim() } : {}),
    ...(value.root ? { root: path.resolve(value.root) } : {}),
    ...(value.startCommand ? { startCommand: String(value.startCommand).trim() } : {}),
    ...(value.env && typeof value.env === 'object' ? { env: safeSiteEnvironment(value.env) } : {}),
    ...(value.terminalSessionId ? { terminalSessionId: String(value.terminalSessionId).trim() } : {}),
    ...(Number.isInteger(value.legacyPid) && value.legacyPid > 0 ? { legacyPid: value.legacyPid } : {}),
    ...(developmentBaseUrl ? { developmentBaseUrl } : {}),
    status: value.status ?? 'stopped',
    pid: Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    updatedAt: value.updatedAt ?? new Date().toISOString(),
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function runtimePathError() {
  const error = new Error('Notebook runtime path resolves outside its filesystem root.')
  error.code = 'UNSAFE_NOTEBOOK_PATH'
  return error
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveSiteRuntimePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) throw runtimePathError()
  const resolvedRoot = path.resolve(root)
  const runtimeRoot = path.join(resolvedRoot, '.storyboard')
  const destination = path.resolve(runtimeRoot, relativePath)
  if (!isWithinRoot(runtimeRoot, destination)) throw runtimePathError()
  try {
    const runtimeInfo = fs.lstatSync(runtimeRoot)
    if (runtimeInfo.isSymbolicLink() || !isWithinRoot(resolvedRoot, fs.realpathSync.native(runtimeRoot))) throw runtimePathError()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    const destinationInfo = fs.lstatSync(destination)
    if (destinationInfo.isSymbolicLink() || !isWithinRoot(resolvedRoot, fs.realpathSync.native(destination))) throw runtimePathError()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return destination
}

function persistableBinding(value) {
  const binding = normalizeSiteBinding(value)
  const persisted = { ...binding }
  delete persisted.status
  delete persisted.pid
  return persisted
}

function normalizeSiteRecord(value = {}, fallbackId = null) {
  const record = { ...normalizeSiteDescriptor({ ...value, id: value?.id ?? fallbackId }) }
  if (isRecord(value?.binding) && Object.keys(value.binding).length > 0) {
    try { record.binding = persistableBinding(value.binding) } catch { /* preserve the descriptor if its local binding is incomplete */ }
  }
  return record
}

function mergeSiteRecords(legacyDescriptor, currentRecord, legacyBinding) {
  const descriptor = normalizeSiteDescriptor({ ...(legacyDescriptor || {}), ...(currentRecord || {}) })
  const binding = { ...(legacyBinding || {}), ...(legacyDescriptor?.binding || {}), ...(currentRecord?.binding || {}) }
  const record = { ...descriptor }
  if (Object.keys(binding).length > 0) {
    try { record.binding = persistableBinding(binding) } catch { /* keep an incomplete legacy binding out of the new config */ }
  }
  return record
}

export class SiteStore {
  constructor(notebookRoot) {
    this.root = fs.realpathSync.native(path.resolve(notebookRoot))
    this.legacySiteDescriptorsRoot = path.join(this.root, 'sites')
    this.resolveRuntimePath = relativePath => resolveSiteRuntimePath(this.root, relativePath)
    this.configPath = this.resolveRuntimePath('sites.config.json')
    this.legacyRuntimePath = this.resolveRuntimePath('sites.json')
    this.legacyRuntimeStates = new Map()
  }

  list() {
    return Object.values(this.readState().sites).map(record => normalizeSiteDescriptor(record)).sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id) {
    const record = this.readState().sites[normalizeSiteId(id)]
    return record ? normalizeSiteDescriptor(record) : null
  }

  upsert(value) {
    const site = normalizeSiteDescriptor(value)
    const state = this.readState({ migrateLegacy: true })
    const current = state.sites[site.id]
    const binding = value?.binding ? persistableBinding(value.binding) : current?.binding
    state.sites[site.id] = { ...site, ...(binding ? { binding } : {}) }
    this.writeState(state.sites)
    return site
  }

  remove(id) {
    const siteId = normalizeSiteId(id)
    const state = this.readState({ migrateLegacy: true })
    const existed = Boolean(state.sites[siteId])
    if (!existed) return false
    delete state.sites[siteId]
    this.writeState(state.sites)
    return existed
  }

  getBinding(id) {
    const siteId = normalizeSiteId(id)
    const binding = this.readState().sites[siteId]?.binding
    if (!binding) return null
    return normalizeSiteBinding({ ...binding, ...(this.legacyRuntimeStates.get(siteId) || {}) })
  }

  upsertBinding(id, value) {
    const siteId = normalizeSiteId(id)
    const reservedKeys = Object.keys(value?.env || {}).filter(isReservedSiteEnvironmentKey)
    if (reservedKeys.length) {
      const error = new Error(`Site environment cannot override reserved Core/Paseo variables: ${reservedKeys.join(', ')}`)
      error.code = 'SITE_RESERVED_ENVIRONMENT'
      throw error
    }
    const state = this.readState({ migrateLegacy: true })
    const currentRecord = state.sites[siteId] ?? normalizeSiteRecord({ id: siteId, title: siteId })
    const current = currentRecord.binding ?? { source: 'managed' }
    const hasPersistentUpdates = Object.keys(value || {}).some(key => key !== 'status' && key !== 'pid')
    const binding = normalizeSiteBinding({
      ...current,
      ...value,
      revision: value?.revision ?? ((current.revision ?? 0) + (hasPersistentUpdates ? 1 : 0)),
    })
    if (hasPersistentUpdates) {
      currentRecord.binding = persistableBinding(binding)
      state.sites[siteId] = currentRecord
      this.writeState(state.sites)
    }
    return binding
  }

  removeBinding(id) {
    const siteId = normalizeSiteId(id)
    const state = this.readState({ migrateLegacy: true })
    const record = state.sites[siteId]
    if (!record?.binding && !this.legacyRuntimeStates.has(siteId)) return false
    if (record?.binding) {
      delete record.binding
      this.writeState(state.sites)
    }
    this.legacyRuntimeStates.delete(siteId)
    return true
  }

  bindings() {
    const sites = this.readState().sites
    return Object.fromEntries(Object.keys(sites)
      .filter(id => sites[id].binding)
      .map(id => [id, this.getBinding(id)]))
  }

  readState({ migrateLegacy = false } = {}) {
    const configPath = this.resolveRuntimePath('sites.config.json')
    const legacyRuntimePath = this.resolveRuntimePath('sites.json')
    this.configPath = configPath
    this.legacyRuntimePath = legacyRuntimePath
    const config = readJson(configPath, { formatVersion: SITE_FORMAT_VERSION, sites: {} })
    const sites = {}
    for (const [id, value] of Object.entries(isRecord(config?.sites) ? config.sites : {})) {
      const record = normalizeSiteRecord(value, id)
      sites[record.id] = record
    }

    const legacyRuntime = readJson(legacyRuntimePath, null)
    const legacyBindings = {}
    for (const [rawId, rawBinding] of Object.entries(isRecord(legacyRuntime?.sites) ? legacyRuntime.sites : {})) {
      try {
        const id = normalizeSiteId(rawId)
        const binding = isRecord(rawBinding) ? { ...rawBinding } : {}
        this.legacyRuntimeStates.set(id, binding)
        const active = binding.status === 'running' || binding.status === 'starting'
        if (active && !binding.scriptName && !binding.terminalSessionId && binding.workspaceId && binding.root) {
          binding.terminalSessionId = `site:${id}`
        }
        if (active && Number.isInteger(binding.pid) && binding.pid > 0) binding.legacyPid = binding.pid
        legacyBindings[id] = binding
      } catch { /* ignore an invalid legacy key */ }
    }

    const migratedDescriptors = []
    const descriptorFiles = isDirectory(this.legacySiteDescriptorsRoot)
      ? fs.readdirSync(this.legacySiteDescriptorsRoot).filter(name => name.endsWith('.site.json')).sort()
      : []
    for (const name of descriptorFiles) {
      const file = path.join(this.legacySiteDescriptorsRoot, name)
      const raw = readJson(file, null)
      if (!isRecord(raw)) continue
      const legacy = normalizeSiteDescriptor(raw)
      sites[legacy.id] = mergeSiteRecords(legacy, sites[legacy.id], legacyBindings[legacy.id])
      migratedDescriptors.push(file)
    }

    for (const [id, binding] of Object.entries(legacyBindings)) {
      if (sites[id] || !isRecord(binding)) continue
      try {
        const descriptor = normalizeSiteDescriptor({ id, title: binding.title || id })
        sites[descriptor.id] = mergeSiteRecords(descriptor, null, binding)
      } catch { /* keep malformed legacy records out of the new config */ }
    }

    const hasLegacyRuntime = isRecord(legacyRuntime) && isRecord(legacyRuntime.sites)
    if (migrateLegacy && (migratedDescriptors.length || hasLegacyRuntime)) {
      this.writeState(sites)
      for (const file of migratedDescriptors) fs.rmSync(file, { force: true })
      if (hasLegacyRuntime) fs.rmSync(legacyRuntimePath, { force: true })
      try { fs.rmdirSync(this.legacySiteDescriptorsRoot) } catch { /* leave unrelated content in the legacy folder */ }
    }

    return { formatVersion: SITE_FORMAT_VERSION, sites }
  }

  migrateLegacy() {
    return this.readState({ migrateLegacy: true })
  }

  getLegacyRuntimeState(id) {
    const siteId = normalizeSiteId(id)
    return this.legacyRuntimeStates.get(siteId) ?? null
  }

  clearLegacyRuntimeState(id) {
    this.legacyRuntimeStates.delete(normalizeSiteId(id))
  }

  writeState(sites) {
    const configPath = this.resolveRuntimePath('sites.config.json')
    this.configPath = configPath
    const persistedSites = {}
    for (const [id, value] of Object.entries(sites || {})) {
      const record = normalizeSiteRecord(value, id)
      persistedSites[record.id] = record
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    ensureRuntimeDirectoryIgnored(this.root)
    writeJsonAtomic(configPath, { formatVersion: SITE_FORMAT_VERSION, sites: persistedSites })
  }
}

export function siteIdForTitle(title, store) {
  const base = String(title || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
  if (!base) throw new Error('Site name must contain letters or numbers')
  let id = base
  for (let suffix = 2; store.get(id); suffix++) id = `${base.slice(0, 64 - String(suffix).length - 1)}-${suffix}`
  return id
}

export function assertExternalSiteRoot(notebookRoot, root) {
  const resolvedNotebookRoot = fs.realpathSync.native(path.resolve(notebookRoot))
  const resolved = fs.realpathSync.native(path.resolve(root))
  if (isWithinRoot(resolvedNotebookRoot, resolved)) {
    const error = new Error('Site directories must be outside the Notebook')
    error.code = 'SITE_ROOT_INSIDE_NOTEBOOK'
    throw error
  }
  return resolved
}

export function assertAvailableSiteRoot(store, root, exceptId = null) {
  const resolved = store?.root
    ? assertExternalSiteRoot(store.root, root)
    : fs.realpathSync.native(path.resolve(root))
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Select a directory')
  for (const site of store.list()) {
    if (site.id === exceptId) continue
    const boundRoot = store.getBinding(site.id)?.root
    if (!boundRoot) continue
    try {
      if (fs.realpathSync.native(boundRoot) === resolved) throw new Error('This directory is already registered as a Site')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return resolved
}

export function detectSiteConfiguration(root) {
  const projectRoot = path.resolve(String(root ?? '.'))
  const findings = []
  const packagePath = path.join(projectRoot, 'package.json')
  const packageData = isFile(packagePath) ? readJson(packagePath, {}) : null
  let startCommand = null
  let framework = null
  let defaultPort = null

  if (packageData) {
    const scripts = packageData.scripts ?? {}
    const preferred = ['dev', 'start', 'serve'].find(name => typeof scripts[name] === 'string')
    const manager = packageManagerFor(packageData)
    const dependencies = { ...(packageData.dependencies ?? {}), ...(packageData.devDependencies ?? {}) }
    framework = detectNodeFramework(dependencies, preferred ? scripts[preferred] : '')
    if (preferred) {
      startCommand = packageScriptCommand(manager, preferred)
      findings.push({ kind: 'start-command', value: startCommand, reason: `package.json declares a ${preferred} script` })
    } else if (framework) {
      startCommand = packageBinaryCommand(manager, framework.binary, framework.args)
      findings.push({ kind: 'start-command', value: startCommand, reason: `package.json includes ${framework.package}` })
    }
    if (framework) {
      defaultPort = framework.port
      findings.push({ kind: 'framework', value: framework.name, reason: `package.json includes ${framework.package}` })
    }
    defaultPort = numericPort(packageData.port) || numericPort(packageData.config?.port) || defaultPort
  }

  const packageConfigText = [
    'vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cjs',
    'astro.config.js', 'astro.config.mjs', 'astro.config.ts', 'nuxt.config.js', 'nuxt.config.ts',
    '.env', '.env.local', '.env.development',
  ].map(name => readText(path.join(projectRoot, name))).filter(Boolean).join('\n')
  const configPort = portFromText(packageConfigText)
  const commandText = packageData?.scripts?.dev || packageData?.scripts?.start || packageData?.scripts?.serve || startCommand || ''

  if (!startCommand) {
    const python = detectPythonSite(projectRoot)
    if (python) {
      startCommand = python.command
      defaultPort = python.port
      findings.push({ kind: 'start-command', value: python.command, reason: python.reason })
      findings.push({ kind: 'framework', value: python.framework, reason: python.reason })
    }
  }

  if (!startCommand) {
    const rust = detectRustSite(projectRoot)
    if (rust) {
      startCommand = rust.command
      defaultPort = rust.port
      findings.push({ kind: 'start-command', value: rust.command, reason: rust.reason })
      findings.push({ kind: 'framework', value: rust.framework, reason: rust.reason })
    }
  }

  if (!startCommand && isFile(path.join(projectRoot, 'index.html'))) {
    startCommand = 'python3 -m http.server 8000 --bind 127.0.0.1'
    defaultPort = 8000
    findings.push({ kind: 'start-command', value: startCommand, reason: 'index.html can be served as a static Site' })
    findings.push({ kind: 'framework', value: 'Static HTML', reason: 'index.html exists' })
  }

  const port = portFromText(commandText) || configPort || defaultPort
  if (port) findings.push({ kind: 'local-url', value: `http://127.0.0.1:${port}/`, reason: 'Expected local development URL from the detected command or framework defaults' })
  for (const [file, provider] of [['vercel.json', 'Vercel'], ['netlify.toml', 'Netlify'], ['wrangler.toml', 'Cloudflare']]) if (isFile(path.join(projectRoot, file))) findings.push({ kind: 'provider', value: provider, reason: `${file} exists` })
  return { root: projectRoot, findings }
}

function packageManagerFor(pkg) {
  const name = String(pkg?.packageManager || 'npm').split('@')[0]
  return ['npm', 'pnpm', 'yarn', 'bun'].includes(name) ? name : 'npm'
}

function packageScriptCommand(manager, script) {
  if (manager === 'yarn') return `yarn ${script}`
  if (manager === 'bun') return `bun run ${script}`
  return `${manager} run ${script}`
}

function packageBinaryCommand(manager, binary, args) {
  if (manager === 'pnpm') return `pnpm exec ${binary} ${args}`
  if (manager === 'yarn') return `yarn ${binary} ${args}`
  if (manager === 'bun') return `bunx ${binary} ${args}`
  return `npx ${binary} ${args}`
}

function detectNodeFramework(dependencies, script = '') {
  const names = Object.keys(dependencies || {})
  const byDependency = [
    { package: 'next', name: 'Next.js', port: 3000, binary: 'next', args: 'dev --hostname 127.0.0.1' },
    { package: 'nuxt', name: 'Nuxt', port: 3000, binary: 'nuxt', args: 'dev --host 127.0.0.1' },
    { package: 'astro', name: 'Astro', port: 4321, binary: 'astro', args: 'dev --host 127.0.0.1' },
    { package: '@remix-run/dev', name: 'Remix', port: 3000, binary: 'remix', args: 'vite:dev --host 127.0.0.1' },
    { package: 'react-scripts', name: 'Create React App', port: 3000, binary: 'react-scripts', args: 'start' },
    { package: 'vite', name: 'Vite', port: 5173, binary: 'vite', args: '--host 127.0.0.1' },
  ].find(item => names.includes(item.package))
  if (byDependency) return byDependency
  const source = String(script || '')
  if (/(?:^|\s)(?:npx\s+)?vite(?:\s|$)/.test(source)) return { package: 'vite', name: 'Vite', port: 5173, binary: 'vite', args: '--host 127.0.0.1' }
  if (/(?:^|\s)(?:npx\s+)?next(?:\s|$)/.test(source)) return { package: 'next', name: 'Next.js', port: 3000, binary: 'next', args: 'dev --hostname 127.0.0.1' }
  return null
}

function detectPythonSite(root) {
  const managePath = path.join(root, 'manage.py')
  if (isFile(managePath)) {
    const port = portFromText(readText(managePath)) || 8000
    return { command: `python3 manage.py runserver 127.0.0.1:${port}`, port, framework: 'Django', reason: 'manage.py identifies a Django project' }
  }
  const metadata = ['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py']
    .map(file => readText(path.join(root, file)))
    .filter(Boolean)
    .join('\n')
  if (!metadata) return null
  if (/\bfastapi\b/i.test(metadata)) {
    const module = isFile(path.join(root, 'main.py')) ? 'main' : isFile(path.join(root, 'app.py')) ? 'app' : null
    if (!module) return null
    const port = portFromText(metadata) || portFromText(readText(path.join(root, `${module}.py`))) || 8000
    return { command: `python3 -m uvicorn ${module}:app --host 127.0.0.1 --port ${port}`, port, framework: 'FastAPI', reason: 'Python metadata includes FastAPI' }
  }
  if (/\bflask\b/i.test(metadata)) {
    const module = isFile(path.join(root, 'app.py')) ? 'app' : isFile(path.join(root, 'main.py')) ? 'main' : null
    if (!module) return null
    const port = portFromText(readText(path.join(root, `${module}.py`))) || 5000
    return { command: `python3 -m flask --app ${module} run --host 127.0.0.1 --port ${port}`, port, framework: 'Flask', reason: 'Python metadata includes Flask' }
  }
  return null
}

function detectRustSite(root) {
  const manifest = readText(path.join(root, 'Cargo.toml'))
  if (!manifest) return null
  const source = readText(path.join(root, 'src', 'main.rs')) || readText(path.join(root, 'src', 'lib.rs')) || ''
  const frameworks = [
    { package: 'axum', name: 'Axum', port: 3000 },
    { package: 'actix-web', name: 'Actix Web', port: 8080 },
    { package: 'rocket', name: 'Rocket', port: 8000 },
    { package: 'warp', name: 'Warp', port: 3030 },
    { package: 'poem', name: 'Poem', port: 3000 },
    { package: 'salvo', name: 'Salvo', port: 5800 },
  ]
  const framework = frameworks.find(item => new RegExp(`(?:^|[\\s"'])${item.package.replace('-', '[-_]')}\\s*=`, 'mi').test(manifest))
  if (!framework) return null
  const port = portFromText(source) || portFromText(manifest) || framework.port
  return { command: 'cargo run', port, framework: framework.name, reason: `Cargo.toml includes ${framework.package}` }
}

function portFromText(value) {
  const text = String(value || '')
  const matches = [
    text.match(/\bPORT\s*=\s*["']?(\d{2,5})/i),
    text.match(/(?:--port|-p)(?:=|\s+)(\d{2,5})/i),
    text.match(/\bport\s*[:=]\s*["']?(\d{2,5})/i),
    text.match(/(?:127\.0\.0\.1|0\.0\.0\.0|localhost):(\d{2,5})/i),
  ]
  return matches.map(match => numericPort(match?.[1])).find(Boolean) || null
}

function numericPort(value) {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function ensureRuntimeDirectoryIgnored(root) {
  const ignorePath = path.join(root, '.gitignore')
  let current = ''
  try { current = fs.readFileSync(ignorePath, 'utf8') } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const existingRules = new Set(current.split(/\r?\n/).map(line => line.trim()))
  if (['.storyboard/', '.storyboard', '/.storyboard/', '/.storyboard', '.storyboard/**', '/.storyboard/**', '**/.storyboard/**'].some(rule => existingRules.has(rule))) return
  fs.writeFileSync(ignorePath, `${current}${current && !current.endsWith('\n') ? '\n' : ''}.storyboard/\n`)
}

function bounded(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback }
function isFile(file) { try { return fs.statSync(file).isFile() } catch { return false } }
function isDirectory(file) { try { return fs.statSync(file).isDirectory() } catch { return false } }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
function writeJsonAtomic(file, value) { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(tmp, file) }
