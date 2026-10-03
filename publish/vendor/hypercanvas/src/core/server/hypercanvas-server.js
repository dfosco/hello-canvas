/**
 * Standalone Hypercanvas HTTP server.
 *
 * Route handlers are injected so the transport can be hosted by the
 * application independently of Vite. The WebSocket channel carries the
 * existing Vite-shaped custom event payloads for client compatibility.
 */

import http from 'node:http'
import { WebSocketServer } from 'ws'
import { createRouteSetup } from '../vite/api-router.js'

const SOCKET_PATH = '/_storyboard/ws'

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function stripBase(url, base) {
  const baseNoTrail = String(base || '/').replace(/\/$/, '')
  if (!baseNoTrail || baseNoTrail === '/') return url
  if (url === baseNoTrail) return '/'
  return url.startsWith(`${baseNoTrail}/`) ? url.slice(baseNoTrail.length) : url
}

export function createHypercanvasServer({
  base = '/',
  routeHandlers = new Map(),
  sendJson: responseSender = sendJson,
  maxBodyBytes,
  server: suppliedServer,
  webSocketServer,
  eventSender,
  authorizeRequest = () => true,
  authorizeWebSocket = () => true,
} = {}) {
  const clients = new Set()
  const wss = webSocketServer || new WebSocketServer({ noServer: true })
  const setup = createRouteSetup({
    base,
    routeHandlers,
    sendJson: responseSender,
    ws: { send: eventSender || wsSend },
    maxBodyBytes,
  })
  const server = suppliedServer || http.createServer((request, response) => {
    if (!authorizeRequest(request)) {
      sendJson(response, 401, { error: { code: 'CORE_SESSION_REQUIRED', message: 'Launch Hypercanvas from its wrapper to access Core APIs.' } })
      return
    }
    setup.middleware(request, response)
  })
  const baseNoTrail = String(base || '/').replace(/\/$/, '')
  const socketPath = `${baseNoTrail === '/' ? '' : baseNoTrail}${SOCKET_PATH}`

  wss.on('connection', (socket) => {
    clients.add(socket)
    socket.once('close', () => clients.delete(socket))
    socket.once('error', () => clients.delete(socket))
  })

  const onUpgrade = (request, socket, head) => {
    const pathname = stripBase((request.url || '').split('?')[0], base)
    if (pathname !== SOCKET_PATH) return
    if (!authorizeWebSocket(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request))
  }
  server.on('upgrade', onUpgrade)

  function broadcast(payload) {
    for (const client of clients) {
      if (client.readyState === 1) client.send(JSON.stringify(payload))
    }
  }

  function wsSend(payload) {
    broadcast(payload)
  }

  function listen(port = 0, host = '127.0.0.1') {
    if (server.listening) return Promise.resolve(server)
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(server)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  }

  function close() {
    for (const client of clients) client.close()
    clients.clear()
    wss.close()
    server.off('upgrade', onUpgrade)
    if (!server.listening) return Promise.resolve()
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  return { server, routeHandlers, broadcast, wsSend, listen, close, socketPath }
}

export { SOCKET_PATH }
