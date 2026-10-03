import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initPaseoTerminalRuntime, PaseoTerminalRuntime, PaseoTerminalRuntimeError, resetPaseoTerminalRuntimeForTests } from './paseo-terminal-runtime.js'

const projectRoot = process.cwd()

afterEach(async () => resetPaseoTerminalRuntimeForTests())

function fakePaseoConnection({ listed = [] } = {}) {
  let terminals = [...listed]
  let streamHandler = null
  let rawHandler = null
  let connectionState = { status: 'connected' }
  const connectionListeners = new Set()
  const daemon = {
    captureTerminal: vi.fn(async (terminalId) => ({ terminalId, lines: ['one', 'two'], totalLines: 2 })),
    close: vi.fn(async () => {}),
    createTerminal: vi.fn(async (cwd, name, _requestId, options) => {
      const terminal = {
        id: `terminal-${terminals.length + 1}`,
        workspaceId: options?.workspaceId || 'workspace-1',
        cwd,
        name,
      }
      terminals.push(terminal)
      return { terminal, error: null }
    }),
    killTerminal: vi.fn(async (terminalId) => {
      terminals = terminals.filter((terminal) => terminal.id !== terminalId)
      return { terminalId, success: true }
    }),
    listTerminals: vi.fn(async (cwd, _requestId, options) => ({
      cwd,
      terminals: terminals.filter((terminal) => !options?.workspaceId || terminal.workspaceId === options.workspaceId),
    })),
    onTerminalStreamEvent: vi.fn((handler) => {
      streamHandler = handler
      return vi.fn()
    }),
    sendTerminalInput: vi.fn(),
    subscribeRawMessages: vi.fn((handler) => {
      rawHandler = handler
      return vi.fn()
    }),
    subscribeConnectionStatus: vi.fn((handler) => {
      connectionListeners.add(handler)
      handler(connectionState)
      return () => connectionListeners.delete(handler)
    }),
    subscribeTerminal: vi.fn(async (terminalId) => ({ terminalId, slot: 1, error: null })),
    unsubscribeTerminal: vi.fn(),
  }
  const connection = {
    client: {
      workspaces: {
        open: vi.fn(async ({ cwd }) => ({
          id: 'workspace-1',
          workspaceDirectory: cwd,
        })),
        ref: vi.fn(id => ({ id, current: () => ({ id }), refresh: vi.fn(async () => ({ id })) })),
      },
    },
    daemon,
    close: daemon.close,
    getConnectionState: () => connectionState,
    getDiagnostics: () => ({ state: connectionState, lastError: connectionState.reason || null }),
  }
  return {
    connection,
    daemon,
    setConnectionState: (state) => {
      connectionState = state
      for (const listener of connectionListeners) listener(state)
    },
    emitRaw: (message) => {
      if (message?.type === 'terminal_stream_exit') {
        terminals = terminals.filter((terminal) => terminal.id !== message.payload?.terminalId)
      }
      rawHandler?.(message)
    },
    emitStream: (event) => streamHandler?.(event),
  }
}

async function startedRuntime(fake = fakePaseoConnection()) {
  const runtime = new PaseoTerminalRuntime(projectRoot, { connection: fake.connection })
  await runtime.start()
  return { fake, runtime }
}

