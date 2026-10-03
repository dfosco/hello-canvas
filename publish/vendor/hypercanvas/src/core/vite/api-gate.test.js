import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import notebookRuntimePlugin from '../notebook/vite-runtime-plugin.js'
import { isAllowedRequestOrigin } from '../cli/devContract.js'
import { createApiGate } from './api-router.js'

/**
 * Regression test for the intake wiring: the notebook-runtime plugin
 * registers its /_storyboard/notebook-runtime routes in a configureServer
 * hook that runs AFTER the storyboardServer plugin, whose API router used to
 * consume unknown /_storyboard/ prefixes and proxy them to a standalone
 * server port (4100) that nothing ever listens on — 502ing every notebook
 * open/status/restart request before the runtime middleware could see it.
 * The gate must delegate notebook-runtime to the plugin's middleware and
 * everything else to the API router.
 */

function createStubViteServer() {
  const middlewareStore = { notebook: null }
  const server = {
    watcher: { on: vi.fn(), add: vi.fn(), unwatch: vi.fn() },
    config: { server: { fs: { allow: [] } } },
    moduleGraph: { getModuleById: vi.fn(() => null), invalidateModule: vi.fn() },
    ws: { send: vi.fn() },
    __hypercanvasNotebookRuntime: null,
    middlewares: {
      use: (route, fn) => {
        if (route === '/_storyboard/notebook-runtime') middlewareStore.notebook = fn
      },
    },
  }
  return { server, middlewareStore }
}

function createRequest({ method = 'GET', url, headers = {} } = {}) {
  const req = new EventEmitter()
  const chunks = []
  let ended = false
  // readBody iterates the request with `for await`, so the stub must be an
  // async iterable like a real Node stream.
  req[Symbol.asyncIterator] = () => ({
    next: () => new Promise(resolve => {
      const step = () => {
        if (chunks.length > 0) resolve({ value: chunks.shift(), done: false })
        else if (ended) resolve({ done: true })
        else {
          req.once('data', step)
          req.once('end', step)
        }
      }
      step()
    }),
  })
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => { ended = true })
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '127.0.0.1' }, resume: vi.fn() })
  return req
}

function createResponse() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    done: null,
    setHeader(key, value) { this.headers[key] = value },
    writeHead(status, head) { this.statusCode = status; Object.assign(this.headers, head || {}) },
    end(payload) {
      this.body = payload
      if (this.done) this.done()
    },
  }
  res.finished = new Promise(resolve => { res.done = resolve })
  return res
}

// Mirrors vite.config.js plugin order: storyboardServer (API router) first,
// notebookRuntime second.
function createStack({ desktop = false, originHeadersAllowed = true, authorized = true } = {}) {
  const { server, middlewareStore } = createStubViteServer()
  const proxyTarget = vi.fn() // stands in for the api-router (4100 proxy path)
  const apiMiddleware = async (req, res) => {
    proxyTarget(req.url)
    res.writeHead(502)
    res.end(JSON.stringify({ error: 'Storyboard server not running. Start it with: npx storyboard server' }))
  }
  const sendJson = (res, status, body) => {
    res.writeHead(status)
    res.end(JSON.stringify(body))
  }
  const gate = createApiGate({
    base: '/',
    apiMiddleware,
    sendJson,
    isAllowedOrigin: (headers, options) => typeof originHeadersAllowed === 'function'
      ? originHeadersAllowed(headers, options)
      : originHeadersAllowed,
    isAuthorized: () => authorized,
    desktop,
    getNotebookRuntimeMiddleware: () => server.__hypercanvasNotebookRuntime,
  })
  const notebookPlugin = notebookRuntimePlugin({})
  notebookPlugin.configureServer(server)
  if (!middlewareStore.notebook) throw new Error('notebook runtime middleware was not registered')

  async function invoke({ method = 'GET', url, headers = {}, body } = {}) {
    const req = createRequest({ method, url, headers })
    const res = createResponse()
    const pending = gate(req, res, vi.fn())
    if (body !== undefined) {
      await Promise.resolve()
      req.emit('data', body)
    }
    req.emit('end')
    await Promise.all([pending, res.finished])
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, proxyTarget }
  }

  return { invoke, server, middlewareStore, proxyTarget }
}

