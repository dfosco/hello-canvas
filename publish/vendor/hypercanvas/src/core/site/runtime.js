import { spawn } from 'node:child_process'
import process from 'node:process'
import { execFile as execFileCallback } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { assertExternalSiteRoot, isReservedSiteEnvironmentKey, normalizeSiteUrl } from './site.js'

const DEFAULT_TIMEOUT = 1500
const MAX_LOG_LINES = 200
const MAX_TERMINAL_LOG_CHARS = 64_000
const execFile = promisify(execFileCallback)
const RESERVED_PTY_ENVIRONMENT = Object.freeze({
  HYPERCANVAS_CORE_SESSION_SECRET: '',
  HYPERCANVAS_LAUNCH_TOKEN: '',
  HYPERCANVAS_APP_STATE_DIR: '',
  PASEO_PASSWORD: '',
  PASEO_DAEMON_PASSWORD: '',
  PASEO_DAEMON_AUTH_HEADER: '',
  PASEO_HOME: '',
  PASEO_LISTEN: '',
  PASEO_WORKSPACE_ID: '',
})

function siteRootError() {
  const error = new Error('Site directory changed or is unavailable: rebind its directory before continuing')
  error.code = 'SITE_REBIND_REQUIRED'
  return error
}

function canonicalSiteRoot(root) {
  if (typeof root !== 'string' || !root.trim()) throw siteRootError()
  const absolute = path.resolve(root)
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) throw siteRootError()
    const canonical = fs.realpathSync.native(absolute)
    if (!fs.statSync(canonical).isDirectory()) throw siteRootError()
    return canonical
  } catch (error) {
    if (error.code === 'SITE_REBIND_REQUIRED') throw error
    throw siteRootError()
  }
}

function siteEnvironmentOverrides(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const reserved = Object.keys(value).filter(isReservedSiteEnvironmentKey)
  if (reserved.length) {
    const error = new Error(`Site environment cannot override reserved Core/Paseo variables: ${reserved.join(', ')}`)
    error.code = 'SITE_RESERVED_ENVIRONMENT'
    throw error
  }
  return value
}

export function createSiteProcessEnvironment(parentEnvironment = process.env, siteEnvironment = {}) {
  const overrides = siteEnvironmentOverrides(siteEnvironment)
  return Object.fromEntries(
    Object.entries({ ...parentEnvironment, ...overrides })
      .filter(([key]) => !isReservedSiteEnvironmentKey(key)),
  )
}

function createPtySiteEnvironment(siteEnvironment = {}, parentEnvironment = process.env) {
  const inheritedRuntimeKeys = Object.fromEntries(
    Object.keys(parentEnvironment).filter(isReservedSiteEnvironmentKey).map(key => [key, '']),
  )
  return { ...siteEnvironmentOverrides(siteEnvironment), ...inheritedRuntimeKeys, ...RESERVED_PTY_ENVIRONMENT }
}

function startCancelledError() {
  const error = new Error('Site start was cancelled')
  error.code = 'SITE_START_CANCELLED'
  return error
}

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

function isDirectory(directory) {
  try { return fs.statSync(directory).isDirectory() } catch { return false }
}

