/**
 * Single-instance Hypercanvas proxy.
 *
 * One loopback listener on the selected proxy port is the global instance
 * claim: the socket bind itself proves ownership, so a crashed Core leaves no
 * stale claim behind. The proxy forwards HTTP and WebSocket upgrades to the
 * existing dynamic backends (Vite child for UI/HMR/terminals, standalone
 * Hypercanvas API server for its socket path) and serves two proxy-owned
 * endpoints used by duplicate launches:
 *
 *   GET  /_hypercanvas/instance  → { app, pid, version, url, notebook }
 *   POST /_hypercanvas/relaunch  → { url, token } (loopback callers only)
 */

import http from 'node:http'
import net from 'node:net'

export const INSTANCE_PATH = '/_hypercanvas/instance'
export const RELAUNCH_PATH = '/_hypercanvas/relaunch'
export const INTERNAL_PREFIX = '/_hypercanvas-internal/'
export const INTERNAL_REGISTER_PATH = '/_hypercanvas-internal/upstreams'
export const INTERNAL_RELAUNCH_PATH = '/_hypercanvas-internal/relaunch'
export const DEFAULT_INSTANCE_PORT = 1234
export const INSTANCE_HOSTNAME = 'hypercanvas.localhost'

export class InstancePortOccupiedError extends Error {
  constructor(port, host) {
    super(`Instance port ${port} on ${host} is already bound`)
    this.name = 'InstancePortOccupiedError'
    this.code = 'EADDRINUSE'
    this.port = port
    this.host = host
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function pathnameOf(url) {
  return String(url || '/').split('?')[0]
}

function isLoopbackPeer(request) {
  const peer = request.socket?.remoteAddress
  return peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1'
}

function proxyRequestHeaders(request) {
  const headers = { ...request.headers }
  // Host passes through unchanged so downstream Host-derived logic (ws-url,
  // origin gates) sees the fixed proxy origin. Record the loopback hop.
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'http'
  const peer = request.socket?.remoteAddress
  if (peer) {
    const prior = headers['x-forwarded-for']
    headers['x-forwarded-for'] = prior ? `${prior}, ${peer}` : peer
  }
  return headers
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        request.destroy()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.once('error', reject)
  })
}

/**
 * Acquire the instance proxy on the requested port.
 *
 * Dual loopback bind: the claim covers IPv4 (127.0.0.1) and IPv6 (::1)
 * loopback together. `hypercanvas.localhost` resolves to ::1 on machines
 * with IPv6 loopback, so an IPv4-only bind would refuse hostname-based
 * clients (including Node fetch). An explicit `host` binds single-stack.
 * If any stack reports EADDRINUSE the whole claim is occupied — partial
 * binds are closed before reporting so probes never hit our own socket.
 * An explicit `host` binds single-stack (tests and single-stack hosts).
 *
 * The proxy lives in the Core supervisor process while the Vite child owns
 * the browser session and backends, so two proxy-owned endpoints bridge the
 * process boundary over loopback:
 *
 *   POST /_hypercanvas-internal/upstreams — the Vite child registers its
 *     dynamic backend ports ({ vitePort, viteHost, apiPort, apiWsPath, notebook }).
 *   POST /_hypercanvas/relaunch — without an issueRelaunchToken issuer, the
 *     proxy forwards to the child's /_hypercanvas-internal/relaunch so the
 *     token is minted by the browser-session owner.
 *
 * @param {object} options
 * @param {number} [options.port] — port to bind (0 = ephemeral, for tests/e2e)
 * @param {string} [options.host] — single-stack bind host (default: dual loopback)
 * @param {object} [options.instanceInfo] — served from GET /_hypercanvas/instance
 * @param {function} [options.issueRelaunchToken] — () => token|string|Promise, for POST /_hypercanvas/relaunch
 */
