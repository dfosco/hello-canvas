/**
 * H5 hashPreserver foreign-branch bypass (closes server-state RCA).
 *
 * When the user clicks an anchor whose pathname starts with /branch--<other>/,
 * we must NOT intercept — letting the browser do a full navigation routes
 * the request through Caddy to the correct devserver. Intercepting and calling
 * router.navigate() with a foreign path causes React Router to prepend its
 * own basename, producing /branch--A/branch--B/...
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { installHashPreserver } from './hashPreserver.js'

describe('hashPreserver foreign-branch bypass', () => {
  let router
  let originalLocation

  let originalNavigateSpy
  beforeEach(() => {
    originalNavigateSpy = vi.fn(() => Promise.resolve())
    router = { navigate: originalNavigateSpy }
    originalLocation = window.location
    delete window.location
    window.location = new URL('http://storyboard-core.localhost/branch--0.5.0/foo')
  })

  afterEach(() => {
    window.location = originalLocation
  })

  function clickAnchor(href) {
    const a = document.createElement('a')
    a.href = href
    document.body.appendChild(a)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    let prevented = false
    a.addEventListener('click', () => {})
    Object.defineProperty(ev, 'target', { value: a, writable: false })
    a.dispatchEvent(ev)
    prevented = ev.defaultPrevented
    document.body.removeChild(a)
    return { prevented }
  }

  it('does NOT intercept a click on /branch--<other>/', () => {
    installHashPreserver(router, '/branch--0.5.0')
    const { prevented } = clickAnchor('http://storyboard-core.localhost/branch--dfosco/x')
    expect(prevented).toBe(false)
    // Original spy must remain uncalled — both directly and via the wrapper.
    expect(originalNavigateSpy).not.toHaveBeenCalled()
  })

  it('DOES intercept a click on the same /branch--<self>/', () => {
    installHashPreserver(router, '/branch--0.5.0')
    const { prevented } = clickAnchor('http://storyboard-core.localhost/branch--0.5.0/inner')
    expect(prevented).toBe(true)
    expect(originalNavigateSpy).toHaveBeenCalled()
  })

  it('intercepts non-branch paths normally', () => {
    installHashPreserver(router, '/branch--0.5.0')
    const { prevented } = clickAnchor('http://storyboard-core.localhost/branch--0.5.0/some/route')
    expect(prevented).toBe(true)
    expect(originalNavigateSpy).toHaveBeenCalled()
  })
})
