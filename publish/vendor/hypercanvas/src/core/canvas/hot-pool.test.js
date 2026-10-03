import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../host-tools/runtime.js', () => ({
  buildHostWorkloadEnv: vi.fn((runtime, session) => ({
    PATH: runtime.path,
    HYPERCANVAS_HOST_PATH: runtime.hostPath,
    ...session,
  })),
  resolveAgentHostRuntime: vi.fn(),
  resolveTerminalHostRuntime: vi.fn(),
}))

vi.mock('./terminal-runtime.js', () => ({
  createTerminalSession: vi.fn().mockResolvedValue({ running: true }),
  terminalSessionExists: vi.fn().mockResolvedValue(true),
  terminateTerminalSession: vi.fn().mockResolvedValue({ terminated: true }),
}))

import { resolveAgentHostRuntime, resolveTerminalHostRuntime } from '../host-tools/runtime.js'
import { createTerminalSession, terminateTerminalSession } from './terminal-runtime.js'
import { HotPool } from './hot-pool.js'

const root = '/verified/project'
const terminalRuntime = {
  cwd: root,
  shell: '/bin/zsh',
  hostPath: '/host/bin:/usr/bin:/bin',
  path: '/verified/project/.storyboard/terminals/bin:/host/bin:/usr/bin:/bin',
}

describe('HotPool host runtime policy', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the terminal pool available without resolving a Node or agent baseline', async () => {
    resolveTerminalHostRuntime.mockReturnValue(terminalRuntime)
    const workspaceIdResolver = vi.fn().mockResolvedValue('notebook-workspace')
    const pool = new HotPool({ root, config: { pool_size: 1, max_pool_size: 1 }, workspaceIdResolver })

    await pool.start()

    expect(resolveAgentHostRuntime).not.toHaveBeenCalled()
    expect(createTerminalSession).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      cwd: root,
      workspaceId: 'notebook-workspace',
      program: '/bin/zsh',
      env: expect.objectContaining({
        PATH: terminalRuntime.path,
        HYPERCANVAS_HOST_PATH: terminalRuntime.hostPath,
      }),
    }))
    expect(workspaceIdResolver).toHaveBeenCalledWith(root)
    pool.stop()
    expect(terminateTerminalSession).toHaveBeenCalled()
  })

  it('does not create an agent pool PTY when exact host verification fails', async () => {
    resolveAgentHostRuntime.mockRejectedValue(Object.assign(new Error('Codex unavailable'), {
      code: 'HOST_RUNTIME_AGENT_UNAVAILABLE',
    }))
    const pool = new HotPool({
      root,
      poolId: 'codex',
      agentId: 'codex',
      config: { pool_size: 1, max_pool_size: 1 },
    })

    await pool.start()

    expect(resolveAgentHostRuntime).toHaveBeenCalledWith(root, 'codex')
    expect(createTerminalSession).not.toHaveBeenCalled()
    expect(pool.status()).toMatchObject({ prereqsAvailable: false, ready: 0 })
  })

  it('initializes host prerequisites when enabled after startup', async () => {
    resolveTerminalHostRuntime.mockReturnValue(terminalRuntime)
    const pool = new HotPool({ root, config: { enabled: false, pool_size: 1, max_pool_size: 1 } })

    await pool.start()
    expect(resolveTerminalHostRuntime).not.toHaveBeenCalled()

    await pool.reconfigure({ enabled: true })

    expect(resolveTerminalHostRuntime).toHaveBeenCalledWith(root)
    expect(createTerminalSession).toHaveBeenCalled()
    expect(pool.status()).toMatchObject({ enabled: true, prereqsAvailable: true, ready: 1 })
    pool.stop()
  })
})
