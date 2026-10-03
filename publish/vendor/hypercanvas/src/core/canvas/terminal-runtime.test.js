import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  cleanup: vi.fn(),
  create: vi.fn(),
  detach: vi.fn(),
  exists: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  resize: vi.fn(),
  snapshot: vi.fn(),
  subscribe: vi.fn(),
  terminate: vi.fn(),
  writeBytes: vi.fn(),
}))

vi.mock('./paseo-terminal-runtime.js', () => ({ getPaseoTerminalRuntime: () => runtime }))

import {
  createTerminalSession,
  detachTerminalSession,
  listRuntimeSessions,
  registerRuntimeSession,
  resetTerminalRuntimeForTests,
  resolveRuntimeSessionId,
  resizeTerminalSession,
  subscribeTerminalSession,
  submitTerminalText,
  terminateTerminalSession,
  withTerminalStartup,
  writeTerminalBytes,
} from './terminal-runtime.js'

describe('terminal runtime adapter', () => {
  beforeEach(() => {
    resetTerminalRuntimeForTests()
    vi.clearAllMocks()
    runtime.subscribe.mockImplementation(async () => ({ close: vi.fn(), initial: {} }))
    runtime.list.mockResolvedValue({ sessions: [] })
    runtime.exists.mockResolvedValue({ exists: true })
  })

  it('keeps broker output subscriptions read-only behind one service writer', async () => {
    registerRuntimeSession('logical-session', 'runtime-session')

    const subscription = await subscribeTerminalSession('logical-session', { readOnly: false })

    expect(runtime.subscribe).toHaveBeenCalledTimes(2)
    expect(runtime.subscribe.mock.calls[0][0]).toBe('runtime-session')
    expect(runtime.subscribe.mock.calls[0][1]).toMatchObject({
      clientId: expect.stringMatching(/-service$/),
      readOnly: false,
    })
    expect(runtime.subscribe.mock.calls[1][1]).toMatchObject({ readOnly: true })
    subscription.close()
  })

  it('routes writes and resizes through the stable service writer', async () => {
    registerRuntimeSession('logical-session', 'runtime-session')

    await writeTerminalBytes('logical-session', Buffer.from('hello'))
    await resizeTerminalSession('logical-session', 100, 40)

    expect(runtime.subscribe).toHaveBeenCalledTimes(1)
    const writerId = runtime.subscribe.mock.calls[0][1].clientId
    expect(runtime.writeBytes).toHaveBeenCalledWith('runtime-session', Buffer.from('hello'), writerId)
    expect(runtime.resize).toHaveBeenCalledWith('runtime-session', 100, 40, writerId)
  })

  it('submits text to the resolved live PTY without adding Enter by default', async () => {
    registerRuntimeSession('logical-session', 'runtime-session')
    runtime.writeBytes.mockResolvedValue({ written: 5 })

    await expect(submitTerminalText('logical-session', 'hello')).resolves.toEqual({
      accepted: true,
      written: 5,
      submitted: false,
    })

    expect(runtime.exists).toHaveBeenCalledWith('runtime-session')
    expect(runtime.writeBytes).toHaveBeenCalledWith('runtime-session', Buffer.from('hello'), expect.any(String))
  })

  it('sends explicit Enter after text settles, with no interleaved writes', async () => {
    registerRuntimeSession('logical-session', 'runtime-session')
    runtime.writeBytes.mockResolvedValueOnce({ written: 5 }).mockResolvedValueOnce({ written: 1 })

    await expect(submitTerminalText('logical-session', 'hello', { submit: true })).resolves.toEqual({
      accepted: true,
      written: 6,
      submitted: true,
    })

    expect(runtime.writeBytes).toHaveBeenNthCalledWith(1, 'runtime-session', Buffer.from('hello'), expect.any(String))
    expect(runtime.writeBytes).toHaveBeenNthCalledWith(2, 'runtime-session', Buffer.from('\r'), expect.any(String))
  })

  it('brackets pasted content and stops Enter if the managed process exits during the paste', async () => {
    const canWrite = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    await expect(submitTerminalText('logical-session', 'context', { submit: true, paste: true, canWrite })).rejects.toMatchObject({ code: 'AGENT_NOT_READY' })
    expect(runtime.writeBytes).toHaveBeenCalledTimes(1)
    expect(runtime.writeBytes.mock.calls[0][1]).toEqual(Buffer.from('\x1b[200~context\x1b[201~'))
  })

  it('rejects missing sessions and invalid input before writing', async () => {
    runtime.exists.mockResolvedValue({ exists: false })

    await expect(submitTerminalText('missing-session', 'hello')).rejects.toMatchObject({
      code: 'TERMINAL_NOT_RUNNING',
      statusCode: 410,
    })
    await expect(submitTerminalText('session-1', null)).rejects.toMatchObject({ code: 'INVALID_TERMINAL_TEXT' })
    await expect(submitTerminalText('session-1', 'hello', { submit: 'yes' })).rejects.toMatchObject({ code: 'INVALID_SUBMIT_OPTION' })
    expect(runtime.writeBytes).not.toHaveBeenCalled()
  })

  it('unwraps the broker list response', async () => {
    runtime.list.mockResolvedValue({ sessions: [{ sessionId: 'one' }] })

    await expect(listRuntimeSessions()).resolves.toEqual([{ sessionId: 'one' }])
  })

  it('forwards the active Notebook workspace through the terminal adapter', async () => {
    runtime.create.mockResolvedValue({ sessionId: 'logical-session', workspaceId: 'notebook-workspace' })

    await createTerminalSession('logical-session', {
      program: '/bin/zsh',
      cwd: '/Users/danielfosco/Documents/hypercanvas/demo',
      workspaceId: 'notebook-workspace',
    })

    expect(runtime.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'logical-session',
      cwd: '/Users/danielfosco/Documents/hypercanvas/demo',
      workspaceId: 'notebook-workspace',
    }))
  })

  it('releases writer ownership before detaching', async () => {
    const close = vi.fn()
    runtime.subscribe.mockResolvedValue({ close, initial: {} })
    registerRuntimeSession('logical-session', 'runtime-session')
    await writeTerminalBytes('logical-session', Buffer.from('hello'))

    await detachTerminalSession('logical-session', 1234)

    expect(close).toHaveBeenCalledOnce()
    expect(runtime.detach).toHaveBeenCalledWith('runtime-session', 1234)
  })

  it('serializes reconnect behind an in-flight detach', async () => {
    let finishDetach
    runtime.detach.mockReturnValue(new Promise((resolve) => { finishDetach = resolve }))
    registerRuntimeSession('logical-session', 'runtime-session')

    const detaching = detachTerminalSession('logical-session', 1234)
    const reconnecting = subscribeTerminalSession('logical-session')
    await Promise.resolve()
    expect(runtime.subscribe).not.toHaveBeenCalled()

    finishDetach({ status: 'background' })
    await detaching
    await reconnecting
    expect(runtime.subscribe).toHaveBeenCalledTimes(2)
  })

  it('serializes writes behind an in-flight detach', async () => {
    let finishDetach
    runtime.detach.mockReturnValue(new Promise((resolve) => { finishDetach = resolve }))
    registerRuntimeSession('logical-session', 'runtime-session')
    await writeTerminalBytes('logical-session', Buffer.from('first'))

    const detaching = detachTerminalSession('logical-session', 1234)
    const writing = writeTerminalBytes('logical-session', Buffer.from('second'))
    await Promise.resolve()
    expect(runtime.writeBytes).toHaveBeenCalledTimes(1)

    finishDetach({ status: 'background' })
    await detaching
    await writing
    expect(runtime.writeBytes).toHaveBeenCalledTimes(2)
  })

  it('rolls back an uncertain broker create and its logical alias', async () => {
    runtime.create.mockRejectedValue(new Error('response lost'))
    runtime.terminate.mockResolvedValue({ terminated: true })

    await expect(createTerminalSession('logical-session', {
      runtimeSessionId: 'runtime-session',
      program: '/bin/sh',
    })).rejects.toThrow('response lost')

    expect(runtime.terminate).toHaveBeenCalledWith('runtime-session')
    expect(resolveRuntimeSessionId('logical-session')).toBe('logical-session')
  })

  it('serializes startup work for one logical terminal', async () => {
    let finishFirst
    const order = []
    const first = withTerminalStartup('canvas:widget', async () => {
      order.push('first:start')
      await new Promise((resolve) => { finishFirst = resolve })
      order.push('first:end')
    })
    const second = withTerminalStartup('canvas:widget', async () => { order.push('second') })
    await vi.waitFor(() => expect(order).toEqual(['first:start']))

    finishFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('retains the logical alias when termination fails', async () => {
    runtime.terminate.mockRejectedValue(new Error('broker unavailable'))
    registerRuntimeSession('logical-session', 'runtime-session')

    await expect(terminateTerminalSession('logical-session')).rejects.toThrow('broker unavailable')
    expect(resolveRuntimeSessionId('logical-session')).toBe('runtime-session')
  })
})
