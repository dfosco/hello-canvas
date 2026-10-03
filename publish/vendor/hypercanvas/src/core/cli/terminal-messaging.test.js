import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./serverUrl.js', () => ({ getServerUrl: () => 'http://localhost:4321' }))

import { handleInput, requestTerminalInput } from './terminal-messaging.js'

const originalArgv = process.argv

afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

describe('terminal input CLI', () => {
  it('targets a widget and leaves Enter out unless requested', async () => {
    process.argv = ['node', 'storyboard', 'terminal', 'input', '--widget', 'agent-1', '--text', 'hello']
    const fetch = vi.fn(async () => response({ success: true, accepted: true, written: 5, submitted: false }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await handleInput()

    expect(fetch).toHaveBeenCalledWith('http://localhost:4321/_storyboard/canvas/terminal/input', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ widgetId: 'agent-1', text: 'hello', submit: false }),
    }))
    expect(console.log).toHaveBeenCalledWith('Terminal runtime accepted 5 bytes; Enter not sent.')
  })

  it('maps --enter and target qualifiers to the API contract', async () => {
    process.argv = [
      'node', 'storyboard', 'terminal', 'input',
      '--session', 'session-1', '--text', 'yes', '--enter', '--canvas', 'design', '--branch', 'feature',
    ]
    const fetch = vi.fn(async () => response({ success: true, accepted: true, written: 4, submitted: true }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await handleInput()

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      sessionId: 'session-1', text: 'yes', submit: true, canvasId: 'design', branch: 'feature',
    })
    expect(console.log).toHaveBeenCalledWith('Terminal runtime accepted 4 bytes; Enter sent.')
  })

  it('maps bracketed paste explicitly without changing ordinary text input', async () => {
    process.argv = ['node', 'storyboard', 'terminal', 'input', '--widget', 'agent-1', '--text', 'context', '--paste', '--enter']
    const fetch = vi.fn(async () => response({ success: true }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await handleInput()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ widgetId: 'agent-1', text: 'context', submit: true, paste: true })
  })

  it('preserves an explicitly empty text argument', async () => {
    process.argv = ['node', 'storyboard', 'terminal', 'input', '--widget', 'agent-1', '--text', '']
    const fetch = vi.fn(async () => response({ success: true, accepted: true, written: 0, submitted: false }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await handleInput()

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ widgetId: 'agent-1', text: '', submit: false })
  })

  it('accepts text beginning with an option marker using --text=', async () => {
    process.argv = ['node', 'storyboard', 'terminal', 'input', '--widget', 'agent-1', '--text=--help']
    const fetch = vi.fn(async () => response({ success: true, accepted: true, written: 6, submitted: false }))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await handleInput()

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ widgetId: 'agent-1', text: '--help', submit: false })
  })

  it('preserves API error codes for CLI callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'AMBIGUOUS_TERMINAL_TARGET', error: 'Choose a session' }, { ok: false, status: 409 })))

    await expect(requestTerminalInput({ widgetId: 'agent-1', text: 'hello' })).rejects.toMatchObject({
      message: 'Choose a session',
      code: 'AMBIGUOUS_TERMINAL_TARGET',
      statusCode: 409,
    })
  })
})
