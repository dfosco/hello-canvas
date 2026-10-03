import { installHashPreserver } from './hashPreserver.js'

vi.mock('../core/index.js', async () => {
  const actual = await vi.importActual('../core/index.js')
  return { ...actual, interceptHideParams: vi.fn() }
})

function createMockRouter() {
  const originalNavigate = vi.fn(() => Promise.resolve())
  return { navigate: originalNavigate, _original: originalNavigate }
}

describe('installHashPreserver', () => {
  describe('programmatic navigate()', () => {
    it('preserves hash when navigate() is called without hash', () => {
      const router = createMockRouter()
      window.location.hash = '#foo=bar'
      installHashPreserver(router)

      router.navigate('/page')
      expect(router._original).toHaveBeenCalledWith('/page#foo=bar', undefined)
    })

    it('does NOT append current hash when navigate() target has its own hash', () => {
      const router = createMockRouter()
      window.location.hash = '#foo=bar'
      installHashPreserver(router)

      router.navigate('/page#other')
      expect(router._original).toHaveBeenCalledWith('/page#other', undefined)
    })

    it('calls navigate normally when no current hash', () => {
      const router = createMockRouter()
      installHashPreserver(router)

      router.navigate('/page')
      expect(router._original).toHaveBeenCalledWith('/page', undefined)
    })

    it('passes options through to original navigate', async () => {
      const router = createMockRouter()
      installHashPreserver(router)

      await router.navigate('/page', { replace: true })
      expect(router._original).toHaveBeenCalledWith('/page', { replace: true })
    })
  })

  describe('click handler', () => {
    it('intercepts internal link clicks and navigates client-side', () => {
      const router = createMockRouter()
      window.location.hash = '#state=1'
      installHashPreserver(router)

      const a = document.createElement('a')
      a.href = '/other-page'
      document.body.appendChild(a)

      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      a.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
      const callArg = router._original.mock.calls[0][0]
      expect(callArg).toContain('/other-page')

      document.body.removeChild(a)
    })

    it('does not intercept clicks with modifier keys', () => {
      const router = createMockRouter()
      installHashPreserver(router)

      const a = document.createElement('a')
      a.href = '/page'
      document.body.appendChild(a)

      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      })
      a.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)

      document.body.removeChild(a)
    })

    it('does not intercept clicks on links with target="_blank"', () => {
      const router = createMockRouter()
      installHashPreserver(router)

      const a = document.createElement('a')
      a.href = '/page'
      a.target = '_blank'
      document.body.appendChild(a)

      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      a.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)

      document.body.removeChild(a)
    })
  })
})