export async function acquireInstanceProxy({
  port = DEFAULT_INSTANCE_PORT,
  host = null,
  instanceInfo = {},
  issueRelaunchToken = null,
  registrationToken = null,
} = {}) {
  let info = { app: 'hypercanvas', pid: process.pid, version: null, url: null, notebook: null, ...instanceInfo }
  let defaultUpstream = null
  const wsUpstreams = new Map()
  const sockets = new Set()
  const tunnels = new Set()
  let closed = false

  const normalizeUpstream = (upstream) => (
    upstream?.port ? { host: upstream.host || '127.0.0.1', port: upstream.port } : null
  )

  const applyUpstreamRegistration = (payload) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid registration payload')
    const validPort = (port) => Number.isInteger(port) && port > 0 && port <= 65535
    const validHost = (host) => typeof host === 'string' && host.length > 0 && host.length <= 255
    if (validPort(payload.vitePort)) {
      defaultUpstream = normalizeUpstream({
        host: validHost(payload.viteHost) ? payload.viteHost : '127.0.0.1',
        port: payload.vitePort,
      })
    }
    if (validPort(payload.apiPort) && typeof payload.apiWsPath === 'string' && payload.apiWsPath.startsWith('/')) {
      wsUpstreams.set(payload.apiWsPath, normalizeUpstream({
        host: validHost(payload.apiHost) ? payload.apiHost : '127.0.0.1',
        port: payload.apiPort,
      }))
    }
    if (payload.notebook !== undefined) info = { ...info, notebook: payload.notebook }
    if (payload.url) info = { ...info, url: String(payload.url) }
  }

  const forwardInternalJson = (path, payload, timeoutMs = 2000) => {
    if (!defaultUpstream) return Promise.reject(new Error('No default upstream attached'))
    const body = JSON.stringify(payload)
    return new Promise((resolve, reject) => {
      const upstreamRequest = http.request({
        host: defaultUpstream.host,
        port: defaultUpstream.port,
        method: 'POST',
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(registrationToken ? { Authorization: `Bearer ${registrationToken}` } : {}),
        },
        timeout: timeoutMs,
      }, (upstreamResponse) => {
        let text = ''
        upstreamResponse.setEncoding('utf8')
        upstreamResponse.on('data', (chunk) => { text += chunk })
        upstreamResponse.on('end', () => {
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new Error('Non-JSON internal response'))
          }
        })
      })
      upstreamRequest.once('timeout', () => upstreamRequest.destroy(new Error('Internal forward timed out')))
      upstreamRequest.once('error', reject)
      upstreamRequest.end(body)
    })
  }

  const forwardHttp = (request, response) => {
    if (!defaultUpstream) {
      sendJson(response, 503, { error: 'core_starting' })
      return
    }
    const upstreamRequest = http.request({
      host: defaultUpstream.host,
      port: defaultUpstream.port,
      method: request.method,
      path: request.url,
      headers: proxyRequestHeaders(request),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    upstreamRequest.on('error', () => {
      if (!response.headersSent) sendJson(response, 503, { error: 'core_starting' })
      else response.destroy()
    })
    request.on('aborted', () => upstreamRequest.destroy())
    request.pipe(upstreamRequest)
  }

  const forwardUpgrade = (request, clientSocket, head) => {
    const pathname = pathnameOf(request.url)
    const upstream = wsUpstreams.get(pathname) || defaultUpstream
    if (!upstream) {
      try {
        clientSocket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      } catch { /* socket already gone */ }
      clientSocket.destroy()
      return
    }
    const proxySocket = net.connect(upstream.port, upstream.host)
    tunnels.add(proxySocket)
    const teardown = () => {
      tunnels.delete(proxySocket)
      proxySocket.destroy()
      clientSocket.destroy()
    }
    proxySocket.once('error', teardown)
    clientSocket.once('error', teardown)
    // A destroyed half does not propagate through pipe() on its own; tear
    // down the pair so neither side leaks and server close() can complete.
    proxySocket.once('close', () => {
      tunnels.delete(proxySocket)
      clientSocket.destroy()
    })
    clientSocket.once('close', () => {
      tunnels.delete(proxySocket)
      proxySocket.destroy()
    })
    proxySocket.on('connect', () => {
      const rawHeaders = request.rawHeaders || []
      let head_block = `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`
      for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
        head_block += `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`
      }
      head_block += '\r\n'
      proxySocket.write(head_block)
      if (head?.length) proxySocket.write(head)
      clientSocket.pipe(proxySocket)
      proxySocket.pipe(clientSocket)
    })
  }

  const onRequest = (request, response) => {
    const pathname = pathnameOf(request.url)
    if (request.method === 'GET' && pathname === INSTANCE_PATH) {
      sendJson(response, 200, { ...info, ready: defaultUpstream !== null })
      return
    }
    if (request.method === 'POST' && pathname === RELAUNCH_PATH) {
      if (!isLoopbackPeer(request)) {
        sendJson(response, 403, { error: 'relaunch_loopback_only' })
        return
      }
      const origin = request.headers.origin
      const fetchSite = request.headers['sec-fetch-site']
      if ((origin && origin !== `http://${request.headers.host}`) || fetchSite === 'cross-site') {
        sendJson(response, 403, { error: 'relaunch_origin_not_allowed' })
        return
      }
      request.resume()
      request.on('end', async () => {
        try {
          if (issueRelaunchToken) {
            const token = await issueRelaunchToken()
            if (!token || !info.url) {
              sendJson(response, 503, { error: 'relaunch_unavailable' })
              return
            }
            sendJson(response, 200, { url: info.url, token: String(token) })
            return
          }
          // The browser session lives in the Vite child: ask it to mint a
          // relaunch token rather than minting one here that nothing honors.
          const relaunched = await forwardInternalJson(INTERNAL_RELAUNCH_PATH, {})
          if (relaunched?.url && relaunched?.token) {
            sendJson(response, 200, { url: String(relaunched.url), token: String(relaunched.token) })
          } else {
            sendJson(response, 503, { error: 'relaunch_unavailable' })
          }
        } catch {
          sendJson(response, 503, { error: 'relaunch_unavailable' })
        }
      })
      return
    }
    if (pathname.startsWith(INTERNAL_PREFIX)) {
      if (!isLoopbackPeer(request)) {
        sendJson(response, 403, { error: 'internal_loopback_only' })
        return
      }
      if (registrationToken && request.headers.authorization !== `Bearer ${registrationToken}`) {
        sendJson(response, 401, { error: 'internal_auth_required' })
        return
      }
      if (request.method === 'POST' && pathname === INTERNAL_REGISTER_PATH) {
        readJsonBody(request, 65536).then((payload) => {
          applyUpstreamRegistration(payload)
          sendJson(response, 200, { ok: true })
        }).catch(() => sendJson(response, 400, { error: 'invalid_registration' }))
        return
      }
      sendJson(response, 404, { error: 'unknown_internal_path' })
      return
    }
    if (pathname === INSTANCE_PATH || pathname === RELAUNCH_PATH || pathname.startsWith('/_hypercanvas/')) {
      sendJson(response, 404, { error: 'unknown_instance_path' })
      return
    }
    forwardHttp(request, response)
  }

  const trackServer = (server) => {
    server.on('upgrade', forwardUpgrade)
    server.on('clientError', (_error, socket) => socket.destroy())
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
  }

  const listenOnce = (server, listenPort, listenHost) => new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(listenPort, listenHost)
  })

  const closeServers = (servers) => Promise.all(
    servers.map((server) => new Promise((resolve) => {
      if (!server.listening) return resolve()
      server.close(() => resolve())
    })),
  )

  // Bind every loopback stack. A second acquire on any stack means the
  // claim is occupied: partial binds are closed before reporting so a
  // later probe never hits our own half-open socket.
  const bindHosts = host ? [host] : ['127.0.0.1', '::1']
  const servers = []
  let boundPort = port
  let attempts = 0
  for (;;) {
    attempts += 1
    try {
      for (const bindHost of bindHosts) {
        const server = http.createServer(onRequest)
        trackServer(server)
        try {
          await listenOnce(server, boundPort, bindHost)
        } catch (error) {
          if (error?.code === 'EADDRNOTAVAIL' && bindHost === '::1' && !host) {
            // No IPv6 loopback on this machine: the IPv4 bind alone is the
            // complete claim here. Drop the half-created server and continue.
            server.removeAllListeners()
            continue
          }
          throw error
        }
        servers.push(server)
        const address = server.address()
        if (typeof address === 'object' && address && boundPort === 0) boundPort = address.port
      }
      break
    } catch (error) {
      await closeServers(servers)
      servers.length = 0
      if (error?.code === 'EADDRINUSE' && port === 0 && attempts < 5) {
        boundPort = 0
        continue
      }
      if (error?.code === 'EADDRINUSE') throw new InstancePortOccupiedError(port, bindHosts.join(','))
      throw error
    }
  }

  function close() {
    if (closed) return Promise.resolve()
    closed = true
    for (const socket of tunnels) socket.destroy()
    tunnels.clear()
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    return closeServers(servers).then(() => undefined)
  }

  return {
    servers,
    server: servers[0],
    host: host || 'loopback',
    port: boundPort,
    setDefaultUpstream(upstream) {
      defaultUpstream = normalizeUpstream(upstream)
    },
    setWsUpstream(path, upstream) {
      const normalized = normalizeUpstream(upstream)
      if (!normalized) wsUpstreams.delete(path)
      else wsUpstreams.set(path, normalized)
    },
    removeWsUpstream(path) {
      wsUpstreams.delete(path)
    },
    setInstanceInfo(patch) {
      info = { ...info, ...(patch || {}) }
    },
    close,
  }
}
