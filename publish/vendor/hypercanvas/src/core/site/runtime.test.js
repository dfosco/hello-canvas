import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSiteProcessEnvironment, discoverSiteServer, rebindSite, SiteRuntime } from './runtime.js'
import { SiteStore } from './site.js'

function store() {
  let binding = { source: 'managed', workspaceId: 'workspace-site', root: process.cwd(), startCommand: 'node server.js', developmentBaseUrl: 'http://localhost:4311/', status: 'stopped', revision: 0 }
  return { list: () => [{ id: 'site' }], get: () => ({ id: 'site' }), getBinding: () => binding, upsertBinding: (_id, next) => { binding = { ...binding, ...next, revision: binding.revision + 1 }; return binding } }
}

describe('Site runtime', () => {
  it('requires a workspace rebind before starting a legacy managed Site', async () => {
    const legacyStore = {
      get: () => ({ id: 'site' }),
      getBinding: () => ({ source: 'managed', root: '/tmp/site', startCommand: 'node server.js' }),
      upsertBinding: vi.fn(),
    }
    const runtime = new SiteRuntime(legacyStore)
    await expect(runtime.start('site', { confirmed: true })).rejects.toMatchObject({ code: 'SITE_REBIND_REQUIRED' })
  })

  it('blocks starting when the bound directory has moved', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { root: '/path/that/does/not/exist/site' })
    await expect(new SiteRuntime(siteStore).start('site', { confirmed: true })).rejects.toMatchObject({ code: 'SITE_REBIND_REQUIRED' })
  })

  it('blocks a bound Site root replaced by a symlink', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'site-root-replaced-'))
    try {
      const boundRoot = path.join(parent, 'selected')
      const movedRoot = path.join(parent, 'selected-moved')
      const replacement = path.join(parent, 'replacement')
      fs.mkdirSync(boundRoot)
      fs.mkdirSync(replacement)
      const siteStore = store()
      siteStore.getBinding = () => ({ source: 'managed', workspaceId: 'workspace-site', root: boundRoot, startCommand: 'node server.js' })
      fs.renameSync(boundRoot, movedRoot)
      fs.symlinkSync(replacement, boundRoot, 'dir')

      await expect(new SiteRuntime(siteStore).start('site', { confirmed: true }))
        .rejects.toMatchObject({ code: 'SITE_REBIND_REQUIRED' })
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('refuses to start a Site whose project directory is inside its Notebook', async () => {
    const notebook = fs.mkdtempSync(path.join(os.tmpdir(), 'site-inside-notebook-'))
    try {
      const internalRoot = path.join(notebook, 'assets', 'app')
      fs.mkdirSync(internalRoot, { recursive: true })
      const siteStore = new SiteStore(notebook)
      siteStore.upsert({ id: 'internal', title: 'Internal' })
      siteStore.upsertBinding('internal', {
        source: 'managed',
        root: internalRoot,
        workspaceId: 'notebook-workspace',
        startCommand: 'npm run dev',
      })

      await expect(new SiteRuntime(siteStore).start('internal', { confirmed: true }))
        .rejects.toMatchObject({ code: 'SITE_ROOT_INSIDE_NOTEBOOK' })
    } finally {
      fs.rmSync(notebook, { recursive: true, force: true })
    }
  })

  it('removes Core and Paseo environment values from Site children and rejects reserved overrides', () => {
    expect(createSiteProcessEnvironment({
      PATH: '/usr/bin',
      HYPERCANVAS_CORE_SESSION_SECRET: 'core-secret',
      HYPERCANVAS_APP_STATE_DIR: '/private/state',
      PASEO_PASSWORD: 'paseo-secret',
      PASEO_DAEMON_AUTH_HEADER: 'auth',
      CUSTOM_SITE_VALUE: 'kept',
    }, { SITE_MODE: 'development' })).toEqual({
      PATH: '/usr/bin',
      CUSTOM_SITE_VALUE: 'kept',
      SITE_MODE: 'development',
    })
    expect(() => createSiteProcessEnvironment({}, { PASEO_PASSWORD: 'attempted-override' }))
      .toThrow(/cannot override reserved Core\/Paseo variables/)
  })

  it('requires confirmation before starting a managed process', async () => {
    const runtime = new SiteRuntime(store(), { probe: vi.fn() })
    await expect(runtime.start('site')).rejects.toThrow('explicit confirmation')
  })

  it('rebinds a healthy loopback URL by Site ID', async () => {
    const siteStore = store()
    const result = await rebindSite(siteStore, 'site', { workspaceId: 'workspace-site', developmentBaseUrl: 'http://127.0.0.1:4322/app' }, { probe: vi.fn().mockResolvedValue({ reachable: true }) })
    expect(result.developmentBaseUrl).toBe('http://127.0.0.1:4322/app/')
    expect(result.revision).toBe(1)
  })

  it('starts a confirmed Site, captures output, and reports running status', async () => {
    const siteStore = store()
    const child = Object.assign(new EventEmitter(), { pid: 12, killed: false, kill: vi.fn() })
    const runtime = new SiteRuntime(siteStore, { requirePtyRuntime: false, probe: vi.fn().mockResolvedValue({ reachable: true }), spawnProcess: () => child })
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const result = await runtime.start('site', { confirmed: true })
    child.stdout.emit('data', 'ready\n')
    child.stderr.emit('data', 'warning\n')
    expect(result.status).toBe('running')
    expect(runtime.status('site')).toMatchObject({ running: true, logs: [{ stream: 'stdout', message: 'ready' }, { stream: 'stderr', message: 'warning' }] })
  })

  it('shares one in-flight start between concurrent confirmed callers', async () => {
    const siteStore = store()
    let spawns = 0
    const child = Object.assign(new EventEmitter(), { pid: 12, killed: false, kill: vi.fn() })
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const runtime = new SiteRuntime(siteStore, {
      requirePtyRuntime: false,
      probe: vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return { reachable: true } }),
      spawnProcess: () => { spawns += 1; return child },
    })
    const [first, second] = await Promise.all([
      runtime.start('site', { confirmed: true }),
      runtime.start('site', { confirmed: true }),
    ])
    expect(spawns).toBe(1)
    expect(second).toBe(first)
    expect(first.status).toBe('running')
  })

  it('refreshes the canonical Notebook workspace before creating an external Site terminal', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', {
      workspaceId: 'previous-daemon-workspace',
      terminalSessionId: 'site:site',
      status: 'error',
    })
    const resolveNotebookWorkspaceId = vi.fn(async () => 'current-daemon-workspace')
    let launched = false
    const pty = {
      create: vi.fn(async () => { launched = true; return { terminalId: 'terminal-site' } }),
      terminate: vi.fn().mockResolvedValue({ terminated: false }),
    }
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: pty,
      resolveNotebookWorkspaceId,
      probe: vi.fn().mockResolvedValue({ reachable: true }),
      listListeningPorts: vi.fn(async () => launched ? [{ pid: '42', port: 4321 }] : []),
      inspectProcess: vi.fn(async () => ({ cwd: process.cwd() })),
      killProcess: vi.fn(),
    })

    await runtime.start('site', { confirmed: true })

    expect(resolveNotebookWorkspaceId).toHaveBeenCalled()
    expect(resolveNotebookWorkspaceId).toHaveBeenCalledWith()
    expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'site:site',
      workspaceId: 'current-daemon-workspace',
    }))
    expect(siteStore.getBinding('site')).toMatchObject({
      workspaceId: 'current-daemon-workspace',
      status: 'running',
      terminalSessionId: 'site:site',
      developmentBaseUrl: 'http://127.0.0.1:4321/',
    })
    await runtime.close()
  })

  it('does not mistake a reachable previous port for the newly started Site', async () => {
    const siteStore = store()
    let launched = false
    const pty = {
      create: vi.fn(async () => { launched = true; return { terminalId: 'site-tab' } }),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: pty,
      resolveNotebookWorkspaceId: vi.fn().mockResolvedValue('workspace-notebook'),
      listListeningPorts: vi.fn(async () => launched
        ? [{ pid: 'unrelated', port: 4311 }, { pid: 'owned', port: 4321 }]
        : [{ pid: 'unrelated', port: 4311 }]),
      inspectProcess: vi.fn(async pid => ({ cwd: pid === 'owned' ? process.cwd() : os.tmpdir() })),
      killProcess: vi.fn(),
      probe: vi.fn().mockResolvedValue({ reachable: true }),
    })

    const started = await runtime.start('site', { confirmed: true })
    expect(pty.create).toHaveBeenCalledOnce()
    expect(started.developmentBaseUrl).toBe('http://127.0.0.1:4321/')
    await runtime.close()
  })

  it('adopts an already running Site server owned by its directory without creating a second terminal', async () => {
    const siteStore = store()
    const pty = { create: vi.fn(), terminate: vi.fn().mockResolvedValue({ terminated: false }) }
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: pty, resolveNotebookWorkspaceId: vi.fn().mockResolvedValue('workspace-notebook'),
      listListeningPorts: vi.fn().mockResolvedValue([{ pid: 'owned', port: 8080 }]),
      inspectProcess: vi.fn().mockResolvedValue({ cwd: process.cwd() }),
      killProcess: vi.fn(), probe: vi.fn().mockResolvedValue({ reachable: true }),
    })
    const result = await runtime.start('site', { confirmed: true })
    expect(result).toMatchObject({ status: 'running', developmentBaseUrl: 'http://127.0.0.1:8080/', terminalSessionId: null })
    expect(runtime.status('site').running).toBe(true)
    expect(runtime.status('site').sessionOwnership).toBe('adopted')
    expect(pty.create).not.toHaveBeenCalled()
    await runtime.close()
    expect(runtime.status('site').running).toBe(true)
  })

  it('labels a Paseo-managed Site terminal as paseo-owned', async () => {
    const siteStore = store()
    const pty = {
      create: vi.fn(async () => ({ terminalId: 'terminal-site' })),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    const runtime = new SiteRuntime(siteStore, { ptyRuntime: pty, requirePtyRuntime: true, probe: vi.fn().mockResolvedValue({ reachable: true }) })
    await runtime.start('site', { confirmed: true })
    expect(runtime.status('site')).toMatchObject({ running: true, terminalSessionId: 'site:site', sessionOwnership: 'paseo' })
    await runtime.close()
    expect(runtime.status('site').sessionOwnership).toBe(null)
  })

  it('cleans up a process when health checks time out', async () => {
    const siteStore = store()
    const child = Object.assign(new EventEmitter(), { pid: 12, killed: false, kill: vi.fn(() => { child.killed = true }) })
    const runtime = new SiteRuntime(siteStore, { requirePtyRuntime: false, probe: vi.fn().mockResolvedValue({ reachable: false }), spawnProcess: () => child })
    await expect(runtime.start('site', { confirmed: true, timeoutMs: 1 })).rejects.toThrow('did not become healthy')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(runtime.status('site').running).toBe(false)
  })

  it('runs npm install visibly in the Paseo terminal before the configured Site command when node_modules is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-site-install-'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    const siteStore = store()
    siteStore.upsertBinding('site', { root })
    let terminalCommand = ''
    const pty = {
      create: vi.fn(async input => {
        terminalCommand = input.args[1]
        return { terminalId: 'terminal-site' }
      }),
      subscribe: vi.fn(async (_sessionId, callbacks) => {
        const markerFile = terminalCommand.match(/touch '([^']+)'/)?.[1]
        expect(markerFile).toBeTruthy()
        fs.writeFileSync(markerFile, 'ready')
        callbacks.onOutput({ bytes: Array.from(Buffer.from('added packages\n')) })
        callbacks.onOutput({ bytes: Array.from(Buffer.from('vite ready\n')) })
        return { close: vi.fn() }
      }),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    try {
      const runtime = new SiteRuntime(siteStore, {
        ptyRuntime: pty,
        probe: vi.fn().mockResolvedValue({ reachable: true }),
        listListeningPorts: vi.fn().mockResolvedValue([]),
      })

      await runtime.start('site', { confirmed: true })

      expect(terminalCommand).toContain('npm install && touch ')
      expect(terminalCommand.indexOf('npm install')).toBeLessThan(terminalCommand.indexOf('node server.js'))
      expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({
        cwd: fs.realpathSync.native(root),
        workspaceId: 'workspace-site',
        program: '/bin/sh',
      }))
      const logs = runtime.getLogs('site').map(entry => entry.message).join('\n')
      expect(logs).toContain('added packages')
      expect(logs).toContain('vite ready')
      await runtime.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not install dependencies when node_modules already exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-site-installed-'))
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    fs.mkdirSync(path.join(root, 'node_modules'))
    const siteStore = store()
    siteStore.upsertBinding('site', { root })
    const pty = { create: vi.fn().mockResolvedValue({ terminalId: 'terminal-site' }), terminate: vi.fn().mockResolvedValue({ terminated: true }) }
    try {
      const runtime = new SiteRuntime(siteStore, { ptyRuntime: pty, probe: vi.fn().mockResolvedValue({ reachable: true }), listListeningPorts: vi.fn().mockResolvedValue([]) })
      await runtime.start('site', { confirmed: true })
      expect(pty.create.mock.calls[0][0].args[1]).toBe('node server.js')
      expect(pty.create).toHaveBeenCalledOnce()
      await runtime.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('shows npm install failures from the Paseo terminal in Site logs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-site-install-failure-'))
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    const siteStore = store()
    siteStore.upsertBinding('site', { root })
    const pty = {
      create: vi.fn(async () => ({ terminalId: 'terminal-site' })),
      subscribe: vi.fn(async (_sessionId, callbacks) => {
        callbacks.onOutput({ bytes: Array.from(Buffer.from('npm ERR! dependency resolution failed\n')) })
        callbacks.onExit()
        return { close: vi.fn() }
      }),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    try {
      const runtime = new SiteRuntime(siteStore, { ptyRuntime: pty, listListeningPorts: vi.fn().mockResolvedValue([]) })

      await expect(runtime.start('site', { confirmed: true })).rejects.toMatchObject({ code: 'SITE_INSTALL_FAILED' })

      expect(runtime.getLogs('site').map(entry => entry.message).join('\n')).toContain('npm ERR! dependency resolution failed')
      expect(pty.create).toHaveBeenCalledOnce()
      expect(pty.create.mock.calls[0][0].args[1]).toContain('npm install && touch ')
      expect(siteStore.getBinding('site').status).toBe('error')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('cancels an in-progress visible npm install when the Site terminal is stopped', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-site-install-cancel-'))
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
    const siteStore = store()
    siteStore.upsertBinding('site', { root })
    const pty = {
      create: vi.fn().mockResolvedValue({ terminalId: 'terminal-site' }),
      subscribe: vi.fn().mockResolvedValue({ close: vi.fn() }),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    try {
      const runtime = new SiteRuntime(siteStore, { ptyRuntime: pty, listListeningPorts: vi.fn().mockResolvedValue([]) })
      const starting = runtime.start('site', { confirmed: true })
      await vi.waitFor(() => expect(pty.subscribe).toHaveBeenCalledOnce())

      await runtime.stop('site')

      await expect(starting).rejects.toMatchObject({ code: 'SITE_START_CANCELLED' })
      expect(pty.terminate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'site:site' }))
      expect(siteStore.getBinding('site').status).toBe('stopped')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('terminates a Site through the Paseo PTY runtime', async () => {
    const siteStore = store()
    const pty = { create: vi.fn().mockResolvedValue({ terminalId: 'terminal-site' }), terminate: vi.fn().mockResolvedValue({ terminated: true }) }
    const runtime = new SiteRuntime(siteStore, { ptyRuntime: pty, probe: vi.fn().mockResolvedValue({ reachable: true }), listListeningPorts: vi.fn().mockResolvedValue([]) })
    await runtime.start('site', { confirmed: true })
    await runtime.stop('site')
    expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'site:site',
      workspaceId: 'workspace-site',
      cwd: process.cwd(),
      program: '/bin/sh',
    }))
    expect(pty.create.mock.calls[0][0].env).toMatchObject({
      HYPERCANVAS_CORE_SESSION_SECRET: '',
      HYPERCANVAS_LAUNCH_TOKEN: '',
      HYPERCANVAS_APP_STATE_DIR: '',
      PASEO_PASSWORD: '',
      PASEO_DAEMON_PASSWORD: '',
      PASEO_DAEMON_AUTH_HEADER: '',
    })
    expect(pty.terminate).toHaveBeenCalledWith({
      sessionId: 'site:site',
      workspaceId: 'workspace-site',
      cwd: process.cwd(),
    })
    expect(siteStore.getBinding('site')).toMatchObject({ status: 'stopped', terminalSessionId: null })
  })

  it('captures Paseo terminal output and reports a Site process exit after startup', async () => {
    const siteStore = store()
    const onSiteError = vi.fn()
    let callbacks
    const pty = {
      create: vi.fn().mockResolvedValue({ terminalId: 'terminal-site' }),
      subscribe: vi.fn(async (_sessionId, listeners) => { callbacks = listeners; return { close: vi.fn() } }),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: pty,
      onSiteError,
      probe: vi.fn().mockResolvedValue({ reachable: true }),
      listListeningPorts: vi.fn().mockResolvedValue([]),
    })

    await runtime.start('site', { confirmed: true })
    callbacks.onGap({ snapshot: { text: '\n  \n', screen: '\n  \n' } })
    expect(runtime.getLogs('site')).toEqual([])
    callbacks.onOutput({ bytes: Array.from(Buffer.from('server crashed\n')) })
    callbacks.onExit()

    expect(runtime.getLogs('site').map(entry => entry.message).join('\n')).toContain('server crashed')
    expect(siteStore.getBinding('site').status).toBe('error')
    expect(onSiteError).toHaveBeenCalledWith('site', expect.objectContaining({ message: 'Site terminal process exited' }))
  })

  it('uses a Paseo terminal tab instead of a configured workspace script when available', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { scriptName: 'prototype' })
    const pty = { create: vi.fn().mockResolvedValue({ terminalId: 'terminal-site' }), terminate: vi.fn().mockResolvedValue({}) }
    const workspaceScripts = { startWorkspaceScriptWithStatus: vi.fn(), stopWorkspaceScript: vi.fn() }
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: pty,
      workspaceScripts,
      probe: vi.fn().mockResolvedValue({ reachable: true }),
      listListeningPorts: vi.fn().mockResolvedValue([]),
    })

    await runtime.start('site', { confirmed: true })

    expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'site:site', workspaceId: 'workspace-site' }))
    expect(workspaceScripts.startWorkspaceScriptWithStatus).not.toHaveBeenCalled()
    expect(siteStore.getBinding('site')).toMatchObject({ status: 'running', terminalSessionId: 'site:site' })
  })

  it('restarts a Site by closing its old tab once before creating the replacement', async () => {
    const pty = { create: vi.fn().mockResolvedValue({ terminalId: 'terminal-site' }), terminate: vi.fn().mockResolvedValue({}) }
    const runtime = new SiteRuntime(store(), { ptyRuntime: pty, probe: vi.fn().mockResolvedValue({ reachable: true }), listListeningPorts: vi.fn().mockResolvedValue([]) })

    await runtime.start('site', { confirmed: true })
    await runtime.restart('site', { confirmed: true })

    expect(pty.create).toHaveBeenCalledTimes(2)
    expect(pty.terminate).toHaveBeenCalledTimes(1)
  })

  it('refuses to start a managed Site outside Paseo when the caller requires a terminal tab', async () => {
    const siteStore = store()
    const spawnProcess = vi.fn()
    const runtime = new SiteRuntime(siteStore, { requirePtyRuntime: true, spawnProcess })

    await expect(runtime.start('site', { confirmed: true })).rejects.toMatchObject({ code: 'PASEO_UNAVAILABLE' })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('starts and stops a Site through its Paseo workspace script', async () => {
    const siteStore = store()
    siteStore.getBinding = () => ({
      source: 'managed', workspaceId: 'workspace-site', scriptName: 'prototype',
       root: process.cwd(), startCommand: 'npm run dev',
      developmentBaseUrl: 'http://localhost:4311/', status: 'stopped', revision: 0,
    })
    const workspaceScripts = {
      startWorkspaceScriptWithStatus: vi.fn().mockResolvedValue({ pid: 42 }),
      stopWorkspaceScript: vi.fn().mockResolvedValue({}),
    }
    const runtime = new SiteRuntime(siteStore, { requirePtyRuntime: false, workspaceScripts, probe: vi.fn().mockResolvedValue({ reachable: true }), listListeningPorts: vi.fn().mockResolvedValue([]) })
    await runtime.start('site', { confirmed: true })
    expect(workspaceScripts.startWorkspaceScriptWithStatus).toHaveBeenCalledWith('workspace-site', 'prototype')
    await runtime.stop('site')
    expect(workspaceScripts.stopWorkspaceScript).toHaveBeenCalledWith('workspace-site', 'prototype')
  })

  it('stops a workspace script from persisted binding data in a fresh runtime', async () => {
    const siteStore = store()
    siteStore.getBinding = () => ({ source: 'managed', workspaceId: 'workspace-site', scriptName: 'prototype', status: 'running', revision: 1 })
    const workspaceScripts = { stopWorkspaceScript: vi.fn().mockResolvedValue({}) }
    await new SiteRuntime(siteStore, { workspaceScripts, listListeningPorts: vi.fn().mockResolvedValue([]) }).stop('site')
    expect(workspaceScripts.stopWorkspaceScript).toHaveBeenCalledWith('workspace-site', 'prototype')
  })

  it('terminates a persisted Paseo terminal binding from a fresh Site runtime', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { pid: null, status: 'running', terminalSessionId: 'site:site' })
    const pty = { terminate: vi.fn().mockResolvedValue({}) }
    await new SiteRuntime(siteStore, { ptyRuntime: pty, listListeningPorts: vi.fn().mockResolvedValue([]) }).stop('site')
    expect(pty.terminate).toHaveBeenCalledWith({
      sessionId: 'site:site',
      workspaceId: 'workspace-site',
      cwd: process.cwd(),
    })
  })

  it('preserves an independently running Site server while reconciling a stale terminal binding', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { status: 'running', terminalSessionId: 'site:site' })
    const killProcess = vi.fn()
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: { terminate: vi.fn().mockResolvedValue({ terminated: false }) },
      listListeningPorts: vi.fn().mockResolvedValue([{ pid: '42', port: 4311 }]),
      inspectProcess: vi.fn().mockResolvedValue({ cwd: process.cwd() }),
      killProcess,
    })
    await runtime.ready
    expect(killProcess).not.toHaveBeenCalled()
    expect(siteStore.getBinding('site')).toMatchObject({ status: 'stopped', terminalSessionId: null })
  })

  it('drops terminal references from another Paseo daemon without touching that Site listener', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { status: 'running', terminalSessionId: 'site:site', workspaceId: 'old-daemon' })
    const terminate = vi.fn().mockResolvedValue({ terminated: false })
    const killProcess = vi.fn()
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: { terminate }, resolveNotebookWorkspaceId: vi.fn().mockResolvedValue('paseo-desktop-workspace'),
      listListeningPorts: vi.fn().mockResolvedValue([{ pid: '42', port: 4311 }]),
      inspectProcess: vi.fn().mockResolvedValue({ cwd: process.cwd() }), killProcess,
    })
    await runtime.ready
    expect(terminate).toHaveBeenCalledWith({
      sessionId: 'site:site',
      workspaceId: 'old-daemon',
      cwd: fs.realpathSync.native(process.cwd()),
    })
    expect(killProcess).not.toHaveBeenCalled()
    expect(siteStore.getBinding('site')).toMatchObject({ workspaceId: 'paseo-desktop-workspace', status: 'stopped', terminalSessionId: null })
  })

  it('moves a persisted Site terminal into the active Notebook workspace on startup', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { status: 'running', terminalSessionId: 'site:site', workspaceId: 'previous-site-workspace' })
    const terminate = vi.fn().mockResolvedValue({ terminated: true })
    const killProcess = vi.fn()
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: { terminate },
      resolveNotebookWorkspaceId: vi.fn().mockResolvedValue('notebook-workspace'),
      listListeningPorts: vi.fn().mockResolvedValue([{ pid: '42', port: 4311 }]),
      inspectProcess: vi.fn().mockResolvedValue({ cwd: process.cwd() }),
      killProcess,
    })

    await runtime.ready

    expect(terminate).toHaveBeenCalledWith({
      sessionId: 'site:site',
      workspaceId: 'previous-site-workspace',
      cwd: fs.realpathSync.native(process.cwd()),
    })
    expect(killProcess).toHaveBeenCalledWith(42, 'SIGTERM')
    expect(siteStore.getBinding('site')).toMatchObject({
      workspaceId: 'notebook-workspace',
      status: 'stopped',
      terminalSessionId: null,
    })
  })

  it('kills the Site listener but retains the tab identity when Paseo cannot close the terminal', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { status: 'running', terminalSessionId: 'site:site' })
    const killProcess = vi.fn()
    const runtime = new SiteRuntime(siteStore, {
      ptyRuntime: { terminate: vi.fn().mockRejectedValue(new Error('daemon disconnected')) },
      reconcileOnStart: false,
      listListeningPorts: vi.fn().mockResolvedValue([{ pid: 99, port: 4311 }]),
      inspectProcess: vi.fn().mockResolvedValue({ cwd: process.cwd() }),
      killProcess,
    })

    await expect(runtime.stop('site')).rejects.toThrow('daemon disconnected')

    expect(killProcess).toHaveBeenCalledWith(99, 'SIGTERM')
    expect(siteStore.getBinding('site')).toMatchObject({ status: 'stopped', terminalSessionId: 'site:site' })
  })

  it('clears stale running state on startup without a PTY runtime', async () => {
    const siteStore = store()
    siteStore.upsertBinding('site', { status: 'running' })
    const runtime = new SiteRuntime(siteStore, { listListeningPorts: vi.fn().mockResolvedValue([]) })
    await runtime.ready
    expect(siteStore.getBinding('site').status).toBe('stopped')
    await expect(runtime.stop('site')).resolves.toMatchObject({ status: 'stopped' })
  })

  it('terminates dev-server descendants left listening in the Site root', async () => {
    const siteStore = store()
    const killProcess = vi.fn()
    const runtime = new SiteRuntime(siteStore, {
      listListeningPorts: vi.fn().mockResolvedValue([{ pid: '99', port: 4311 }]),
      inspectProcess: vi.fn().mockResolvedValue({ cwd: process.cwd() }),
      killProcess,
    })
    await runtime.stop('site')
    expect(killProcess).toHaveBeenCalledWith(99, 'SIGTERM')
  })

  it('resolves the Site URL from its workspace service binding', async () => {
    let binding = {
      source: 'managed', workspaceId: 'workspace-site', serviceName: 'site', scriptName: 'prototype',
       root: process.cwd(), startCommand: 'npm run dev', status: 'stopped', revision: 0,
    }
    const siteStore = {
      get: () => ({ id: 'site' }),
      getBinding: () => binding,
      upsertBinding: (_id, next) => { binding = { ...binding, ...next }; return binding },
    }
    const workspaceScripts = {
      startWorkspaceScriptWithStatus: vi.fn().mockResolvedValue({ pid: 42 }),
      stopWorkspaceScript: vi.fn().mockResolvedValue({}),
    }
    const serviceResolver = vi.fn().mockResolvedValue('http://127.0.0.1:4311')
    const runtime = new SiteRuntime(siteStore, { requirePtyRuntime: false, workspaceScripts, serviceResolver, probe: vi.fn().mockResolvedValue({ reachable: true }) })
    await runtime.start('site', { confirmed: true })
    expect(serviceResolver).toHaveBeenCalledWith('workspace-site', 'site')
    expect(binding.developmentBaseUrl).toBe('http://127.0.0.1:4311')
  })

  it('selects the only healthy listener inside the project root', async () => {
    const result = await discoverSiteServer({
      root: '/tmp/site',
      listListeningPorts: async () => [{ pid: '7', port: 4400 }],
      inspectProcess: async () => ({ cwd: '/tmp/site' }),
      probe: vi.fn().mockResolvedValue({ reachable: true }),
    })
    expect(result).toMatchObject({ state: 'matched', baseUrl: 'http://127.0.0.1:4400/' })
  })
})
