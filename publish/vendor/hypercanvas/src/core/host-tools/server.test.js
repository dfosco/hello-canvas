import { describe, expect, it, vi } from 'vitest'
import { createHostToolsHandler } from './server.js'

function installerError(code, message, details) {
  return Object.assign(new Error(message), { code, details })
}

function setup(overrides = {}) {
  const operation = { id: 'operation-1', status: 'running' }
  const installer = {
    createPlan: vi.fn(async (input) => ({ id: 'plan-1', ...input })),
    startInstall: vi.fn(async (input) => ({ id: 'operation-1', planId: input.planId, status: 'queued' })),
    getOperation: vi.fn((id) => id === 'operation-1' ? operation : null),
    cancelOperation: vi.fn((id) => ({ ...operation, id, cancellation: { requested: true } })),
    ...overrides.installer,
  }
  const preflight = overrides.preflight || vi.fn(async () => ({ status: 'supported' }))
  const response = { status: null, body: null }
  const handler = createHostToolsHandler({
    installer,
    preflight,
    sendJson: (_res, status, body) => Object.assign(response, { status, body }),
  })

  async function invoke(method, path, body = {}, request = {}) {
    response.status = null
    response.body = null
    const req = {
      method,
      headers: {
        host: 'localhost:1234',
        'content-type': 'application/json',
        ...request.headers,
      },
      socket: { remoteAddress: '127.0.0.1', ...request.socket },
    }
    await handler(req, {}, { method, path, body })
    return { ...response }
  }

  return { installer, invoke, preflight }
}

describe('host tools server handler', () => {
  it('serves preflight without requiring mutation headers', async () => {
    const { invoke, preflight } = setup()
    const result = await invoke('GET', '/preflight', {}, { headers: { 'content-type': undefined }, socket: { remoteAddress: '10.0.0.2' } })

    expect(result).toEqual({ status: 200, body: { status: 'supported' } })
    expect(preflight).toHaveBeenCalledOnce()
  })

  it('forwards the complete happy flow with exact service fields', async () => {
    const { installer, invoke } = setup()

    expect(await invoke('POST', '/plan', { selectedAgentIds: ['claude', 'codex'] })).toMatchObject({ status: 200, body: { id: 'plan-1' } })
    expect(installer.createPlan).toHaveBeenCalledWith({ selectedAgentIds: ['claude', 'codex'] })

    expect(await invoke('POST', '/install', { planId: 'plan-1', consent: true })).toMatchObject({ status: 202, body: { id: 'operation-1' } })
    expect(installer.startInstall).toHaveBeenCalledWith({ planId: 'plan-1', consent: true })

    expect(await invoke('GET', '/operations/operation-1')).toMatchObject({ status: 200, body: { id: 'operation-1' } })
    expect(await invoke('POST', '/operations/operation-1/cancel', {})).toMatchObject({ status: 200, body: { id: 'operation-1' } })
    expect(installer.cancelOperation).toHaveBeenCalledWith('operation-1')
  })

  it('rejects extra caller-controlled command, URL, path, and env fields', async () => {
    const { invoke } = setup()
    for (const field of ['command', 'url', 'path', 'env']) {
      const result = await invoke('POST', '/plan', { selectedAgentIds: [], [field]: 'caller-value' })
      expect(result.status).toBe(400)
      expect(result.body.error.code).toBe('INVALID_INPUT')
    }
  })

  it('enforces the code-owned agent enum and unique selections', async () => {
    const { invoke } = setup()
    for (const selectedAgentIds of [['other'], ['claude', 'claude'], 'claude']) {
      const result = await invoke('POST', '/plan', { selectedAgentIds })
      expect(result.status).toBe(400)
      expect(result.body.error.code).toBe('INVALID_AGENT_SELECTION')
    }
  })

  it.each([
    ['UNSUPPORTED_PLATFORM', 422],
    ['PLAN_ALREADY_USED', 409],
    ['OPERATION_ACTIVE', 409],
    ['STALE_PLAN', 409],
    ['PLAN_NOT_FOUND', 404],
  ])('maps %s installer errors to %i', async (code, status) => {
    const { invoke } = setup({
      installer: { createPlan: vi.fn(async () => { throw installerError(code, `${code} message`) }) },
    })
    const result = await invoke('POST', '/plan', { selectedAgentIds: [] })
    expect(result).toEqual({ status, body: { error: { code, message: `${code} message` } } })
  })

  it('rejects install without explicit consent', async () => {
    const { invoke } = setup()
    const result = await invoke('POST', '/install', { planId: 'plan-1' })
    expect(result.status).toBe(422)
    expect(result.body.error.code).toBe('CONSENT_REQUIRED')
  })

  it('returns 404 for an unknown operation', async () => {
    const { invoke } = setup()
    const result = await invoke('GET', '/operations/unknown-operation')
    expect(result.status).toBe(404)
    expect(result.body.error.code).toBe('OPERATION_NOT_FOUND')
  })

  it('requires loopback for mutations', async () => {
    const { invoke } = setup()
    const result = await invoke('POST', '/plan', { selectedAgentIds: [] }, { socket: { remoteAddress: '192.168.1.8' } })
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('LOOPBACK_REQUIRED')
  })

  it('rejects DNS-rebinding hosts even when the socket is loopback', async () => {
    const { invoke } = setup()
    const result = await invoke('POST', '/plan', { selectedAgentIds: [] }, {
      headers: { origin: 'https://evil.test', host: 'evil.test', 'x-forwarded-proto': 'https' },
    })
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('LOCAL_HOST_REQUIRED')
  })

  it('requires application/json for POST', async () => {
    const { invoke } = setup()
    const result = await invoke('POST', '/plan', { selectedAgentIds: [] }, { headers: { 'content-type': 'text/plain' } })
    expect(result.status).toBe(415)
    expect(result.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('accepts a matching forwarded origin and rejects mismatches', async () => {
    const { invoke } = setup()
    const accepted = await invoke('POST', '/plan', { selectedAgentIds: [] }, {
      headers: { origin: 'https://canvas.localhost', host: 'canvas.localhost', 'x-forwarded-proto': 'https' },
    })
    expect(accepted.status).toBe(200)

    const rejected = await invoke('POST', '/plan', { selectedAgentIds: [] }, {
      headers: { origin: 'https://evil.localhost', host: 'canvas.localhost', 'x-forwarded-proto': 'https' },
    })
    expect(rejected.status).toBe(403)
    expect(rejected.body.error.code).toBe('ORIGIN_MISMATCH')
  })

  it('does not expose installer error details or credentials', async () => {
    const { invoke } = setup({
      installer: {
        createPlan: vi.fn(async () => {
          throw installerError('STALE_PLAN', 'Create a fresh plan', { token: 'secret-token' })
        }),
      },
    })
    const result = await invoke('POST', '/plan', { selectedAgentIds: [] })
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })
})
