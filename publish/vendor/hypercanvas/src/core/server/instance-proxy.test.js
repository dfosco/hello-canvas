import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import {
  INSTANCE_PATH,
  INTERNAL_REGISTER_PATH,
  InstancePortOccupiedError,
  RELAUNCH_PATH,
  acquireInstanceProxy,
} from './instance-proxy.js'

function getJson(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, timeout: 2000 }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
    })
    request.once('error', reject)
    request.end()
  })
}

function postJson(port, path, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port, path, method: 'POST', timeout: 2000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extraHeaders },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    })
    request.once('error', reject)
    request.end(body)
  })
}

function startUpstream(handler) {
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function occupySingleStack(port, host, handler) {
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server))
  })
}

function echoBackend() {
  const wss = new WebSocketServer({ noServer: true })
  const server = http.createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (client) => {
      client.on('message', (message) => client.send(`echo:${message}`))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function wsRoundTrip(port, path) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    socket.once('error', reject)
    socket.on('open', () => socket.send('ping'))
    socket.on('message', (data) => {
      socket.close()
      resolve(String(data))
    })
    setTimeout(() => reject(new Error('WebSocket round trip timed out')), 3000)
  })
}

describe('instance proxy', () => {
  it('claims the port, serves the instance payload, and rebinds after close', async () => {
    const proxy = await acquireInstanceProxy({
      port: 0,
      instanceInfo: { version: '0.0.0-test', url: 'http://hypercanvas.localhost:2345/', notebook: { title: 'Demo' } },
    })
    await expect(getJson(proxy.port, INSTANCE_PATH)).resolves.toMatchObject({
      status: 200,
      body: { app: 'hypercanvas', ready: false, url: 'http://hypercanvas.localhost:2345/', notebook: { title: 'Demo' } },
    })
    proxy.setDefaultUpstream({ host: '127.0.0.1', port: 4317 })
    await expect(getJson(proxy.port, INSTANCE_PATH)).resolves.toMatchObject({
      body: { ready: true },
    })
    await proxy.close()
    const rebound = await acquireInstanceProxy({ port: proxy.port })
    expect(rebound.port).toBe(proxy.port)
    await rebound.close()
  })

  it('rejects a second claim on the same port with an occupied error', async () => {
    const first = await acquireInstanceProxy({ port: 0 })
    await expect(acquireInstanceProxy({ port: first.port })).rejects.toBeInstanceOf(InstancePortOccupiedError)
    await expect(acquireInstanceProxy({ port: first.port })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await first.close()
  })

  it('issues relaunch tokens to loopback callers and 503s without an issuer', async () => {
    const withIssuer = await acquireInstanceProxy({
      port: 0,
      instanceInfo: { url: 'http://hypercanvas.localhost:2345/' },
      issueRelaunchToken: () => 'relaunch-token',
    })
    await expect(getJson(withIssuer.port, RELAUNCH_PATH, 'POST')).resolves.toEqual({
      status: 200,
      body: { url: 'http://hypercanvas.localhost:2345/', token: 'relaunch-token' },
    })
    await withIssuer.close()

    const withoutIssuer = await acquireInstanceProxy({ port: 0, instanceInfo: { url: 'http://x/' } })
    await expect(getJson(withoutIssuer.port, RELAUNCH_PATH, 'POST')).resolves.toMatchObject({
      status: 503,
      body: { error: 'relaunch_unavailable' },
    })
    await withoutIssuer.close()
  })

  it('rejects cross-origin relaunch requests from loopback callers', async () => {
    let issued = 0
    const proxy = await acquireInstanceProxy({
      port: 0,
      instanceInfo: { url: 'http://hypercanvas.localhost:2345/' },
      issueRelaunchToken: () => { issued += 1; return 'token' },
    })
    await expect(postJson(proxy.port, RELAUNCH_PATH, {}, {
      Origin: 'http://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
    })).resolves.toMatchObject({ status: 403, body: { error: 'relaunch_origin_not_allowed' } })
    expect(issued).toBe(0)
    await proxy.close()
  })

  it('forwards HTTP to the default upstream with the Host header intact', async () => {
    const seen = {}
    const { server, port: upstreamPort } = await startUpstream((req, res) => {
      seen.host = req.headers.host
      seen.forwardedFor = req.headers['x-forwarded-for']
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, url: req.url }))
    })
    const proxy = await acquireInstanceProxy({ port: 0 })
    proxy.setDefaultUpstream({ host: '127.0.0.1', port: upstreamPort })
    const result = await getJson(proxy.port, '/some/app/route?flow=default')
    expect(result).toEqual({ status: 200, body: { ok: true, url: '/some/app/route?flow=default' } })
    expect(seen.host).toMatch(/^127\.0\.0\.1:/)
    expect(seen.forwardedFor).toMatch(/127\.0\.0\.1/)
    await proxy.close()
    await new Promise((resolve) => server.close(resolve))
  })

  it('answers 503 while no default upstream is attached', async () => {
    const proxy = await acquireInstanceProxy({ port: 0 })
    await expect(getJson(proxy.port, '/')).resolves.toEqual({ status: 503, body: { error: 'core_starting' } })
    await proxy.close()
  })

  it('routes API WebSocket upgrades to the API upstream and the rest to the default', async () => {
    const api = await echoBackend()
    const app = await echoBackend()
    const proxy = await acquireInstanceProxy({ port: 0 })
    proxy.setDefaultUpstream({ host: '127.0.0.1', port: app.port })
    proxy.setWsUpstream('/_storyboard/ws', { host: '127.0.0.1', port: api.port })

    await expect(wsRoundTrip(proxy.port, '/_storyboard/ws')).resolves.toBe('echo:ping')
    await expect(wsRoundTrip(proxy.port, '/vite-hmr')).resolves.toBe('echo:ping')

    await proxy.close()
    await new Promise((resolve) => api.server.close(resolve))
    await new Promise((resolve) => app.server.close(resolve))
  })

  it('treats a single-stack holder as an occupied claim', async () => {
    const holder = await occupySingleStack(0, '127.0.0.1', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('foreign ipv4 holder')
    })
    const port = holder.address().port
    await expect(acquireInstanceProxy({ port })).rejects.toBeInstanceOf(InstancePortOccupiedError)
    await new Promise((resolve) => holder.close(resolve))
  })

  it('serves IPv6 loopback alongside IPv4 when the stack exists', async () => {
    const proxy = await acquireInstanceProxy({ port: 0 })
    expect(proxy.servers.length).toBeGreaterThanOrEqual(1)
    if (proxy.servers.length === 2) {
      const body = await new Promise((resolve, reject) => {
        http.get({ host: '::1', port: proxy.port, path: INSTANCE_PATH, timeout: 2000 }, (res) => {
          let text = ''
          res.on('data', (chunk) => { text += chunk })
          res.on('end', () => resolve(JSON.parse(text)))
        }).once('error', reject)
      })
      expect(body.app).toBe('hypercanvas')
    }
    await proxy.close()
  })

  it('closes idempotently and frees the port', async () => {
    const proxy = await acquireInstanceProxy({ port: 0 })
    const port = proxy.port
    await proxy.close()
    await proxy.close()
    const rebound = await acquireInstanceProxy({ port })
    expect(rebound.port).toBe(port)
    await rebound.close()
  })

  it('registers backend upstreams from the Vite child over loopback', async () => {
    const seen = {}
    const { server, port: upstreamPort } = await startUpstream((req, res) => {
      seen.host = req.headers.host
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    const proxy = await acquireInstanceProxy({
      port: 0,
      instanceInfo: { url: 'http://hypercanvas.localhost:2345/' },
      registrationToken: 'secret-registration',
    })
    await expect(getJson(proxy.port, '/')).resolves.toMatchObject({ status: 503 })
    await expect(postJson(proxy.port, INTERNAL_REGISTER_PATH, {
      vitePort: upstreamPort,
      viteHost: '127.0.0.1',
      apiPort: upstreamPort,
      apiWsPath: '/_storyboard/ws',
      notebook: { title: 'Demo', root: '/tmp/demo' },
    }, { Authorization: 'Bearer secret-registration' })).resolves.toEqual({ status: 200, body: { ok: true } })
    await expect(getJson(proxy.port, '/')).resolves.toMatchObject({ status: 200, body: { ok: true } })
    await expect(getJson(proxy.port, INSTANCE_PATH)).resolves.toMatchObject({
      body: { notebook: { title: 'Demo', root: '/tmp/demo' } },
    })
    expect(seen.host).toMatch(/^127\.0\.0\.1:/)
    await proxy.close()
    await new Promise((resolve) => server.close(resolve))
  })

  it('authenticates upstream registration from the Vite child', async () => {
    const proxy = await acquireInstanceProxy({ port: 0, registrationToken: 'secret-registration' })
    const payload = { vitePort: 4100 }
    await expect(postJson(proxy.port, INTERNAL_REGISTER_PATH, payload)).resolves.toMatchObject({
      status: 401,
      body: { error: 'internal_auth_required' },
    })
    await expect(postJson(proxy.port, INTERNAL_REGISTER_PATH, payload, {
      Authorization: 'Bearer secret-registration',
    })).resolves.toEqual({ status: 200, body: { ok: true } })
    await expect(getJson(proxy.port, '/')).resolves.toMatchObject({ status: 503 })
    await proxy.close()
  })

  it('rejects malformed upstream registrations', async () => {
    const proxy = await acquireInstanceProxy({ port: 0 })
    await expect(postJson(proxy.port, INTERNAL_REGISTER_PATH, { vitePort: 'nope' })).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    })
    // A non-port registration is ignored: still no upstream attached.
    await expect(getJson(proxy.port, '/')).resolves.toMatchObject({ status: 503 })
    await expect(postJson(proxy.port, '/_hypercanvas-internal/unknown', {})).resolves.toMatchObject({ status: 404 })
    await proxy.close()
  })

  it('forwards relaunch to the child internal endpoint when no issuer is set', async () => {
    const { server, port: upstreamPort } = await startUpstream((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        const authorized = req.headers.authorization === 'Bearer secret-registration'
        res.end(JSON.stringify(
          req.url === '/_hypercanvas-internal/relaunch' && authorized
            ? { url: 'http://hypercanvas.localhost:2345/', token: 'child-token' }
            : { error: 'unexpected' },
        ))
      })
    })
    const proxy = await acquireInstanceProxy({ port: 0, registrationToken: 'secret-registration' })
    proxy.setDefaultUpstream({ host: '127.0.0.1', port: upstreamPort })
    await expect(getJson(proxy.port, RELAUNCH_PATH, 'POST')).resolves.toEqual({
      status: 200,
      body: { url: 'http://hypercanvas.localhost:2345/', token: 'child-token' },
    })
    await proxy.close()
    await new Promise((resolve) => server.close(resolve))
  })

  it('answers relaunch unavailable when the child has no internal endpoint', async () => {
    const { server, port: upstreamPort } = await startUpstream((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'nope' }))
    })
    const proxy = await acquireInstanceProxy({ port: 0 })
    proxy.setDefaultUpstream({ host: '127.0.0.1', port: upstreamPort })
    await expect(getJson(proxy.port, RELAUNCH_PATH, 'POST')).resolves.toMatchObject({
      status: 503,
      body: { error: 'relaunch_unavailable' },
    })
    await proxy.close()
    await new Promise((resolve) => server.close(resolve))
  })
})
