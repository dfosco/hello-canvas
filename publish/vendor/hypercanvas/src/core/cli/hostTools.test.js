import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from './cliHelpers.js'
import { hostToolsHelp, parseAgentSelection, runHostToolsCommand } from './hostTools.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function request() {
  return {
    get: vi.fn(async (path) => ({ method: 'GET', path })),
    post: vi.fn(async (path, body) => ({ method: 'POST', path, body })),
  }
}

describe('host tools CLI', () => {
  it('maps every command 1:1 to its API route and fields', async () => {
    const api = request()
    await expect(runHostToolsCommand(['preflight'], api)).resolves.toEqual({ method: 'GET', path: '/_storyboard/host-tools/preflight' })
    await expect(runHostToolsCommand(['plan', '--agents', 'claude,codex', '--agents', 'opencode'], api)).resolves.toMatchObject({
      method: 'POST',
      path: '/_storyboard/host-tools/plan',
      body: { selectedAgentIds: ['claude', 'codex', 'opencode'] },
    })
    await expect(runHostToolsCommand(['install', '--plan', 'plan-1', '--consent'], api)).resolves.toMatchObject({
      path: '/_storyboard/host-tools/install',
      body: { planId: 'plan-1', consent: true },
    })
    await expect(runHostToolsCommand(['status', '--operation', 'operation-1'], api)).resolves.toEqual({
      method: 'GET',
      path: '/_storyboard/host-tools/operations/operation-1',
    })
    await expect(runHostToolsCommand(['cancel', '--operation', 'operation-1'], api)).resolves.toMatchObject({
      path: '/_storyboard/host-tools/operations/operation-1/cancel',
      body: {},
    })
  })

  it('creates a baseline-only plan when --agents is omitted', async () => {
    const api = request()
    await runHostToolsCommand(['plan'], api)
    expect(api.post).toHaveBeenCalledWith('/_storyboard/host-tools/plan', { selectedAgentIds: [] })
  })

  it.each([
    [['unknown'], 'Unknown agent ID'],
    [['claude,'], 'empty agent ID'],
    [['claude', 'claude'], 'unique agent IDs'],
  ])('rejects invalid agent flags', (values, message) => {
    expect(() => parseAgentSelection(values)).toThrow(message)
  })

  it('rejects missing, unknown, and positional inputs before requesting', async () => {
    const api = request()
    await expect(runHostToolsCommand(['install', '--plan', 'plan-1'], api)).rejects.toThrow('--consent')
    await expect(runHostToolsCommand(['status', '--operation', 'op-1', '--extra'], api)).rejects.toThrow('Unknown flag')
    await expect(runHostToolsCommand(['cancel', 'op-1'], api)).rejects.toThrow('Unexpected arguments')
    expect(api.get).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('provides group and command help without making a request', async () => {
    const api = request()
    expect(hostToolsHelp()).toContain('plan --agents')
    await expect(runHostToolsCommand(['install', '--help'], api)).resolves.toMatchObject({ help: expect.stringContaining('--consent') })
    expect(api.get).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('uses the explicit workspace service URL with its branch base path', async () => {
    const previousBase = process.env.VITE_BASE_PATH
    const previousServer = process.env.STORYBOARD_SERVER_URL
    const previousHypercanvas = process.env.HYPERCANVAS_SERVER_URL
    process.env.VITE_BASE_PATH = '/branch--feature/'
    process.env.HYPERCANVAS_SERVER_URL = 'http://localhost:4321/branch--feature/'
    delete process.env.STORYBOARD_SERVER_URL
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'supported' }) }))
    vi.stubGlobal('fetch', fetch)

    try {
      await get('/_storyboard/host-tools/preflight')
      expect(fetch.mock.calls[0][0]).toBe('http://localhost:4321/branch--feature/_storyboard/host-tools/preflight')
    } finally {
      if (previousBase === undefined) delete process.env.VITE_BASE_PATH
      else process.env.VITE_BASE_PATH = previousBase
      if (previousServer === undefined) delete process.env.STORYBOARD_SERVER_URL
      else process.env.STORYBOARD_SERVER_URL = previousServer
      if (previousHypercanvas === undefined) delete process.env.HYPERCANVAS_SERVER_URL
      else process.env.HYPERCANVAS_SERVER_URL = previousHypercanvas
    }
  })
})
