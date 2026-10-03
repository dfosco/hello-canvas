import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPaseoAgentRuntime: vi.fn(), getPaseoConnectionDiagnostics: vi.fn() }))
vi.mock('./paseo-agent-runtime.js', () => ({
  MAX_TEXT_LENGTH: 32_000,
  getPaseoAgentRuntime: mocks.getPaseoAgentRuntime,
}))
vi.mock('./paseo-runtime-client.js', () => ({
  getPaseoConnectionDiagnostics: mocks.getPaseoConnectionDiagnostics,
}))

import { createPaseoAgentsHandler } from './paseo-agents-routes.js'

afterEach(() => vi.clearAllMocks())

describe('Paseo agent workspace routing', () => {
  it('rejects a client workspace that differs from the active Notebook', async () => {
    const runtime = {
      resolveWorkspaceId: vi.fn().mockResolvedValue('active-workspace'),
      createAgent: vi.fn(),
    }
    mocks.getPaseoAgentRuntime.mockResolvedValue(runtime)
    const sendJson = vi.fn()
    const handler = createPaseoAgentsHandler({ root: '/notebooks/active', sendJson })

    await handler({}, {}, {
      method: 'POST',
      path: '/agents',
      body: { config: { provider: 'codex' }, context: { workspaceId: 'other-workspace' } },
    })

    expect(sendJson).toHaveBeenCalledWith({}, 409, expect.objectContaining({ code: 'WORKSPACE_MISMATCH' }))
    expect(runtime.createAgent).not.toHaveBeenCalled()
  })

  it('creates agents in the server-resolved active Notebook workspace', async () => {
    const runtime = {
      resolveWorkspaceId: vi.fn().mockResolvedValue('active-workspace'),
      createAgent: vi.fn().mockResolvedValue({ agent: { id: 'agent-one' } }),
    }
    mocks.getPaseoAgentRuntime.mockResolvedValue(runtime)
    const sendJson = vi.fn()
    const response = {}
    const handler = createPaseoAgentsHandler({ root: '/notebooks/active', sendJson })

    await handler({}, response, {
      method: 'POST',
      path: '/agents',
      body: { config: { provider: 'codex' }, context: { widgetId: 'agent-chat-one' } },
    })

    expect(runtime.resolveWorkspaceId).toHaveBeenCalledOnce()
    expect(runtime.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      context: { widgetId: 'agent-chat-one', workspaceId: 'active-workspace' },
    }))
    expect(sendJson).toHaveBeenCalledWith(response, 200, { agent: { id: 'agent-one' } })
  })

  it('returns a recoverable daemon diagnostic when the shared SDK is reconnecting', async () => {
    const diagnostics = {
      status: 'disconnected',
      connected: false,
      state: { status: 'disconnected', reason: 'socket closed' },
      lastError: 'socket closed',
      reconnect: { enabled: true, attempt: 2 },
    }
    mocks.getPaseoAgentRuntime.mockResolvedValue(null)
    mocks.getPaseoConnectionDiagnostics.mockReturnValue(diagnostics)
    const sendJson = vi.fn()
    const response = {}
    const handler = createPaseoAgentsHandler({ root: '/notebooks/active', sendJson })

    await handler({}, response, { method: 'GET', path: '/health' })

    expect(sendJson).toHaveBeenCalledWith(response, 503, expect.objectContaining({
      code: 'DAEMON_UNAVAILABLE',
      diagnostics,
    }))
  })
})
