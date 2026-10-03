import { describe, expect, it, vi } from 'vitest'
import { createBrowserSession } from './browser-session.js'

function response() {
  return {
    headers: null,
    status: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body = '') { this.body = body },
  }
}

describe('browser Core launch session', () => {
  it('consumes a one-time launch handoff, sets a strict HttpOnly cookie, and removes the token from the URL', () => {
    const session = createBrowserSession({ required: true, launchToken: 'one-time', generateSession: () => 'session-secret' })
    const middleware = session.bootstrapMiddleware({ base: '/branch--demo/' })
    const res = response()
    let continued = false
    middleware({ method: 'GET', url: '/branch--demo/?__hc_launch=one-time', headers: { host: '127.0.0.1:4317' } }, res, () => { continued = true })

    expect(continued).toBe(false)
    expect(res.status).toBe(303)
    expect(res.headers.Location).toBe('/branch--demo/')
    expect(res.headers['Set-Cookie']).toContain('HttpOnly')
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict')
    expect(session.registerBrowserOrigin('http://127.0.0.1:4317')).toBe(true)
    const request = { headers: { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', cookie: 'hc_session=session-secret' } }
    expect(session.isAuthenticated(request)).toBe(true)
    expect(session.authorizeWebSocket(request)).toBe(true)

    const reused = response()
    middleware({ method: 'GET', url: '/branch--demo/?__hc_launch=one-time', headers: { host: '127.0.0.1:4317' } }, reused, () => {})
    expect(reused.status).toBe(403)
  })

  it('verifies a Core-signed browser session in a replacement Vite worker', () => {
    const secret = 'core-session-secret-for-this-test-run'
    const initial = createBrowserSession({
      required: true,
      launchToken: 'one-time',
      sessionSecret: secret,
      generateSession: () => 'browser-session-id',
    })
    const middleware = initial.bootstrapMiddleware()
    const responseFromLaunch = response()
    middleware({
      method: 'GET',
      url: '/?__hc_launch=one-time',
      headers: { host: '127.0.0.1:4317' },
    }, responseFromLaunch, () => {})
    const cookie = responseFromLaunch.headers['Set-Cookie'].split(';')[0]

    const reconfiguredWorker = createBrowserSession({ required: true, sessionSecret: secret })
    const browserRequest = {
      headers: {
        host: '127.0.0.1:4321',
        origin: 'http://127.0.0.1:4317',
        cookie,
      },
    }

    expect(reconfiguredWorker.isAuthenticated(browserRequest)).toBe(true)
    expect(reconfiguredWorker.authorizeWebSocket(browserRequest)).toBe(true)

    const foreignOrigin = { headers: { ...browserRequest.headers, origin: 'http://127.0.0.1:4318' } }
    expect(reconfiguredWorker.isAuthenticated(foreignOrigin)).toBe(false)
    expect(reconfiguredWorker.authorizeWebSocket(foreignOrigin)).toBe(false)

    const foreignHost = { headers: { ...browserRequest.headers, host: 'attacker.example:4321' } }
    expect(reconfiguredWorker.isAuthenticated(foreignHost)).toBe(false)
    expect(reconfiguredWorker.authorizeWebSocket(foreignHost)).toBe(false)

    const tampered = { headers: { ...browserRequest.headers, cookie: `${cookie.slice(0, -1)}x` } }
    expect(reconfiguredWorker.isAuthenticated(tampered)).toBe(false)
  })

  it('allows browser access without a handoff when disabled and scrubs stale launch tokens', () => {
    const session = createBrowserSession({ required: false, launchToken: 'unused-launch-token' })
    const middleware = session.bootstrapMiddleware()
    const responseFromLaunch = response()
    let continued = false

    middleware({
      method: 'GET',
      url: '/?flow=recent&__hc_launch=unused-launch-token',
      headers: { host: 'share.example.trycloudflare.com' },
    }, responseFromLaunch, () => { continued = true })

    expect(continued).toBe(false)
    expect(responseFromLaunch.status).toBe(303)
    expect(responseFromLaunch.headers.Location).toBe('/?flow=recent')
    expect(responseFromLaunch.headers['Set-Cookie']).toBeUndefined()
    expect(session.isAuthenticated({ headers: { host: 'share.example.trycloudflare.com', origin: 'https://share.example.trycloudflare.com' } })).toBe(true)
    expect(session.authorizeWebSocket({ headers: { host: 'share.example.trycloudflare.com', origin: 'https://share.example.trycloudflare.com' } })).toBe(true)

    let ordinaryBrowserContinued = false
    middleware({
      method: 'GET',
      url: '/',
      headers: { host: 'share.example.trycloudflare.com' },
    }, response(), () => { ordinaryBrowserContinued = true })
    expect(ordinaryBrowserContinued).toBe(true)

    session.setRequired(true)
    expect(session.isAuthenticated({ headers: { host: '127.0.0.1:4317', 'user-agent': 'Mozilla/5.0' } })).toBe(false)
  })

  it('denies invalid handoffs and browser API calls without the session cookie', () => {
    const session = createBrowserSession({ required: true, launchToken: 'expected' })
    const middleware = session.bootstrapMiddleware()
    const res = response()
    middleware({ method: 'GET', url: '/?__hc_launch=wrong', headers: { host: '127.0.0.1:4317' } }, res, () => {})
    expect(res.status).toBe(403)
    expect(session.isAuthenticated({ headers: { origin: 'http://example.com', host: '127.0.0.1:4317' } })).toBe(false)
    expect(session.authorizeWebSocket({ headers: { origin: 'http://example.com', host: '127.0.0.1:4317', cookie: '' } })).toBe(false)
  })

  it('retains the origin-less Storyboard CLI client over loopback', () => {
    const session = createBrowserSession({ required: true, launchToken: 'secret' })
    expect(session.isAuthenticated({ headers: { host: '127.0.0.1:4317', 'user-agent': 'node' } })).toBe(true)
    expect(session.isAuthenticated({ headers: { host: '127.0.0.1:4317', 'user-agent': 'Mozilla/5.0' } })).toBe(false)
  })

  it('accepts the fixed proxy origin alongside 127.0.0.1', () => {
    const session = createBrowserSession({ required: true, launchToken: 'one-time', generateSession: () => 'session-secret' })
    const middleware = session.bootstrapMiddleware()
    const res = response()
    middleware({ method: 'GET', url: '/?__hc_launch=one-time', headers: { host: 'hypercanvas.localhost:2345' } }, res, () => {})
    expect(res.status).toBe(303)
    expect(session.registerBrowserOrigin('http://hypercanvas.localhost:2345')).toBe(true)
    expect(session.registerBrowserOrigin('http://127.0.0.1:2345')).toBe(true)
    expect(session.registerBrowserOrigin('http://hypercanvas.local:2345')).toBe(false)
    expect(session.registerBrowserOrigin('https://hypercanvas.localhost:2345')).toBe(false)
    const request = { headers: { host: 'hypercanvas.localhost:2345', origin: 'http://hypercanvas.localhost:2345', cookie: 'hc_session=session-secret' } }
    expect(session.isAuthenticated(request)).toBe(true)
    expect(session.authorizeWebSocket(request)).toBe(true)
  })

  it('mints bounded single-use relaunch tokens independent of the wrapper token', () => {
    vi.useFakeTimers()
    try {
      let counter = 0
      const session = createBrowserSession({ required: true, launchToken: 'wrapper-token', generateSession: () => `token-${++counter}` })
      const middleware = session.bootstrapMiddleware()
      const first = session.issueLaunchToken()
      const second = session.issueLaunchToken({ ttlMs: -1 })
      vi.advanceTimersByTime(2)
      expect(first).not.toBe('wrapper-token')

      const redeem = (token, host = '127.0.0.1:4317') => {
        const res = response()
        middleware({ method: 'GET', url: `/?__hc_launch=${token}`, headers: { host } }, res, () => {})
        return res.status
      }
      expect(redeem(first)).toBe(303)
      expect(redeem(first)).toBe(403)
      expect(redeem(second)).toBe(403)
      expect(redeem('wrapper-token')).toBe(303)
      expect(redeem('wrapper-token')).toBe(403)
    } finally {
      vi.useRealTimers()
    }
  })
})