function quoteShellWord(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

export class SiteRuntime {
  constructor(store, { fetch = globalThis.fetch, probe = probeSite, spawnProcess = spawn, ptyRuntime = null, requirePtyRuntime = true, reconcileOnStart = true, workspaceScripts = null, serviceResolver = null, resolveNotebookWorkspaceId = null, onSiteError = null, listListeningPorts = defaultListeningPorts, inspectProcess = defaultInspectProcess, killProcess = (pid, signal) => process.kill(pid, signal) } = {}) {
    this.store = store
    this.fetch = fetch
    this.probe = probe
    this.spawnProcess = spawnProcess
    this.ptyRuntime = ptyRuntime
    this.requirePtyRuntime = requirePtyRuntime
    this.reconcileOnStart = reconcileOnStart
    this.workspaceScripts = workspaceScripts
    this.serviceResolver = serviceResolver
    this.resolveNotebookWorkspaceId = resolveNotebookWorkspaceId
    this.onSiteError = onSiteError
    this.listListeningPorts = listListeningPorts
    this.inspectProcess = inspectProcess
    this.killProcess = killProcess
    this.processes = new Map()
    this.states = new Map()
    this.logs = new Map()
    this.startTokens = new Map()
    this.startPromises = new Map()
    this.ready = this.reconcileOnStart ? this.reconcilePersistedSites() : Promise.resolve()
  }

  async reconcilePersistedSites() {
    await this.store.migrateLegacy?.()
    for (const site of this.store.list?.() ?? []) {
      const binding = this.store.getBinding(site.id)
      if (binding?.status === 'running' || binding?.status === 'starting' || binding?.terminalSessionId || binding?.legacyPid) {
        if (binding.root && this.resolveNotebookWorkspaceId) {
          try {
            const siteRoot = canonicalSiteRoot(binding.root)
            const workspaceId = await this.resolveNotebookWorkspaceId()
            if (workspaceId && workspaceId !== binding.workspaceId) {
              // Earlier versions bound Site terminals to a Site-specific
              // workspace. Close that exact terminal if it still exists in
              // this Paseo daemon, then clean up server children it left behind.
              // A missing terminal belongs to another daemon (or was started
              // independently), so leave its listener alone.
              if (binding.terminalSessionId) await this.terminatePersistedTerminal(binding, siteRoot)
              this.store.upsertBinding(site.id, { workspaceId, status: 'stopped', terminalSessionId: null, pid: null })
              this.states.set(site.id, { status: 'stopped', token: null })
              continue
            }
          } catch { /* let normal reconciliation report an unavailable root */ }
        }
        try {
          await this.stop(site.id, { forceTerminal: true, preserveExternalListeners: true })
        } catch (error) {
          this.store.upsertBinding(site.id, { status: 'error', pid: null })
          this.states.set(site.id, { status: 'error', token: null })
          this.appendLog(site.id, 'stderr', error.message)
          this.reportSiteError(site.id, error)
        }
      }
    }
  }

  status(id) {
    const binding = this.store.getBinding(id)
    if (!binding) return null
    const child = this.processes.get(id)
    const state = this.states.get(id)
    const status = state?.status || (binding.source === 'url' && binding.developmentBaseUrl ? 'running' : 'stopped')
    const running = status === 'running' && (binding.source === 'url'
      ? Boolean(binding.developmentBaseUrl)
      : Boolean(child && !child.killed || state?.external))
    // A running Site is either served through a Paseo-managed terminal in the
    // Notebook workspace or adopted from an external process discovery found;
    // make both cases distinguishable for visibility and diagnostics.
    const sessionOwnership = binding.terminalSessionId ? 'paseo' : running ? 'adopted' : null
    return { ...binding, status, pid: child?.pid ?? null, running, sessionOwnership, logs: this.getLogs(id) }
  }

  getLogs(id) {
    return [...(this.logs.get(id) ?? [])]
  }

  resolveRoot(id) {
    const binding = this.store.getBinding(id)
    const siteRoot = canonicalSiteRoot(binding?.root)
    return this.store.root ? assertExternalSiteRoot(this.store.root, siteRoot) : siteRoot
  }

  /** Confirmed starts are deduped: an in-flight start is shared with new callers. */
  start(id, { confirmed = false, timeoutMs = DEFAULT_TIMEOUT } = {}) {
    if (!confirmed) return Promise.reject(new Error('Starting a Site requires explicit confirmation'))
    const pending = this.startPromises.get(id)
    if (pending) return pending
    const promise = this.ready
      .then(() => this.performStart(id, { timeoutMs }))
      .finally(() => {
        if (this.startPromises.get(id) === promise) this.startPromises.delete(id)
      })
    this.startPromises.set(id, promise)
    return promise
  }

  async performStart(id, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
    const site = this.store.get(id)
    let binding = this.store.getBinding(id)
    if (!site || !binding) throw new Error(`Site binding not found: ${id}`)
    const siteRoot = this.resolveRoot(id)
    if (binding.source === 'managed' && this.resolveNotebookWorkspaceId) {
      const workspaceId = await this.resolveNotebookWorkspaceId()
      if (!workspaceId) throw new Error(`Paseo did not return a workspace for Site: ${id}`)
      if (workspaceId !== binding.workspaceId) {
        if (this.processes.has(id)) {
          await this.stop(id)
        } else if (binding.terminalSessionId) {
          await this.terminatePersistedTerminal(binding, siteRoot)
        }
        binding = this.store.upsertBinding(id, {
          workspaceId,
          status: 'stopped',
          pid: null,
          terminalSessionId: null,
        })
        this.states.set(id, { status: 'stopped', token: null })
      }
    }
    const childEnvironment = createSiteProcessEnvironment(process.env, binding.env)
    const ptyEnvironment = createPtySiteEnvironment(binding.env, process.env)
    if (!binding.workspaceId) {
      const error = new Error(`Site requires a Paseo workspace rebind: ${id}`)
      error.code = 'SITE_REBIND_REQUIRED'
      throw error
    }
    if (binding.source !== 'managed' || !binding.workspaceId || !binding.root || !binding.startCommand) throw new Error('Managed Site requires a Paseo workspace, project directory, and start command')
    const pty = await Promise.resolve(this.ptyRuntime)
    if (this.requirePtyRuntime && !pty) {
      const error = new Error('Paseo terminal runtime is unavailable; Site servers cannot start outside their workspace terminal')
      error.code = 'PASEO_UNAVAILABLE'
      throw error
    }
    if (pty && this.resolveNotebookWorkspaceId && !this.processes.has(id)) {
      const existing = await discoverSiteServer({
        root: siteRoot, previousBaseUrl: binding.developmentBaseUrl, requireOwnedListener: true,
        timeoutMs: 1000, listListeningPorts: this.listListeningPorts, inspectProcess: this.inspectProcess,
        probe: this.probe, fetch: this.fetch,
      })
      if (existing.baseUrl) {
        this.states.set(id, { status: 'running', token: null, external: true })
        return this.store.upsertBinding(id, { status: 'running', terminalSessionId: null, developmentBaseUrl: existing.baseUrl })
      }
    }
    await this.stop(id)
    this.logs.set(id, [])
    const startToken = Symbol(`site:${id}`)
    this.startTokens.set(id, startToken)
    this.states.set(id, { status: 'starting', token: startToken })
    this.store.upsertBinding(id, { status: 'starting', pid: null, terminalSessionId: null })
    let child = null
    let dependencyMarkerDirectory = null
    let dependencyMarkerFile = null
    let dependenciesReady = true
    let terminalExited = false
    let missingTerminalChecks = 0
    try {
      this.assertStartActive(id, startToken)

      const sessionId = `site:${id}`
      const needsInstall = Boolean(pty)
        && isFile(path.join(siteRoot, 'package.json'))
        && !isDirectory(path.join(siteRoot, 'node_modules'))
      if (needsInstall) {
        dependencyMarkerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-install-'))
        dependencyMarkerFile = path.join(dependencyMarkerDirectory, 'dependencies-ready')
        dependenciesReady = false
      }
      const siteCommand = dependencyMarkerFile
        ? `npm install && touch ${quoteShellWord(dependencyMarkerFile)} && ( ${binding.startCommand} )`
        : binding.startCommand
      this.store.upsertBinding(id, {
        status: 'starting',
        pid: null,
        terminalSessionId: pty ? sessionId : null,
      })
      if (pty) {
        const terminal = await pty.create({
          sessionId,
          cwd: siteRoot,
          workspaceId: binding.workspaceId,
          program: '/bin/sh',
          args: ['-lc', siteCommand],
          env: ptyEnvironment,
        })
        child = { pty, sessionId, workspaceId: binding.workspaceId, cwd: siteRoot, terminalId: terminal?.terminalId || null, pid: null, killed: false, siteStartToken: startToken }
        this.processes.set(id, child)
        this.assertStartActive(id, startToken)
        if (typeof pty.subscribe === 'function') {
          const callbacks = {
            clientId: `site-logs:${id}`,
            onOutput: event => this.appendTerminalOutput(id, Buffer.from(event.bytes || []).toString('utf8')),
            onGap: event => this.appendTerminalOutput(id, event.snapshot?.text || event.snapshot?.screen || ''),
            onError: error => this.appendLog(id, 'stderr', error.message),
            onExit: () => {
              terminalExited = true
              if (this.processes.get(id) === child && this.states.get(id)?.status === 'running') {
                this.states.set(id, { status: 'error', token: startToken })
                this.store.upsertBinding(id, { status: 'error', pid: null })
                this.appendLog(id, 'stderr', 'Site terminal process exited')
                this.reportSiteError(id, new Error('Site terminal process exited'))
              } else if (this.processes.get(id) === child) {
                this.appendLog(id, 'stderr', 'Site terminal exited before becoming healthy')
              }
            },
          }
          try {
            child.terminalSubscription = await pty.subscribe(sessionId, callbacks)
          } catch (error) {
            try {
              const snapshot = await pty.snapshot?.(sessionId)
              this.appendTerminalOutput(id, snapshot?.text || snapshot?.screen || '')
            } catch { /* preserve the original subscription failure */ }
            throw error
          }
          this.assertStartActive(id, startToken)
        }
      } else {
        const workspaceScripts = typeof this.workspaceScripts === 'function'
          ? await this.workspaceScripts()
          : this.workspaceScripts
        if (workspaceScripts && binding.workspaceId && binding.scriptName) {
          const started = await workspaceScripts.startWorkspaceScriptWithStatus(binding.workspaceId, binding.scriptName)
          child = { workspaceScripts, workspaceId: binding.workspaceId, scriptName: binding.scriptName, pid: started?.pid || null, killed: false }
        } else {
          child = this.spawnProcess(binding.startCommand, { cwd: siteRoot, env: childEnvironment, shell: true, detached: true, stdio: 'pipe' })
          child.stdout?.on('data', data => this.appendLog(id, 'stdout', data))
          child.stderr?.on('data', data => this.appendLog(id, 'stderr', data))
          child.once('exit', () => {
            if (this.processes.get(id) !== child) return
            this.processes.delete(id)
            this.states.set(id, { status: 'stopped', token: null })
            this.store.upsertBinding(id, { status: 'stopped', pid: null })
          })
        }
        child.siteStartToken = startToken
        this.processes.set(id, child)
      }

      this.processes.set(id, child)
      this.store.upsertBinding(id, { status: 'starting', pid: child.pid ?? null })
      while (!dependenciesReady) {
        this.assertStartActive(id, startToken)
        if (fs.existsSync(dependencyMarkerFile)) {
          dependenciesReady = true
          break
        }
        if (terminalExited) {
          const error = new Error(`npm install failed before Site ${id} became ready`)
          error.code = 'SITE_INSTALL_FAILED'
          throw error
        }
        if (typeof pty.exists === 'function') {
          const status = await pty.exists(sessionId)
          missingTerminalChecks = status?.exists ? 0 : missingTerminalChecks + 1
          if (missingTerminalChecks >= 3) {
            terminalExited = true
            continue
          }
        }
        await delay(100)
      }
      if (dependencyMarkerDirectory) {
        fs.rmSync(dependencyMarkerDirectory, { recursive: true, force: true })
        dependencyMarkerDirectory = null
        dependencyMarkerFile = null
      }
      if (this.serviceResolver && binding.workspaceId && binding.serviceName) {
        const serviceUrl = await this.serviceResolver(binding.workspaceId, binding.serviceName)
        this.store.upsertBinding(id, { developmentBaseUrl: serviceUrl })
      }
      this.assertStartActive(id, startToken)
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        this.assertStartActive(id, startToken)
        if (terminalExited) {
          const error = new Error(`Site terminal exited before ${id} became healthy`)
          error.code = 'SITE_START_FAILED'
          throw error
        }
        let current = this.store.getBinding(id)
        if (pty && this.resolveNotebookWorkspaceId) {
          const discovery = await discoverSiteServer({
            root: siteRoot, previousBaseUrl: current?.developmentBaseUrl, requireOwnedListener: true,
            timeoutMs: 1000, listListeningPorts: this.listListeningPorts, inspectProcess: this.inspectProcess,
            probe: this.probe, fetch: this.fetch,
          })
          if (discovery.baseUrl && discovery.baseUrl !== current?.developmentBaseUrl) {
            current = this.store.upsertBinding(id, { developmentBaseUrl: discovery.baseUrl })
          }
          if (!discovery.baseUrl) { await delay(200); continue }
        } else if (!current?.developmentBaseUrl) {
          const discovery = await discoverSiteServer({ root: siteRoot, timeoutMs: 250, probe: this.probe, fetch: this.fetch })
          if (discovery.baseUrl) current = this.store.upsertBinding(id, { developmentBaseUrl: discovery.baseUrl })
        }
        if (current?.developmentBaseUrl && (await this.probe(current.developmentBaseUrl, { fetch: this.fetch, timeoutMs: 250 })).reachable) {
          this.assertStartActive(id, startToken)
          this.startTokens.delete(id)
          this.states.set(id, { status: 'running', token: startToken })
          return this.store.upsertBinding(id, { status: 'running', pid: child.pid ?? null })
        }
        await delay(50)
      }
      throw new Error(`Site did not become healthy before timeout: ${id}`)
    } catch (error) {
      const cancelled = error.code === 'SITE_START_CANCELLED' || this.startTokens.get(id) !== startToken
      const activeChild = this.processes.get(id)
      if (activeChild?.siteStartToken === startToken) await this.stop(id).catch(() => {})
      if (cancelled) {
        if (this.states.get(id)?.token === startToken) this.states.set(id, { status: 'stopped', token: null })
        throw startCancelledError()
      }
      this.reportSiteError(id, error)
      if (this.startTokens.get(id) === startToken) {
        this.startTokens.delete(id)
        if (pty) await this.stop(id).catch(() => {})
      }
      this.states.set(id, { status: 'error', token: startToken })
      this.store.upsertBinding(id, { status: 'error', pid: null })
      throw error
    } finally {
      if (dependencyMarkerDirectory) fs.rmSync(dependencyMarkerDirectory, { recursive: true, force: true })
    }
  }

  assertStartActive(id, startToken) {
    if (this.startTokens.get(id) !== startToken) throw startCancelledError()
  }

  reportSiteError(id, error) {
    try { this.onSiteError?.(id, error) } catch { /* reporting must not break Site cleanup */ }
  }

  async stop(id, { forceTerminal = false, preserveExternalListeners = false } = {}) {
    await this.store.migrateLegacy?.()
    const child = this.processes.get(id)
    const binding = this.store.getBinding(id)
    const legacyState = this.store.getLegacyRuntimeState?.(id)
    const legacyPid = binding?.legacyPid ?? legacyState?.pid
    this.startTokens.delete(id)
    try { child?.terminalSubscription?.close() } catch { /* keep stopping the Site process */ }
    let stoppedManagedScript = false
    let terminalClosed = !child?.pty && !binding?.terminalSessionId
    let terminalError = null
    if (!child?.pty && !binding?.terminalSessionId && binding?.workspaceId && binding.scriptName) {
      const scripts = child?.workspaceScripts ?? (typeof this.workspaceScripts === 'function' ? await this.workspaceScripts() : this.workspaceScripts)
      if (scripts) {
        await scripts.stopWorkspaceScript(binding.workspaceId, binding.scriptName)
        stoppedManagedScript = true
      }
    }
    const hasTerminalBinding = child?.pty
      || binding?.terminalSessionId
      || legacyPid
      || (!child && this.ptyRuntime && !stoppedManagedScript && (forceTerminal || ['running', 'starting'].includes(this.states.get(id)?.status) || ['running', 'starting'].includes(binding?.status) || ['running', 'starting'].includes(legacyState?.status)))
    if (hasTerminalBinding) {
      const pty = child?.pty ?? await Promise.resolve(this.ptyRuntime)
      if (pty) {
        try {
          const result = await pty.terminate({
            sessionId: child?.sessionId ?? binding.terminalSessionId ?? `site:${id}`,
            workspaceId: child?.workspaceId ?? binding.workspaceId,
            cwd: child?.cwd ?? binding.root,
          })
          terminalClosed = result?.terminated !== false
        } catch (error) {
          terminalError = error
        }
      } else if (binding?.terminalSessionId) {
        terminalError = Object.assign(new Error('Paseo terminal runtime is unavailable; the Site terminal tab could not be closed'), {
          code: 'PASEO_UNAVAILABLE',
        })
      }
    } else if (!stoppedManagedScript) {
      const pid = child?.pid ?? binding?.pid ?? legacyPid
      if (pid && process.platform !== 'win32') {
        try { process.kill(-pid, 'SIGTERM') } catch (error) {
          if (error.code !== 'ESRCH') throw error
          if (child?.kill) child.kill('SIGTERM')
        }
      } else if (child && !child.killed) {
        child.kill('SIGTERM')
      }
    }
    let legacyPidCleared = false
    if (legacyPid && binding?.root) {
      const legacyProcess = await this.inspectProcess(legacyPid, { timeoutMs: DEFAULT_TIMEOUT }).catch(() => null)
      if (!legacyProcess || !sameOrNested(path.resolve(binding.root), legacyProcess.cwd)) {
        legacyPidCleared = true
      } else {
        try {
          this.killProcess(Number(legacyPid), 'SIGTERM')
          legacyPidCleared = true
        } catch (error) {
          if (error.code === 'ESRCH') legacyPidCleared = true
          else throw error
        }
      }
    }
    // Killing a terminal or workspace script can leave its dev-server child
    // alive (npm, for example, launches the actual server as a descendant).
    // Reconcile listeners still owned by this Site's project root as well.
    let siteRoot = null
    try { if (binding?.root) siteRoot = canonicalSiteRoot(binding.root) } catch { /* missing or replaced roots are not trusted for process scans */ }
    if (siteRoot && (!preserveExternalListeners || child?.pty || legacyPid)) await this.stopSiteListeners(siteRoot)
    if (child) child.killed = true
    this.processes.delete(id)
    this.states.set(id, { status: 'stopped', token: null })
    this.store.clearLegacyRuntimeState?.(id)
    if (this.store.getBinding(id)) {
      const updates = { status: 'stopped', pid: null, ...(legacyPidCleared ? { legacyPid: null } : {}) }
      if (terminalClosed || (preserveExternalListeners && !terminalError)) updates.terminalSessionId = null
      const stopped = this.store.upsertBinding(id, updates)
      if (terminalError) {
        this.reportSiteError(id, terminalError)
        throw terminalError
      }
      return stopped
    }
    if (terminalError) {
      this.reportSiteError(id, terminalError)
      throw terminalError
    }
    return null
  }

  async restart(id, options = {}) {
    return this.start(id, options)
  }

  async stopSiteListeners(siteRoot) {
    const listeners = await this.listListeningPorts({ timeoutMs: DEFAULT_TIMEOUT }).catch(() => [])
    for (const listener of listeners) {
      const inspected = await this.inspectProcess(listener.pid, { timeoutMs: DEFAULT_TIMEOUT }).catch(() => null)
      if (!inspected || !sameOrNested(siteRoot, inspected.cwd)) continue
      try { this.killProcess(Number(listener.pid), 'SIGTERM') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }

  async terminatePersistedTerminal(binding, siteRoot) {
    const pty = await Promise.resolve(this.ptyRuntime)
    if (!pty || !binding?.terminalSessionId) return false
    try {
      const result = await pty.terminate({
        sessionId: binding.terminalSessionId,
        workspaceId: binding.workspaceId,
        cwd: siteRoot,
      })
      if (!result?.terminated) return false
      await this.stopSiteListeners(siteRoot)
      return true
    } catch {
      // The terminal can only be cleaned up from the Paseo daemon that owns it.
      return false
    }
  }

  async discover(id, { timeoutMs = DEFAULT_TIMEOUT, ...options } = {}) {
    const binding = this.store.getBinding(id)
    if (!binding?.root) throw new Error(`Site requires a project root for discovery: ${id}`)
    const siteRoot = this.resolveRoot(id)
    const result = await discoverSiteServer({
      root: siteRoot, previousBaseUrl: binding.developmentBaseUrl, timeoutMs,
      listListeningPorts: this.listListeningPorts, inspectProcess: this.inspectProcess,
      probe: this.probe, fetch: this.fetch, ...options,
    })
    if (result.baseUrl) {
      if (!this.processes.has(id)) this.states.set(id, { status: 'running', token: null, external: true })
      if (result.baseUrl !== binding.developmentBaseUrl || binding.status !== 'running') this.store.upsertBinding(id, { developmentBaseUrl: result.baseUrl, status: 'running' })
    } else if (!this.processes.has(id)) {
      this.states.set(id, { status: 'stopped', token: null })
    }
    return result
  }

  async close() {
    await this.ready
    const ids = new Set([
      ...this.processes.keys(),
      ...(this.store.list?.() ?? [])
        .filter(site => {
          if (this.states.get(site.id)?.external && !this.processes.has(site.id)) return false
          const binding = this.store.getBinding(site.id)
          return ['running', 'starting'].includes(this.states.get(site.id)?.status)
            || ['running', 'starting'].includes(binding?.status)
            || Boolean(binding?.terminalSessionId || binding?.legacyPid)
        })
        .map(site => site.id),
    ])
    await Promise.all([...ids].map(id => this.stop(id)))
  }

  appendLog(id, stream, data) {
    const lines = String(data ?? '').split(/\r?\n/).filter(Boolean)
    if (!lines.length) return
    const next = [...(this.logs.get(id) ?? []), ...lines.map(message => ({ stream, message, timestamp: new Date().toISOString() }))]
    this.logs.set(id, next.slice(-MAX_LOG_LINES))
  }

  appendTerminalOutput(id, data) {
    const text = String(data ?? '')
    if (!text.trim()) return
    const current = [...(this.logs.get(id) ?? [])]
    const last = current.at(-1)
    const combined = last?.stream === 'terminal' ? `${last.message}${text}` : text
    const truncated = combined.length > MAX_TERMINAL_LOG_CHARS
      ? `… terminal output truncated …\n${combined.slice(-MAX_TERMINAL_LOG_CHARS)}`
      : combined
    const entry = { stream: 'terminal', message: truncated, timestamp: new Date().toISOString() }
    if (last?.stream === 'terminal') current[current.length - 1] = entry
    else current.push(entry)
    this.logs.set(id, current.slice(-MAX_LOG_LINES))
  }
}

export async function probeSite(baseUrl, { fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(timeoutMs) })
    return { reachable: true, ok: Boolean(response.ok), status: response.status }
  } catch (error) {
    return { reachable: false, error: error?.message ?? String(error) }
  }
}

