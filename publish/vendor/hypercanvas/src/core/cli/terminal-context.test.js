import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./serverUrl.js', () => ({ getServerUrl: () => 'http://localhost:4321' }))
import { handleTerminalContext, requestTerminalContext } from './terminal-context.js'
const argv = process.argv
const exitCode = process.exitCode

afterEach(() => { process.argv = argv; process.exitCode = exitCode; vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each([
  [['--widget', 'terminal-test', '--ack', 'rev', '--launch', 'launch'], { widgetId: 'terminal-test', action: 'ack', revision: 'rev', launchId: 'launch' }],
  [['--widget', 'terminal-test', '--retry'], { widgetId: 'terminal-test', action: 'retry' }],
  [['--widget', 'terminal-test', '--action', 'start', '--revision', 'rev', '--launch', 'launch', '--interactive', 'false'], { widgetId: 'terminal-test', action: 'start', revision: 'rev', launchId: 'launch', interactive: false }],
])('maps context CLI fields directly to the API', async (args, body) => {
  process.argv = ['node', 'storyboard', 'terminal', 'context', ...args]
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, state: {} }) }))
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await handleTerminalContext()
  expect(fetch.mock.calls[0][0]).toBe('http://localhost:4321/_storyboard/canvas/terminal/context')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body)
})

it('reports stale receipt and other API failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Stale managed launch' }) })))
  await expect(requestTerminalContext({ widgetId: 'terminal-test', action: 'ack' })).rejects.toThrow('Stale managed launch')
})
