import { EventEmitter } from 'node:events'
import http from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createApiMiddleware } from './api-router.js'

function setup({ base = '/', maxBodyBytes } = {}) {
  const response = { status: null, body: null }
  const handler = vi.fn(async (_req, res, ctx) => {
    res.route = ctx
    response.status = 200
    response.body = ctx.body
  })
  const middleware = createApiMiddleware({
    base,
    maxBodyBytes,
    routeHandlers: new Map([['host-tools', handler], ['file', handler], ['frame-snapshot', handler]]),
    sendJson: (_res, status, body) => Object.assign(response, { status, body }),
    ws: { send: vi.fn() },
  })

  async function invoke({ method = 'GET', url, body, headers = {} }) {
    const req = new EventEmitter()
    Object.assign(req, {
      method,
      url,
      headers,
      socket: { remoteAddress: '127.0.0.1' },
      resume: vi.fn(),
    })
    const res = {}
    const next = vi.fn()
    const pending = middleware(req, res, next)
    if (body !== undefined) req.emit('data', body)
    req.emit('end')
    await pending
    return { response: { ...response }, handler, next, res }
  }

  return { invoke }
}

describe('storyboard API router body parsing', () => {
  it('routes query-bearing URLs by path and hands the query to the handler', async () => {
    const { invoke } = setup()
    const result = await invoke({
      url: '/_storyboard/frame-snapshot?kind=prototype&src=%2FStartupSignup&zoom=100',
    })

    expect(result.response.status).toBe(200)
    expect(result.res.__sbLogCtx.route).toBe('frame-snapshot')
    expect(result.res.route.path).toBe('/')
  })

  it('keeps the query on sub-routed paths', async () => {
    const { invoke } = setup()
    const result = await invoke({ url: '/_storyboard/frame-snapshot/capability?detail=1' })
    expect(result.response.status).toBe(200)
    expect(result.res.__sbLogCtx.route).toBe('frame-snapshot')
    expect(result.res.route.path).toBe('/capability?detail=1')
  })

  it('does not send query-bearing routes to the fallback proxy', async () => {
    const { invoke } = setup()
    const result = await invoke({ url: '/_storyboard/file/read?path=README.md' })
    expect(result.response.status).toBe(200)
    expect(result.res.__sbLogCtx.route).toBe('file')
  })

  it('routes through a Vite base path and preserves the host-tools subpath', async () => {
    const { invoke } = setup({ base: '/branch--feature/' })
    const result = await invoke({
      method: 'POST',
      url: '/branch--feature/_storyboard/host-tools/plan',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedAgentIds: ['claude'] }),
    })

    expect(result.response).toEqual({ status: 200, body: { selectedAgentIds: ['claude'] } })
    expect(result.res.route.path).toBe('/plan')
    expect(result.res.__sbLogCtx.url).toBe('/_storyboard/host-tools/plan')
  })

  it('returns 400 instead of 500 for malformed JSON', async () => {
    const { invoke } = setup()
    const result = await invoke({ method: 'POST', url: '/_storyboard/host-tools/plan', body: '{bad json' })
    expect(result.response).toEqual({ status: 400, body: { error: 'Invalid JSON body', code: 'INVALID_JSON' } })
    expect(result.handler).not.toHaveBeenCalled()
  })

  it('returns 413 when the streamed body exceeds the limit', async () => {
    const { invoke } = setup({ maxBodyBytes: 16 })
    const result = await invoke({ method: 'POST', url: '/_storyboard/host-tools/plan', body: JSON.stringify({ selectedAgentIds: [] }) })
    expect(result.response.status).toBe(413)
    expect(result.response.body.code).toBe('REQUEST_BODY_TOO_LARGE')
    expect(result.handler).not.toHaveBeenCalled()
  })

  it('rejects oversized declared content length before reading', async () => {
    const { invoke } = setup({ maxBodyBytes: 16 })
    const result = await invoke({
      method: 'POST',
      url: '/_storyboard/host-tools/plan',
      headers: { 'content-length': '100' },
    })
    expect(result.response.status).toBe(413)
    expect(result.handler).not.toHaveBeenCalled()
  })

  it('does not impose the host-tools body limit on existing API routes', async () => {
    const { invoke } = setup({ maxBodyBytes: 16 })
    const content = 'x'.repeat(100)
    const result = await invoke({
      method: 'POST',
      url: '/_storyboard/file/write',
      body: JSON.stringify({ content }),
    })
    expect(result.response).toEqual({ status: 200, body: { content } })
    expect(result.handler).toHaveBeenCalledOnce()
  })

  it('does not strip a partial base-path prefix or intercept non-API requests', async () => {
    const { invoke } = setup({ base: '/storyboard/' })
    const result = await invoke({ url: '/storyboard-extra/_storyboard/host-tools/preflight' })
    expect(result.next).toHaveBeenCalledOnce()
    expect(result.handler).not.toHaveBeenCalled()
  })

  it('supports dynamic proxy ownership while the standalone server starts', async () => {
    const backend = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ owner: 'standalone' }))
    })
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))

    const response = new PassThrough()
    let status
    response.writeHead = (nextStatus) => { status = nextStatus }
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    const middleware = createApiMiddleware({
      routeHandlers: new Map([['file', vi.fn()]]),
      proxyUrl: () => `http://127.0.0.1:${backend.address().port}`,
      proxyAll: () => true,
      sendJson: vi.fn(),
      ws: { send: vi.fn() },
    })
    const request = new EventEmitter()
    Object.assign(request, { method: 'GET', url: '/_storyboard/file/tree', headers: {} })
    const ended = new Promise((resolve) => response.on('end', resolve))
    await middleware(request, response, vi.fn())
    request.emit('end')
    await ended

    expect(status).toBe(200)
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({ owner: 'standalone' })
    await new Promise((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()))
  })

  it('forwards DELETE request bodies through the standalone proxy', async () => {
    let receivedBody = ''
    const backend = http.createServer((req, res) => {
      req.on('data', (chunk) => { receivedBody += chunk })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: JSON.parse(receivedBody) }))
      })
    })
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))

    const middleware = createApiMiddleware({
      routeHandlers: new Map(),
      proxyUrl: () => `http://127.0.0.1:${backend.address().port}`,
      proxyAll: () => true,
      sendJson: vi.fn(),
      ws: { send: vi.fn() },
    })
    const frontend = http.createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()))
    await new Promise((resolve) => frontend.listen(0, '127.0.0.1', resolve))

    const response = await fetch(`http://127.0.0.1:${frontend.address().port}/_storyboard/canvas/widget`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'welcome', widgetId: 'agent-t304v2' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      received: { name: 'welcome', widgetId: 'agent-t304v2' },
    })
    await new Promise((resolve, reject) => frontend.close((error) => error ? reject(error) : resolve()))
    await new Promise((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()))
  })

})
