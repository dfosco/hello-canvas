import { afterEach, describe, expect, it } from 'vitest'
import { isAllowedTerminalOrigin } from './terminal-server.js'

afterEach(() => {
  delete process.env.STORYBOARD_DESKTOP
})

describe('terminal WebSocket origin validation', () => {
  it('accepts same-origin browser and originless non-browser clients', () => {
    expect(isAllowedTerminalOrigin({ headers: { host: 'localhost:1234' } })).toBe(true)
    expect(isAllowedTerminalOrigin({
      headers: { host: 'localhost:1234', origin: 'http://localhost:1234' },
    })).toBe(true)
  })

  it('rejects cross-origin browser clients', () => {
    expect(isAllowedTerminalOrigin({
      headers: { host: '127.0.0.1:4312', origin: 'https://malicious.example' },
    })).toBe(false)
  })

  it('requires the exact loopback host in desktop mode', () => {
    process.env.STORYBOARD_DESKTOP = '1'
    expect(isAllowedTerminalOrigin({
      headers: { host: '127.0.0.1:4312', origin: 'http://127.0.0.1:4312' },
    })).toBe(true)
    expect(isAllowedTerminalOrigin({
      headers: { host: 'rebound.example:4312', origin: 'http://rebound.example:4312' },
    })).toBe(false)
  })

  it('accepts the fixed proxy origin in desktop mode', () => {
    process.env.STORYBOARD_DESKTOP = '1'
    expect(isAllowedTerminalOrigin({
      headers: { host: 'hypercanvas.localhost:2345', origin: 'http://hypercanvas.localhost:2345' },
    })).toBe(true)
    expect(isAllowedTerminalOrigin({
      headers: { host: 'hypercanvas.local:2345', origin: 'http://hypercanvas.local:2345' },
    })).toBe(false)
  })
})