describe('API gate delegates notebook-runtime routes', () => {
  it('GET /status reaches the runtime plugin instead of the dead proxy', async () => {
    const { invoke, proxyTarget } = createStack()
    const { status, body } = await invoke({ url: '/_storyboard/notebook-runtime/status' })
    expect(status).toBe(200)
    expect(body).toHaveProperty('active')
    expect(proxyTarget).not.toHaveBeenCalled()
  })

  it('POST /open with an invalid folder returns the runtime 422, not a proxy 502', async () => {
    const { invoke, proxyTarget } = createStack()
    const { status, body } = await invoke({
      method: 'POST',
      url: '/_storyboard/notebook-runtime/open',
      headers: { 'user-agent': 'node' },
      body: JSON.stringify({ root: '/definitely/not/a/notebook' }),
    })
    expect(status).toBe(422)
    expect(body.error.code).toBe('INVALID_NOTEBOOK')
    expect(proxyTarget).not.toHaveBeenCalled()
  })

  it('POST /open with a valid notebook folder switches the active root', async () => {
    const { invoke } = createStack()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-api-notebook-'))
    const { status, body } = await invoke({
      method: 'POST',
      url: '/_storyboard/notebook-runtime/open',
      headers: { 'user-agent': 'node' },
      body: JSON.stringify({ root }),
    })
    expect(status).toBe(200)
    // macOS resolves /var → /private/var, so assert on the tail.
    expect(body.active).toBe(true)
    expect(body.root).toBe(fs.realpathSync(root))

    const { status: statusStatus, body: statusBody } = await invoke({ url: '/_storyboard/notebook-runtime/status' })
    expect(statusStatus).toBe(200)
    expect(statusBody.active).toBe(true)
    expect(statusBody.root).toBe(fs.realpathSync(root))
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('still routes unknown prefixes to the API router proxy fallback', async () => {
    const { invoke, proxyTarget } = createStack()
    const { status } = await invoke({ url: '/_storyboard/some-future-route' })
    expect(proxyTarget).toHaveBeenCalledWith('/_storyboard/some-future-route')
    expect(status).toBe(502)
  })

  it('applies the desktop origin guard to notebook-runtime requests', async () => {
    const { invoke } = createStack({ desktop: true, originHeadersAllowed: false })
    const { status, body } = await invoke({ url: '/_storyboard/notebook-runtime/status' })
    expect(status).toBe(403)
    expect(body.error).toContain('app origin')
  })

  it('allows a same-host HTTPS tunnel origin when forwarded origins are enabled', async () => {
    const { invoke, proxyTarget } = createStack({
      desktop: true,
      originHeadersAllowed: (headers, options) => isAllowedRequestOrigin(headers, {
        ...options,
        allowForwardedHttpsOrigin: true,
      }),
    })
    const { status } = await invoke({
      url: '/_storyboard/some-future-route',
      headers: {
        host: 'share.example.trycloudflare.com',
        origin: 'https://share.example.trycloudflare.com',
      },
    })
    expect(status).toBe(502)
    expect(proxyTarget).toHaveBeenCalledWith('/_storyboard/some-future-route')
  })

  it('requires the browser Core session before privileged API routing', async () => {
    const { invoke, proxyTarget } = createStack({ desktop: true, authorized: false })
    const { status, body } = await invoke({ url: '/_storyboard/notebook-runtime/recent' })
    expect(status).toBe(401)
    expect(body.error.code).toBe('CORE_SESSION_REQUIRED')
    expect(proxyTarget).not.toHaveBeenCalled()
  })
})
