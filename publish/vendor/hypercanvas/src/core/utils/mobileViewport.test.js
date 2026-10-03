import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('mobileViewport', () => {
  let matchMediaListeners = []
  let matchMediaMatches = false

  beforeEach(() => {
    matchMediaListeners = []
    matchMediaMatches = false

    vi.stubGlobal('matchMedia', vi.fn((query) => {
      const mql = {
        matches: matchMediaMatches,
        media: query,
        addEventListener: vi.fn((event, cb) => {
          matchMediaListeners.push(cb)
        }),
        removeEventListener: vi.fn(),
      }
      return mql
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('isMobile returns false for wide viewports', async () => {
    matchMediaMatches = false
    const { isMobile } = await import('./mobileViewport.js')
    expect(isMobile()).toBe(false)
  })

  it('isMobile returns true for narrow viewports', async () => {
    matchMediaMatches = true
    const { isMobile } = await import('./mobileViewport.js')
    expect(isMobile()).toBe(true)
  })

  it('subscribeToMobile notifies on change', async () => {
    matchMediaMatches = false
    const { isMobile, subscribeToMobile } = await import('./mobileViewport.js')

    const cb = vi.fn()
    const unsub = subscribeToMobile(cb)

    // Simulate matchMedia change event
    const changeHandler = matchMediaListeners[0]
    expect(changeHandler).toBeDefined()
    changeHandler({ matches: true })

    expect(cb).toHaveBeenCalledWith(true)
    expect(isMobile()).toBe(true)

    unsub()
    changeHandler({ matches: false })
    // Should not be called after unsubscribe
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('isTouchDevice checks pointer: coarse', async () => {
    const { isTouchDevice } = await import('./mobileViewport.js')
    // Our mock returns matchMediaMatches for all queries
    matchMediaMatches = false
    expect(isTouchDevice()).toBe(false)
  })
})
