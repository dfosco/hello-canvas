import { Buffer } from 'node:buffer'

const API_PREFIX = '/_storyboard/'
export const DEFAULT_MAX_JSON_BODY_BYTES = 64 * 1024

function bodyError(code, status, message) {
  return Object.assign(new Error(message), { code, status })
}

export function parseJsonBody(req, { maxBytes = DEFAULT_MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers?.['content-length'] || 0)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      req.resume?.()
      reject(bodyError('REQUEST_BODY_TOO_LARGE', 413, 'JSON request body is too large'))
      return
    }

    const chunks = []
    let bytes = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', (chunk) => {
      if (settled) return
      const buffer = Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > maxBytes) {
        fail(bodyError('REQUEST_BODY_TOO_LARGE', 413, 'JSON request body is too large'))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(bodyError('INVALID_JSON', 400, 'Invalid JSON body'))
      }
    })
    req.on('error', (error) => fail(error))
  })
}

function stripBase(url, base) {
  const baseNoTrail = String(base || '/').replace(/\/$/, '')
  if (!baseNoTrail) return url
  if (url === baseNoTrail) return '/'
  return url.startsWith(`${baseNoTrail}/`) ? url.slice(baseNoTrail.length) : url
}

/**
 * Assemble the API route surface once for either Vite or the standalone
 * Hypercanvas server. Keeping this small object as the shared boundary avoids
 * making route handlers know which HTTP server owns them.
 */
export function createRouteSetup(options = {}) {
  return {
    routeHandlers: options.routeHandlers || new Map(),
    middleware: createApiMiddleware(options),
  }
}

export function createApiMiddleware({
  base = '/',
  routeHandlers,
  sendJson,
  ws,
  maxBodyBytes,
  proxyUrl = 'http://localhost:4100',
  proxyAll = false,
} = {}) {
  return async function storyboardApiMiddleware(req, res, next) {
    if (!req.url) return next()

    const url = stripBase(req.url, base)
    if (!url.startsWith(API_PREFIX)) return next()

    const pathAfterPrefix = url.slice(API_PREFIX.length)
    // Route by path only — the query string belongs to the handler (e.g.
    // frame-snapshot reads carry their target params on the GET URL). Parsing
    // the prefix from the full URL used to miss every queried route and send
    // it to the fallback proxy, which 502s when no external server runs.
    const queryIndex = pathAfterPrefix.indexOf('?')
    const pathOnly = queryIndex >= 0 ? pathAfterPrefix.slice(0, queryIndex) : pathAfterPrefix
    const slashIndex = pathOnly.indexOf('/')
    const prefix = slashIndex === -1 ? pathOnly : pathOnly.slice(0, slashIndex)
    const restPath = slashIndex === -1 ? '/' : pathAfterPrefix.slice(slashIndex)
    res.__sbLogCtx = { method: req.method, url, route: prefix, subRoute: restPath }

    const handler = routeHandlers.get(prefix)
    const shouldProxyAll = typeof proxyAll === 'function' ? proxyAll() : proxyAll
    if (!handler || shouldProxyAll) {
      try {
        const proxyReq = await import('node:http')
        const resolvedProxyUrl = typeof proxyUrl === 'function' ? proxyUrl() : proxyUrl
        const targetUrl = `${resolvedProxyUrl.replace(/\/$/, '')}${url}`
        const proxy = proxyReq.default.request(targetUrl, { method: req.method, headers: req.headers }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers)
          proxyRes.pipe(res)
        })
        proxy.on('error', () => {
          sendJson(res, 502, { error: 'Storyboard server not running. Start it with: npx storyboard server' })
        })
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') req.pipe(proxy)
        else proxy.end()
      } catch {
        sendJson(res, 502, { error: 'Storyboard server not running' })
      }
      return
    }

    try {
      let body = {}
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
        const routeLimit = prefix === 'host-tools'
          ? (maxBodyBytes ?? DEFAULT_MAX_JSON_BODY_BYTES)
          : Number.POSITIVE_INFINITY
        body = await parseJsonBody(req, { maxBytes: routeLimit })
      }
      await handler(req, res, { body, path: restPath, method: req.method, __viteWs: ws })
    } catch (error) {
      if (error?.code === 'INVALID_JSON' || error?.code === 'REQUEST_BODY_TOO_LARGE') {
        sendJson(res, error.status, { error: error.message, code: error.code })
        return
      }
      sendJson(res, 500, { error: error.message || 'Internal server error' })
    }
  }
}

/**
 * The outer gate in front of the API router. Applies the desktop origin
 * guard to every /_storyboard/ request and delegates the notebook-runtime
 * prefix to the notebook runtime plugin's own middleware — the router's
 * fallback proxy (a standalone server that is not part of this architecture)
 * must never consume those routes.
 */
export function createApiGate({ base = '/', apiMiddleware, sendJson, isAllowedOrigin, isAuthorized, desktop = false, getNotebookRuntimeMiddleware } = {}) {
  return function apiGate(req, res, next) {
    let url = req.url || ''
    const baseNoTrail = String(base).replace(/\/$/, '')
    if (baseNoTrail && url.startsWith(baseNoTrail)) url = url.slice(baseNoTrail.length) || '/'
    if (url.startsWith('/_storyboard/') && desktop && isAllowedOrigin && !isAllowedOrigin(req.headers, { desktop: true })) {
      return sendJson(res, 403, { error: 'Desktop API requests require the exact app origin' })
    }
    if (url.startsWith('/_storyboard/') && isAuthorized && !isAuthorized(req)) {
      return sendJson(res, 401, { error: { code: 'CORE_SESSION_REQUIRED', message: 'Launch Hypercanvas from its wrapper to access Core APIs.' } })
    }
    const notebookRuntime = getNotebookRuntimeMiddleware?.()
    if (url.startsWith('/_storyboard/notebook-runtime/') && typeof notebookRuntime === 'function') {
      console.debug('[devlog][api-gate] delegating Notebook runtime request', { method: req.method, url })
      // connect strips the mount prefix for use(path, fn); replicating that
      // here since this delegation bypasses the connect stack.
      const originalUrl = req.url
      req.url = url.slice('/_storyboard/notebook-runtime'.length) || '/'
      return notebookRuntime(req, res, error => {
        req.url = originalUrl
        next(error)
      })
    }
    return apiMiddleware(req, res, next)
  }
}
