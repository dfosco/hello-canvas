import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPaseoConnection,
  ensurePaseoWorkspaceForRoot,
  getPaseoConnection,
  getPaseoConnectionDiagnostics,
  paseoConnectionConfig,
  resetPaseoConnectionForTests,
} from './paseo-runtime-client.js'

const temporary = []
afterEach(async () => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
  await resetPaseoConnectionForTests()
})

describe('ensurePaseoWorkspaceForRoot', () => {
  it('opens existing Notebook roots idempotently and coalesces concurrent requests', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-workspace-open-'))
    temporary.push(root)
    const open = vi.fn(async ({ cwd }) => ({ id: 'workspace-opened', workspaceDirectory: cwd }))
    const client = { workspaces: { open, create: vi.fn() } }

    const [first, second] = await Promise.all([
      ensurePaseoWorkspaceForRoot(client, root),
      ensurePaseoWorkspaceForRoot(client, root),
    ])
    expect(first).toBe('workspace-opened')
    expect(second).toBe(first)
    expect(open).toHaveBeenCalledOnce()
    expect(client.workspaces.create).not.toHaveBeenCalled()
  })

  it('uses the canonical directory identity across symlink aliases', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-workspace-alias-'))
    temporary.push(parent)
    const root = path.join(parent, 'Notebook')
    const alias = path.join(parent, 'Notebook alias')
    fs.mkdirSync(root)
    fs.symlinkSync(root, alias)
    const open = vi.fn(async ({ cwd }) => ({ id: `workspace-${path.basename(cwd)}`, workspaceDirectory: cwd }))
    const client = { workspaces: { open } }

    const [canonicalId, aliasId] = await Promise.all([
      ensurePaseoWorkspaceForRoot(client, root),
      ensurePaseoWorkspaceForRoot(client, alias),
    ])

    expect(canonicalId).toBe('workspace-Notebook')
    expect(aliasId).toBe(canonicalId)
    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith({ cwd: fs.realpathSync.native(root) })
  })

  it('rejects file paths instead of registering them as workspace roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-workspace-file-'))
    temporary.push(root)
    const file = path.join(root, 'notebook.txt')
    fs.writeFileSync(file, 'not a workspace')
    const open = vi.fn()
    const client = { workspaces: { open } }

    await expect(ensurePaseoWorkspaceForRoot(client, file)).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_NOT_DIRECTORY' })
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects a workspace open response that points outside the requested directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-workspace-mismatch-'))
    temporary.push(root)
    const client = { workspaces: { open: async () => ({ id: 'wrong', directory: '/tmp/different-workspace' }) } }
    await expect(ensurePaseoWorkspaceForRoot(client, root)).rejects.toThrow(/outside the requested/)
  })

  it('closes an SDK connection when the initial protocol handshake fails', async () => {
    const daemon = { connect: vi.fn().mockRejectedValue(new Error('offline')), close: vi.fn().mockResolvedValue(undefined) }
    await expect(createPaseoConnection({ daemon, client: {} })).rejects.toThrow('offline')
    expect(daemon.close).toHaveBeenCalledOnce()
  })

  it('passes a bounded compatibility-probe timeout to the SDK', () => {
    expect(paseoConnectionConfig({ env: {}, connectTimeoutMs: 1500 }).connectTimeoutMs).toBe(1500)
  })

  it('keeps SDK reconnect enabled and reports redacted live connection diagnostics', async () => {
    const password = 'secret-daemon-password'
    let state = { status: 'connected' }
    const daemon = {
      getConnectionState: () => state,
      getLastServerInfoMessage: () => ({ serverId: 'server-1', version: '0.8.0-beta.1', password }),
      getLastLivenessRttMs: () => 21,
      get lastError() { return state.reason || null },
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const connection = await createPaseoConnection({ daemon, client: {}, password })

    expect(paseoConnectionConfig({ env: {} }).reconnect).toEqual({ enabled: true })
    expect(connection.getDiagnostics()).toMatchObject({
      status: 'connected',
      connected: true,
      server: { serverId: 'server-1', version: '0.8.0-beta.1' },
      reconnect: { enabled: true },
      lastLivenessRttMs: 21,
    })

    state = { status: 'disconnected', reason: `transport closed ${password}` }
    const diagnostics = connection.getDiagnostics()
    expect(diagnostics).toMatchObject({
      status: 'disconnected',
      connected: false,
      state: { status: 'disconnected', reason: 'transport closed [redacted]' },
      lastError: 'transport closed [redacted]',
    })
    expect(JSON.stringify(diagnostics)).not.toContain(password)
  })

  it('reuses a reconnecting SDK client and replaces only a disposed client', async () => {
    let firstState = { status: 'connected' }
    const firstDaemon = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(async () => { firstState = { status: 'disposed' } }),
      getConnectionState: () => firstState,
    }
    const nextDaemon = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getConnectionState: () => ({ status: 'connected' }),
    }
    const first = await getPaseoConnection({ daemon: firstDaemon, client: {} })

    firstState = { status: 'disconnected', reason: 'temporary network loss' }
    await expect(getPaseoConnection({ daemon: nextDaemon, client: {} })).resolves.toBe(first)
    expect(nextDaemon.connect).not.toHaveBeenCalled()
    expect(getPaseoConnectionDiagnostics()).toMatchObject({ status: 'disconnected', lastError: 'temporary network loss' })

    await first.close()
    const replacement = await getPaseoConnection({ daemon: nextDaemon, client: {} })
    expect(replacement.daemon).toBe(nextDaemon)
    expect(nextDaemon.connect).toHaveBeenCalledOnce()
  })

  it('keeps failed startup diagnostics without retaining daemon credentials', async () => {
    const password = 'secret-startup-password'
    const url = 'wss://private.example/ws?token=secret-url-token'
    const daemon = {
      connect: vi.fn().mockRejectedValue(new Error(`authentication failed for ${password} at ${url}`)),
      close: vi.fn().mockResolvedValue(undefined),
    }

    await expect(getPaseoConnection({ daemon, client: {}, password, url })).rejects.toThrow('authentication failed')

    const diagnostics = getPaseoConnectionDiagnostics()
    expect(diagnostics).toMatchObject({
      status: 'disconnected',
      state: { status: 'disconnected' },
      lastError: 'authentication failed for [redacted] at [redacted]',
    })
    expect(JSON.stringify(diagnostics)).not.toContain(password)
    expect(JSON.stringify(diagnostics)).not.toContain(url)
  })

})
