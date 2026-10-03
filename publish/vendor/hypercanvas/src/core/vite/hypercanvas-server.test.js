import http from 'node:http'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createBrowserSession } from '../server/browser-session.js'
import { createHypercanvasServer } from './hypercanvas-server.js'

function request(port, { method = 'GET', path = '/', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    }, (res) => {
      let content = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { content += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(content) }))
    })
    req.on('error', reject)
    if (body !== undefined) req.end(JSON.stringify(body))
    else req.end()
  })
}

function openSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('standalone Hypercanvas server', () => {
  it('hosts injected routes and broadcasts through its own WebSocket channel', async () => {
    let receivedContext
    const server = createHypercanvasServer({
      base: '/branch--demo/',
      routeHandlers: new Map([['test', async (_req, res, context) => {
        receivedContext = context
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        context.__viteWs.send({ type: 'custom', event: 'storyboard:test', data: { value: 1 } })
      }]]),
    })

    await server.listen()
    const port = server.server.address().port
    const socket = await openSocket(`ws://127.0.0.1:${port}/branch--demo/_storyboard/ws`)
    const message = new Promise((resolve) => socket.once('message', (data) => resolve(JSON.parse(data))))

    await expect(request(port, {
      method: 'POST',
      path: '/branch--demo/_storyboard/test/run',
      body: { value: 1 },
    })).resolves.toEqual({ status: 200, body: { ok: true } })
    await expect(message).resolves.toEqual({
      type: 'custom',
      event: 'storyboard:test',
      data: { value: 1 },
    })
    expect(receivedContext.path).toBe('/run')
    expect(receivedContext.method).toBe('POST')
    expect(receivedContext.body).toEqual({ value: 1 })

    socket.close()
    await server.close()
  })

  it('returns 404 for an unregistered route without affecting the socket channel', async () => {
    const server = createHypercanvasServer()
    await server.listen()
    const port = server.server.address().port

    await expect(request(port, { path: '/_storyboard/missing' })).resolves.toMatchObject({ status: 502 })

    await server.close()
  })

  it('authenticates browser WebSocket upgrades with the Core session cookie', async () => {
    const server = createHypercanvasServer({
      eventSender: () => {},
      authorizeWebSocket: request => request.headers.cookie === 'hc_session=valid'
        && request.headers.origin === 'http://127.0.0.1',
    })
    await server.listen()
    const port = server.server.address().port
    const url = `ws://127.0.0.1:${port}/_storyboard/ws`

    await expect(openSocket(url, { origin: 'http://127.0.0.1' })).rejects.toThrow()
    const socket = await openSocket(url, { origin: 'http://127.0.0.1', headers: { Cookie: 'hc_session=valid' } })
    socket.close()
    await server.close()
  })

  it('serves Core APIs and WebSockets without a browser session when the gate is disabled', async () => {
    const browserSession = createBrowserSession({ required: false })
    const server = createHypercanvasServer({
      routeHandlers: new Map([['test', async (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      }]]),
      authorizeRequest: browserSession.isAuthenticated,
      authorizeWebSocket: browserSession.authorizeWebSocket,
    })

    await server.listen()
    const port = server.server.address().port
    try {
      await expect(request(port, {
        method: 'POST',
        path: '/_storyboard/test/run',
        body: {},
      })).resolves.toEqual({ status: 200, body: { ok: true } })

      const socket = await openSocket(`ws://127.0.0.1:${port}/_storyboard/ws`, {
        origin: 'https://share.example.trycloudflare.com',
      })
      socket.close()
    } finally {
      await server.close()
    }
  })
})