describe('Paseo-backed terminal runtime', () => {
  let fake
  let runtime

  beforeEach(async () => {
    ({ fake, runtime } = await startedRuntime())
  })

  it('reports Paseo connection health', async () => {
    await expect(runtime.health()).resolves.toEqual({
      engine: 'paseo',
      connected: true,
      state: { status: 'connected' },
      recoveryState: 'ready',
      lastError: null,
      server: null,
      reconnect: null,
    })
  })

  it('preserves a disconnected state instead of treating it as a missing terminal', async () => {
    await runtime.create({ sessionId: 'session-1', cwd: projectRoot })
    fake.daemon.listTerminals.mockRejectedValue(new Error('socket closed'))
    fake.setConnectionState({ status: 'disconnected', reason: 'network interrupted' })

    await expect(runtime.create({ sessionId: 'session-1', cwd: projectRoot })).rejects.toMatchObject({
      name: 'PaseoTerminalRuntimeError',
      operation: 'create',
      code: 'PASEO_UNAVAILABLE',
    })
    expect(fake.daemon.createTerminal).toHaveBeenCalledOnce()
  })

  it('opens a workspace and creates a named terminal with environment and size', async () => {
    const created = await runtime.create({
      sessionId: 'session-1',
      program: '/bin/zsh',
      args: ['-l'],
      cwd: projectRoot,
      env: { STORYBOARD_WIDGET_ID: 'widget-1', EMPTY: null },
      cols: 100,
      rows: 40,
    })

    expect(fake.connection.client.workspaces.open).toHaveBeenCalledWith({ cwd: projectRoot })
    expect(fake.daemon.createTerminal).toHaveBeenCalledWith(
      projectRoot,
      'hypercanvas:session-1',
      undefined,
      {
        workspaceId: 'workspace-1',
        command: '/usr/bin/env',
        args: ['STORYBOARD_WIDGET_ID=widget-1', '/bin/zsh', '-l'],
        size: { cols: 100, rows: 40 },
      },
    )
    expect(created).toMatchObject({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      reused: false,
      running: true,
      verified: true,
    })
  })

  it('fails creation when the created terminal is not visible in the expected workspace', async () => {
    const broken = fakePaseoConnection()
    // The daemon reports the created terminal outside the workspace listing.
    broken.daemon.createTerminal = vi.fn(async (cwd, name) => ({
      terminal: { id: 'terminal-orphan', workspaceId: 'workspace-other', cwd, name },
      error: null,
    }))
    const setup = await startedRuntime(broken)

    await expect(setup.runtime.create({ sessionId: 'session-x', cwd: projectRoot })).rejects.toMatchObject({
      name: 'PaseoTerminalRuntimeError',
      operation: 'create',
    })
  })

  it('registers external Site terminals at the Notebook root while preserving execution cwd and literal argv', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "site 'directory-"))
    try {
      fake.connection.client.workspaces.ref.mockImplementation(id => ({ current: () => ({ id, workspaceDirectory: projectRoot }) }))
      const input = {
        sessionId: 'site:external', workspaceId: 'workspace-1', cwd,
        program: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1),mode:process.env.SITE_MODE}))', 'literal $(echo injected)'],
        env: { SITE_MODE: 'preview' },
      }
      const created = await runtime.create(input)
      const [registeredCwd, , , command] = fake.daemon.createTerminal.mock.calls[0]
      expect(registeredCwd).toBe(projectRoot)
      const result = JSON.parse(execFileSync(command.command, command.args, { cwd: registeredCwd, encoding: 'utf8' }))
      expect(result).toEqual({ cwd: realpathSync(cwd), args: ['literal $(echo injected)'], mode: 'preview' })

      expect((await runtime.create(input)).terminalId).toBe(created.terminalId)
      expect(fake.daemon.createTerminal).toHaveBeenCalledOnce()
      // Reconstruct the runtime as after a Core restart. Persisted Site bindings
      // still contain the execution directory, so cleanup must find the tab.
      const restarted = await startedRuntime(fake)
      await expect(restarted.runtime.terminate({ sessionId: input.sessionId, workspaceId: input.workspaceId, cwd }))
        .resolves.toEqual({ terminated: true })
      expect(fake.daemon.killTerminal).toHaveBeenCalledWith(created.terminalId)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('replaces a legacy hidden Site terminal registered outside the Notebook directory', async () => {
    const cwd = '/external/site'
    const setup = await startedRuntime(fakePaseoConnection({ listed: [{
      id: 'hidden-site', workspaceId: 'workspace-1', cwd, name: 'hypercanvas:site:external',
    }] }))
    setup.fake.connection.client.workspaces.ref.mockImplementation(id => ({ current: () => ({ id, workspaceDirectory: projectRoot }) }))
    const created = await setup.runtime.create({ sessionId: 'site:external', workspaceId: 'workspace-1', cwd, program: '/bin/sh' })
    expect(created.reused).toBe(false)
    expect(setup.fake.daemon.killTerminal).toHaveBeenCalledWith('hidden-site')
    expect(setup.fake.daemon.createTerminal.mock.calls[0][0]).toBe(projectRoot)
  })

  it('reuses a named terminal already present in the resolved workspace', async () => {
    const existing = {
      id: 'terminal-existing',
      workspaceId: 'workspace-1',
      cwd: projectRoot,
      name: 'hypercanvas:session-1',
    }
    const setup = await startedRuntime(fakePaseoConnection({ listed: [existing] }))

    await expect(setup.runtime.create({ sessionId: 'session-1', cwd: projectRoot })).resolves.toMatchObject({
      terminalId: 'terminal-existing',
      reused: true,
    })
    expect(setup.fake.daemon.createTerminal).not.toHaveBeenCalled()
  })

  it('does not reuse a logical terminal binding from a different active Notebook workspace', async () => {
    const setup = await startedRuntime()
    await setup.runtime.create({ sessionId: 'shared-session', cwd: '/Notebook One', workspaceId: 'workspace-one' })

    const second = await setup.runtime.create({ sessionId: 'shared-session', cwd: '/Notebook Two', workspaceId: 'workspace-two' })

    expect(setup.fake.daemon.createTerminal).toHaveBeenCalledTimes(2)
    expect(setup.fake.daemon.createTerminal).toHaveBeenNthCalledWith(
      1,
      '/Notebook One',
      'hypercanvas:shared-session',
      undefined,
      expect.objectContaining({ workspaceId: 'workspace-one' }),
    )
    expect(setup.fake.daemon.createTerminal).toHaveBeenNthCalledWith(
      2,
      '/Notebook Two',
      'hypercanvas:shared-session',
      undefined,
      expect.objectContaining({ workspaceId: 'workspace-two' }),
    )
    expect(second).toMatchObject({ workspaceId: 'workspace-two', reused: false })
    expect(setup.fake.daemon.killTerminal).toHaveBeenCalledWith('terminal-1')
  })

  it('updates the shared PTY runtime root when the active Notebook changes', async () => {
    const fake = fakePaseoConnection()
    const first = await initPaseoTerminalRuntime('/Notebook One', { connection: fake.connection })
    const second = await initPaseoTerminalRuntime('/Notebook Two', { connection: fake.connection })

    expect(second).toBe(first)
    await second.create({ sessionId: 'switched-root', workspaceId: 'workspace-two' })

    expect(fake.daemon.listTerminals).toHaveBeenCalledWith('/Notebook Two', undefined, { workspaceId: 'workspace-two' })
    expect(fake.daemon.createTerminal).toHaveBeenCalledWith(
      '/Notebook Two',
      'hypercanvas:switched-root',
      undefined,
      expect.objectContaining({ workspaceId: 'workspace-two' }),
    )
  })

  it('multiplexes subscribers over one Paseo terminal stream', async () => {
    await runtime.create({ sessionId: 'session-1', cwd: projectRoot })
    const firstOutput = vi.fn()
    const secondOutput = vi.fn()
    const first = await runtime.subscribe('session-1', { clientId: 'first', onOutput: firstOutput })
    const second = await runtime.subscribe('session-1', { clientId: 'second', onOutput: secondOutput })

    expect(fake.daemon.subscribeTerminal).toHaveBeenCalledOnce()
    fake.emitStream({ terminalId: 'terminal-1', type: 'output', data: Uint8Array.from([104, 105]) })
    expect(firstOutput).toHaveBeenCalledWith(expect.objectContaining({
      event: 'output',
      sequence: 1,
      bytes: [104, 105],
    }))
    expect(secondOutput).toHaveBeenCalledOnce()

    first.close()
    expect(fake.daemon.unsubscribeTerminal).not.toHaveBeenCalled()
    second.close()
    expect(fake.daemon.unsubscribeTerminal).toHaveBeenCalledWith('terminal-1')
  })

  it('reports daemon loss and restores terminal streams after SDK reconnection', async () => {
    await runtime.create({ sessionId: 'session-1', cwd: projectRoot })
    const onError = vi.fn()
    await runtime.subscribe('session-1', { onError })
    expect(fake.daemon.subscribeTerminal).toHaveBeenCalledOnce()

    fake.setConnectionState({ status: 'disconnected', reason: 'network interrupted' })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PASEO_UNAVAILABLE',
      operation: 'subscribe',
    }))
    await expect(runtime.health()).resolves.toMatchObject({
      connected: false,
      recoveryState: 'disconnected',
      lastError: 'network interrupted',
    })

    fake.setConnectionState({ status: 'connected' })
    await vi.waitFor(() => expect(fake.daemon.subscribeTerminal).toHaveBeenCalledTimes(2))
    expect(fake.daemon.subscribeTerminal).toHaveBeenLastCalledWith('terminal-1', expect.objectContaining({
      restore: expect.objectContaining({ mode: 'full-snapshot' }),
    }))
    await runtime.shutdown()
  })

  it('normalizes restore, snapshot, and exit events', async () => {
    await runtime.create({ sessionId: 'session-1', cwd: projectRoot })
    const onGap = vi.fn()
    const onExit = vi.fn()
    await runtime.subscribe('session-1', { onGap, onExit })

    fake.emitStream({ terminalId: 'terminal-1', type: 'restore', data: Buffer.from('restored') })
    fake.emitStream({
      terminalId: 'terminal-1',
      type: 'snapshot',
      state: {
        cols: 2,
        rows: 1,
        scrollback: [[{ char: 'a' }]],
        grid: [[{ char: 'b' }, { char: ' ' }]],
      },
    })
    fake.emitRaw({ type: 'terminal_stream_exit', payload: { terminalId: 'terminal-1' } })

    expect(onGap).toHaveBeenNthCalledWith(1, expect.objectContaining({
      snapshot: expect.objectContaining({ screen: 'restored' }),
    }))
    expect(onGap).toHaveBeenNthCalledWith(2, expect.objectContaining({
      snapshot: expect.objectContaining({ cols: 2, rows: 1, screen: 'b', text: 'a\nb', ansi: expect.any(String) }),
    }))
    expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ event: 'exit' }))
    await expect(runtime.get('session-1')).resolves.toMatchObject({ running: false })
  })

  it('maps write, resize, capture, detach, list, and termination', async () => {
    await runtime.create({ sessionId: 'session-1', cwd: projectRoot, cols: 80, rows: 24 })

    await expect(runtime.writeBytes('session-1', Buffer.from('hello'))).resolves.toEqual({ written: 5 })
    expect(fake.daemon.sendTerminalInput).toHaveBeenNthCalledWith(1, 'terminal-1', {
      type: 'input',
      data: 'hello',
    })
    await expect(runtime.resize('session-1', 120, 50)).resolves.toEqual({ cols: 120, rows: 50 })
    expect(fake.daemon.sendTerminalInput).toHaveBeenNthCalledWith(2, 'terminal-1', {
      type: 'resize',
      cols: 120,
      rows: 50,
      intent: 'claim',
    })
    await expect(runtime.snapshot('session-1')).resolves.toMatchObject({
      cols: 120,
      rows: 50,
      screen: 'one\ntwo',
      text: 'one\ntwo',
    })
    await expect(runtime.detach('session-1', 1234)).resolves.toMatchObject({
      status: 'background',
      expiresAtMs: 1234,
    })
    await expect(runtime.list()).resolves.toEqual({
      sessions: [expect.objectContaining({ sessionId: 'session-1', running: true })],
    })
    await expect(runtime.terminate('session-1')).resolves.toEqual({ terminated: true })
    expect(fake.daemon.killTerminal).toHaveBeenCalledWith('terminal-1')
    await expect(runtime.exists('session-1')).resolves.toEqual({ exists: false })
  })

  it('finds and closes a Site terminal tab after the in-memory runtime has restarted', async () => {
    const setup = await startedRuntime()
    await setup.runtime.create({
      sessionId: 'site:docs',
      cwd: '/Notebook/sites/docs',
      workspaceId: 'workspace-site',
      program: '/bin/sh',
      args: ['-lc', 'npm run dev'],
    })
    const restartedRuntime = new PaseoTerminalRuntime(projectRoot, { connection: setup.fake.connection })
    await restartedRuntime.start()

    await expect(restartedRuntime.terminate({
      sessionId: 'site:docs',
      workspaceId: 'workspace-site',
      cwd: '/Notebook/sites/docs',
    })).resolves.toEqual({ terminated: true })

    expect(setup.fake.daemon.listTerminals).toHaveBeenLastCalledWith('/Notebook/sites/docs', undefined, { workspaceId: 'workspace-site' })
    expect(setup.fake.daemon.killTerminal).toHaveBeenCalledWith('terminal-1')
    await expect(setup.fake.daemon.listTerminals('/Notebook/sites/docs', undefined, { workspaceId: 'workspace-site' })).resolves.toEqual({
      cwd: '/Notebook/sites/docs',
      terminals: [],
    })
  })

  it('wraps connection failures with an actionable typed error', async () => {
    const cause = new Error('connection refused')
    const unavailable = new PaseoTerminalRuntime(projectRoot, {
      env: { PASEO_DAEMON_URL: 'ws://127.0.0.1:9999/ws' },
      connectionFactory: vi.fn().mockRejectedValue(cause),
    })

    await expect(unavailable.start()).rejects.toEqual(expect.objectContaining({
      name: 'PaseoTerminalRuntimeError',
      operation: 'startup',
      code: 'PASEO_UNAVAILABLE',
      cause,
      message: expect.stringContaining('configured Paseo daemon'),
    }))
  })

  it('preserves operation, code, and cause on typed errors', () => {
    const cause = new Error('daemon broke')
    const error = new PaseoTerminalRuntimeError('failed', { operation: 'health', code: 'CONNECTION_FAILED', cause })
    expect(error).toMatchObject({ operation: 'health', code: 'CONNECTION_FAILED', cause })
  })
})
