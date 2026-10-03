import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetPaseoAgentRuntime, initPaseoAgentRuntime } from './paseo-agent-runtime.js'
import { initTerminalConfig, writeTerminalConfig } from './terminal-config.js'

const temporary = []

afterEach(() => {
  _resetPaseoAgentRuntime()
  temporary.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
  vi.clearAllMocks()
})

describe('Paseo agent runtime credential boundary', () => {
  it('does not expose daemon connection settings or client internals on the runtime surface', async () => {
    const secret = 'resolved-daemon-password'
    const runtime = await initPaseoAgentRuntime({
      client: {},
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root: '/notebook',
      connectionOptions: {
        url: 'ws://127.0.0.1:45678/ws',
        password: secret,
      },
    })

    expect(runtime).not.toHaveProperty('_config')
    expect(runtime).not.toHaveProperty('_client')
    expect(runtime).not.toHaveProperty('_daemon')
    expect(JSON.stringify(await runtime.health())).not.toContain(secret)
  })

  it('rebinds the shared agent runtime when the active Notebook root changes', async () => {
    const first = await initPaseoAgentRuntime({
      client: {},
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root: '/notebooks/first',
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-first'),
    })
    const second = await initPaseoAgentRuntime({
      client: {},
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root: '/notebooks/second',
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-second'),
    })

    await expect(first.resolveWorkspaceId()).resolves.toBe('workspace-first')
    await expect(second.resolveWorkspaceId()).resolves.toBe('workspace-second')
    expect(second).not.toBe(first)
  })

  it('replaces a disposed SDK runtime for the same Notebook', async () => {
    let firstState = { status: 'connected' }
    const wsSend = vi.fn()
    const first = await initPaseoAgentRuntime({
      client: {},
      daemon: { getConnectionState: () => firstState, close: vi.fn() },
      daemonReady: true,
      root: '/notebooks/shared',
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-shared'),
      wsSend,
    })
    firstState = { status: 'disposed' }
    const second = await initPaseoAgentRuntime({
      client: {},
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root: '/notebooks/shared',
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-shared'),
      wsSend,
    })

    expect(second).not.toBe(first)
    await expect(second.resolveWorkspaceId()).resolves.toBe('workspace-shared')
  })

  it('uses the active workspace instead of a stale widget-config workspace', async () => {    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paseo-agent-workspace-'))
    temporary.push(root)
    initTerminalConfig(root)
    writeTerminalConfig({
      branch: 'main',
      canvasId: 'canvas-one',
      widgetId: 'agent-chat-one',
      workspaceId: 'workspace-old',
      widgetProps: { prompt: 'Help with this canvas' },
    })
    const handle = {
      id: 'agent-one',
      current: () => ({ id: 'agent-one' }),
      subscribe: vi.fn(() => vi.fn()),
      timeline: { subscribe: vi.fn(() => vi.fn()) },
    }
    const create = vi.fn().mockResolvedValue(handle)
    const workspace = { agents: { create } }
    const client = {
      agents: { ref: vi.fn(() => handle) },
      workspaces: { ref: vi.fn(() => workspace) },
    }
    const runtime = await initPaseoAgentRuntime({
      client,
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root,
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-active'),
    })

    await runtime.createAgent({
      config: { provider: 'codex' },
      context: { widgetId: 'agent-chat-one', workspaceId: 'workspace-active' },
    })

    expect(client.workspaces.ref).toHaveBeenCalledWith('workspace-active')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ PASEO_WORKSPACE_ID: 'workspace-active' }),
      prompt: 'Help with this canvas',
    }))
  })

  it('confirms a created agent whose snapshot reports the expected workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paseo-agent-verify-'))
    temporary.push(root)
    const handle = {
      id: 'agent-verified',
      workspaceId: 'workspace-active',
      current: () => ({ id: 'agent-verified', workspaceId: 'workspace-active' }),
      subscribe: vi.fn(() => vi.fn()),
      timeline: { subscribe: vi.fn(() => vi.fn()) },
    }
    const create = vi.fn().mockResolvedValue(handle)
    const client = {
      agents: { ref: vi.fn(() => handle) },
      workspaces: { ref: vi.fn(() => ({ agents: { create } })) },
    }
    const runtime = await initPaseoAgentRuntime({
      client,
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root,
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-active'),
    })

    const result = await runtime.createAgent({ config: { provider: 'codex' } })

    expect(result.verifiedInWorkspace).toBe(true)
    expect(result.workspaceId).toBe('workspace-active')
  })

  it('rejects a created agent that reports another Paseo workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paseo-agent-mismatch-'))
    temporary.push(root)
    const handle = {
      id: 'agent-misplaced',
      workspaceId: 'workspace-elsewhere',
      current: () => ({ id: 'agent-misplaced', workspaceId: 'workspace-elsewhere' }),
      subscribe: vi.fn(() => vi.fn()),
      timeline: { subscribe: vi.fn(() => vi.fn()) },
    }
    const client = {
      agents: { ref: vi.fn(() => handle) },
      workspaces: { ref: vi.fn(() => ({ agents: { create: vi.fn().mockResolvedValue(handle) } })) },
    }
    const runtime = await initPaseoAgentRuntime({
      client,
      daemon: { getConnectionState: () => ({ status: 'connected' }), close: vi.fn() },
      daemonReady: true,
      root,
      workspaceIdResolver: vi.fn().mockResolvedValue('workspace-active'),
    })

    await expect(runtime.createAgent({ config: { provider: 'codex' } })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
  })
})