export async function rebindSite(store, id, { workspaceId, developmentBaseUrl }, { probe = probeSite, fetch = globalThis.fetch } = {}) {
  if (!workspaceId || typeof workspaceId !== 'string') throw new Error('Site workspaceId is required')
  const normalized = normalizeSiteUrl(developmentBaseUrl, { loopbackOnly: true, label: 'development base URL' })
  if (!(await probe(normalized, { fetch })).reachable) throw new Error(`Site URL is not reachable: ${normalized}`)
  return store.upsertBinding(id, { workspaceId, developmentBaseUrl: normalized, status: 'running' })
}

export async function discoverSiteServer({ root, previousBaseUrl = null, requireOwnedListener = false, timeoutMs = DEFAULT_TIMEOUT, listListeningPorts = defaultListeningPorts, inspectProcess = defaultInspectProcess, probe = probeSite, fetch = globalThis.fetch } = {}) {
  const resolvedRoot = path.resolve(String(root || '.'))
  if (!requireOwnedListener && previousBaseUrl && (await probe(previousBaseUrl, { fetch, timeoutMs })).reachable) return { state: 'current', baseUrl: normalizeSiteUrl(previousBaseUrl, { loopbackOnly: true }), candidates: [] }
  const listeners = await listListeningPorts({ timeoutMs })
  const candidates = []
  for (const listener of listeners) {
    let inspected
    try { inspected = await inspectProcess(listener.pid, { timeoutMs }) } catch { continue }
    if (!sameOrNested(resolvedRoot, inspected?.cwd)) continue
    const urls = [
      normalizeSiteUrl(`http://127.0.0.1:${listener.port}/`, { loopbackOnly: true }),
      normalizeSiteUrl(`http://localhost:${listener.port}/`, { loopbackOnly: true }),
    ]
    let baseUrl = urls[0]
    let health = await probe(baseUrl, { fetch, timeoutMs })
    if (!health.reachable) {
      baseUrl = urls[1]
      health = await probe(baseUrl, { fetch, timeoutMs })
    }
    if (health.reachable) candidates.push({ ...listener, ...inspected, baseUrl, ...health })
  }
  if (previousBaseUrl) {
    const previous = candidates.find(candidate => new URL(candidate.baseUrl).port === new URL(previousBaseUrl).port)
    if (previous) return { state: 'current', baseUrl: previous.baseUrl, candidate: previous, candidates }
  }
  if (candidates.length !== 1) return { state: candidates.length ? 'ambiguous' : 'none', candidates }
  return { state: 'matched', baseUrl: candidates[0].baseUrl, candidate: candidates[0], candidates }
}

async function defaultListeningPorts({ timeoutMs }) {
  const { stdout } = await execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { timeout: timeoutMs })
  const output = []
  let current = {}
  for (const line of String(stdout).split(/\r?\n/)) {
    if (line.startsWith('p')) current = { pid: line.slice(1) }
    else if (line.startsWith('c')) current.command = line.slice(1)
    else if (line.startsWith('n')) { const match = line.match(/:(\d+)$/); if (match) output.push({ ...current, port: Number(match[1]) }) }
  }
  return output
}

async function defaultInspectProcess(pid, { timeoutMs }) {
  const { stdout } = await execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: timeoutMs })
  return { cwd: String(stdout).split(/\r?\n/).find(line => line.startsWith('n'))?.slice(1) || null }
}

function sameOrNested(root, candidate) {
  if (!candidate) return false
  const relative = path.relative(root, path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
