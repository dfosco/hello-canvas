import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'hc_session'
const LAUNCH_PARAM = '__hc_launch'

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

function sameToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function localHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname.endsWith('.localhost')
}

function loopbackOrigin(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' && localHostname(parsed.hostname) ? parsed.origin : null
  } catch { return null }
}

function loopbackOriginFromHost(host) {
  return typeof host === 'string' ? loopbackOrigin(`http://${host}`) : null
}

function signedSessionCookie(secret, sessionId, origin) {
  const payload = Buffer.from(JSON.stringify({ version: 1, sessionId, origin })).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifySignedSessionCookie(secret, cookie) {
  const [payload, signature, extra] = String(cookie || '').split('.')
  if (!payload || !signature || extra !== undefined) return null
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  if (!sameToken(signature, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (claims?.version !== 1 || typeof claims.sessionId !== 'string' || !loopbackOrigin(claims.origin)) return null
    return claims
  } catch { return null }
}

function sendUnauthorized(res, status = 401) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(status === 403 ? 'Invalid Hypercanvas launch handoff.' : 'Launch Hypercanvas from its wrapper to connect this browser.')
}

function redirectWithoutLaunchToken(response, parsed, sessionCookie = null) {
  parsed.searchParams.delete(LAUNCH_PARAM)
  const headers = {
    Location: `${parsed.pathname}${parsed.search}`,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  }
  if (sessionCookie) headers['Set-Cookie'] = `${COOKIE_NAME}=${sessionCookie}; Path=/; HttpOnly; SameSite=Strict`
  response.writeHead(303, headers)
  response.end()
}

export function createBrowserSession({
  required = false,
  launchToken = null,
  sessionSecret = null,
  generateSession = () => randomBytes(32).toString('hex'),
} = {}) {
  let isRequired = Boolean(required)
  // Outstanding launch tokens (token → expiresAt). The constructor token
  // seeds the set; issueLaunchToken() mints bounded tokens for duplicate
  // launches (relaunch flow) and fresh browser profiles. Tokens are
  // single-use: whichever request redeems one consumes it.
  const launchTokens = new Map()
  if (typeof launchToken === 'string' && launchToken) launchTokens.set(launchToken, Infinity)
  const sessions = new Set()
  const browserOrigins = new Set()
  const stableSessionSecret = typeof sessionSecret === 'string' && sessionSecret.length > 0 ? sessionSecret : null

  function browserSession(request, { bootstrap = false } = {}) {
    const cookie = cookieValue(request?.headers?.cookie, COOKIE_NAME)
    if (stableSessionSecret) {
      const claims = verifySignedSessionCookie(stableSessionSecret, cookie)
      if (!claims || !loopbackOriginFromHost(request?.headers?.host)) return null
      const origin = request?.headers?.origin
      if (origin) return loopbackOrigin(origin) === claims.origin ? claims.sessionId : null
      if (bootstrap) {
        return loopbackOriginFromHost(request?.headers?.host) === claims.origin ? claims.sessionId : null
      }
      return request?.headers?.['sec-fetch-site'] === 'same-origin'
        && loopbackOriginFromHost(request?.headers?.host) === claims.origin
        ? claims.sessionId
        : null
    }

    if (!cookie || !sessions.has(cookie)) return null
    if (request?.headers?.origin) {
      const origin = loopbackOrigin(request.headers.origin)
      return origin && browserOrigins.has(origin) ? cookie : null
    }
    if (bootstrap) return cookie
    return request?.headers?.['sec-fetch-site'] === 'same-origin' ? cookie : null
  }

  function registerBrowserOrigin(origin) {
    const parsedOrigin = loopbackOrigin(origin)
    if (!parsedOrigin) return false
    browserOrigins.add(parsedOrigin)
    return true
  }

  function consumeLaunchToken(supplied) {
    if (typeof supplied !== 'string' || !supplied) return false
    const now = Date.now()
    for (const [token, expiresAt] of launchTokens) {
      if (expiresAt <= now) {
        launchTokens.delete(token)
        continue
      }
      if (sameToken(supplied, token)) {
        launchTokens.delete(token)
        return true
      }
    }
    return false
  }

  function issueLaunchToken({ ttlMs = 60_000 } = {}) {
    // Keep the in-memory handoff table bounded even if a local caller
    // repeatedly asks for relaunch links without redeeming them.
    const now = Date.now()
    for (const [token, expiresAt] of launchTokens) {
      if (expiresAt <= now) launchTokens.delete(token)
    }
    while (launchTokens.size >= 64) {
      const oldestFinite = [...launchTokens].find(([, expiresAt]) => Number.isFinite(expiresAt))
      if (!oldestFinite) break
      launchTokens.delete(oldestFinite[0])
    }
    const token = generateSession()
    launchTokens.set(token, now + Math.max(1, Math.min(Number(ttlMs) || 60_000, 5 * 60_000)))
    return token
  }

  function isAuthenticated(request) {
    if (!isRequired) return true
    if (browserSession(request)) return true
    // The existing Storyboard CLI remains a local client of Core APIs. Browsers
    // always carry an Origin on cross-origin fetches/forms; origin-less local
    // command clients are accepted only when the host gate confirms loopback.
    return !request?.headers?.origin && /^node(?:\/|$)/i.test(String(request?.headers?.['user-agent'] || ''))
  }

  function authorizeWebSocket(request) {
    if (!isRequired) return true
    const origin = request?.headers?.origin
    if (!origin || !loopbackOriginFromHost(request?.headers?.host)) return false
    return Boolean(browserSession(request))
  }

  function bootstrapMiddleware({ base = '/' } = {}) {
    const normalizedBase = `/${String(base || '/').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '') || '/'
    const rootPath = normalizedBase === '/' ? '/' : normalizedBase
    const rootPathSlash = rootPath.endsWith('/') ? rootPath : `${rootPath}/`
    return (request, response, next) => {
      if (request.method !== 'GET') return next()
      let parsed
      try { parsed = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`) } catch { return next() }
      if (parsed.pathname !== rootPath && parsed.pathname !== rootPathSlash) return next()
      const hasLaunchParam = parsed.searchParams.has(LAUNCH_PARAM)
      if (!isRequired) {
        if (!hasLaunchParam) return next()
        return redirectWithoutLaunchToken(response, parsed)
      }
      if (browserSession(request, { bootstrap: true })) {
        if (!hasLaunchParam) return next()
        return redirectWithoutLaunchToken(response, parsed)
      }

      const supplied = parsed.searchParams.get(LAUNCH_PARAM)
      if (!supplied) return sendUnauthorized(response)
      if (!loopbackOriginFromHost(request.headers.host) || !consumeLaunchToken(supplied)) {
        return sendUnauthorized(response, 403)
      }

      const newSession = generateSession()
      const hostOrigin = loopbackOriginFromHost(request.headers.host)
      if (stableSessionSecret) {
        if (!hostOrigin) return sendUnauthorized(response, 403)
        registerBrowserOrigin(hostOrigin)
      } else {
        sessions.add(newSession)
      }
      const sessionCookie = stableSessionSecret
        ? signedSessionCookie(stableSessionSecret, newSession, hostOrigin)
        : newSession
      redirectWithoutLaunchToken(response, parsed, sessionCookie)
    }
  }

  function setRequired(value) {
    isRequired = Boolean(value)
  }

  return { isAuthenticated, authorizeWebSocket, bootstrapMiddleware, registerBrowserOrigin, setRequired, issueLaunchToken }
}
