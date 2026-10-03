import { createHostToolsBrowserClient, hostToolsApiBase } from './browser-client.js'

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('host-tools browser client', () => {
  it('keeps host-tools requests under a branch base path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'supported' }))
    const client = createHostToolsBrowserClient({ fetchImpl, basePath: '/branch--feature/' })

    await client.preflight()

    expect(fetchImpl).toHaveBeenCalledWith('/branch--feature/_storyboard/host-tools/preflight', {
      method: 'GET',
    })
    expect(hostToolsApiBase('/')).toBe('/_storyboard/host-tools')
  })

  it('sends only code-owned agent, plan, and operation inputs', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'plan-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1' }, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', status: 'running' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', status: 'cancelled' }))
    const client = createHostToolsBrowserClient({ fetchImpl, basePath: '/' })

    await client.plan(['codex', 'claude'])
    await client.install('plan-1')
    await client.operation('operation-1')
    await client.cancel('operation-1')

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ selectedAgentIds: ['codex', 'claude'] })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ planId: 'plan-1', consent: true })
    expect(fetchImpl.mock.calls[2][0]).toBe('/_storyboard/host-tools/operations/operation-1')
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({})
    expect(() => client.plan(['custom-agent'])).toThrow('Agent IDs')
    expect(() => client.install('../bad')).toThrow('Plan ID')
  })

  it('surfaces safe server failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'UNSUPPORTED_PLATFORM', message: 'Host installation supports macOS arm64 only' },
    }, { ok: false, status: 422 }))
    const client = createHostToolsBrowserClient({ fetchImpl })

    await expect(client.plan(['codex'])).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
      status: 422,
      message: 'Host installation supports macOS arm64 only',
    })
  })
})
