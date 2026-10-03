/**
 * Tests for mount.js — comment overlay, banner, and body comment-mode logic.
 *
 * Heavy UI deps are mocked; we test DOM-level behavior of the
 * exported mountComments() plus the internal helpers it exercises.
 */

import { vi } from 'vitest'

// ---- Mocks (must be before importing mount.js) ----

vi.mock('../api.js', () => ({
  fetchRouteCommentsSummary: vi.fn(),
  fetchCommentDetail: vi.fn(),
  moveComment: vi.fn(),
  createComment: vi.fn(),
}))

vi.mock('../commentCache.js', () => ({
  getCachedComments: vi.fn(() => null),
  setCachedComments: vi.fn(),
  clearCachedComments: vi.fn(),
  savePendingComment: vi.fn(),
  getPendingComments: vi.fn(() => []),
  removePendingComment: vi.fn(),
}))

vi.mock('./composer.js', () => ({
  showComposer: vi.fn(),
}))

vi.mock('./authModal.js', () => ({
  openAuthModal: vi.fn(),
}))

vi.mock('./commentWindow.js', () => ({
  showCommentWindow: vi.fn(),
  closeCommentWindow: vi.fn(),
}))

describe('mount.js', () => {
  // mountComments() is idempotent via a module-level _mounted flag, so we
  // must re-import the module fresh for each test to reset that flag.
  // All sibling modules must also be re-imported so they share the same instances.
  let mountComments
  let setCommentMode
  let isCommentModeActive // eslint-disable-line no-unused-vars
  let initCommentsConfig
  let setToken
  let clearToken
  let createComment
  let openAuthModal
  let showComposer

  beforeEach(async () => {
    // Reset DOM
    document.body.innerHTML = ''
    document.body.className = ''
    document.body.style.cssText = ''

    // Fresh import to reset _mounted flag and all module-level state
    vi.resetModules()

    // Re-mock after resetModules
    vi.doMock('../api.js', () => ({
      fetchRouteCommentsSummary: vi.fn(),
      fetchCommentDetail: vi.fn(),
      moveComment: vi.fn(),
      createComment: vi.fn(),
    }))
    vi.doMock('../commentCache.js', () => ({
      getCachedComments: vi.fn(() => null),
      setCachedComments: vi.fn(),
      clearCachedComments: vi.fn(),
      savePendingComment: vi.fn(),
      getPendingComments: vi.fn(() => []),
      removePendingComment: vi.fn(),
    }))
    vi.doMock('./composer.js', () => ({ showComposer: vi.fn() }))
    vi.doMock('./authModal.js', () => ({ openAuthModal: vi.fn() }))
    vi.doMock('./commentWindow.js', () => ({
      showCommentWindow: vi.fn(),
      closeCommentWindow: vi.fn(),
    }))

    // Import everything fresh so mount.js and its deps share the same instances
    const mountMod = await import('./mount.js')
    const commentModeMod = await import('../commentMode.js')
    const configMod = await import('../config.js')
    const authMod = await import('../auth.js')
    const apiMod = await import('../api.js')
    const authModalMod = await import('./authModal.js')
    const composerMod = await import('./composer.js')

    mountComments = mountMod.mountComments
    setCommentMode = commentModeMod.setCommentMode
    isCommentModeActive = commentModeMod.isCommentModeActive
    initCommentsConfig = configMod.initCommentsConfig
    setToken = authMod.setToken
    clearToken = authMod.clearToken
    createComment = apiMod.createComment
    openAuthModal = authModalMod.openAuthModal
    showComposer = composerMod.showComposer

    // Reset storyboard state
    setCommentMode(false)
    clearToken()
    initCommentsConfig(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('ensureOverlay (via setBodyCommentMode)', () => {
    it('does not set position:relative on document.body', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      // Activate comment mode — triggers ensureOverlay internally
      setCommentMode(true)

      // body should NOT get position:relative forced on it
      expect(document.body.style.position).not.toBe('relative')
    })

    it('appends overlay to document.body when comment mode activates', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)

      const overlay = document.body.querySelector('.sb-comment-overlay')
      expect(overlay).not.toBeNull()
      expect(overlay.parentElement).toBe(document.body)
    })

    it('removes overlay when comment mode deactivates', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)
      expect(document.body.querySelector('.sb-comment-overlay')).not.toBeNull()

      setCommentMode(false)
      expect(document.body.querySelector('.sb-comment-overlay')).toBeNull()
    })
  })

  describe('banner', () => {
    it('shows banner when comment mode activates', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)

      const banner = document.body.querySelector('.sb-banner')
      expect(banner).not.toBeNull()
      expect(banner.textContent).toContain('Comment mode')
    })

    it('removes banner when comment mode deactivates', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)
      setCommentMode(false)

      expect(document.body.querySelector('.sb-banner')).toBeNull()
    })
  })

  describe('body class', () => {
    it('adds sb-comment-mode class when comment mode activates', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)
      expect(document.body.classList.contains('sb-comment-mode')).toBe(true)
    })

    it('removes sb-comment-mode class when comment mode deactivates', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)
      setCommentMode(false)
      expect(document.body.classList.contains('sb-comment-mode')).toBe(false)
    })
  })

  describe('mountComments idempotency', () => {
    it('is safe to call multiple times', () => {
      mountComments()
      mountComments()
      mountComments()
      // No error thrown — _mounted guard prevents double init
    })
  })

  describe('navigation and canvas coordinates', () => {
    it('turns comment mode off on popstate navigation', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      setCommentMode(true)
      expect(document.body.classList.contains('sb-comment-mode')).toBe(true)

      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(document.body.classList.contains('sb-comment-mode')).toBe(false)
    })

    it('computes click coordinates relative to canvas absolute space', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      const scroll = document.createElement('div')
      scroll.setAttribute('data-storyboard-canvas-scroll', '')
      Object.defineProperty(scroll, 'scrollLeft', { value: 100, writable: true })
      Object.defineProperty(scroll, 'scrollTop', { value: 50, writable: true })
      Object.defineProperty(scroll, 'clientHeight', { value: 700, writable: true })
      scroll.getBoundingClientRect = () => ({ left: 20, top: 10, right: 1020, bottom: 710, width: 1000, height: 700 })

      const zoom = document.createElement('div')
      zoom.setAttribute('data-storyboard-canvas-zoom', '')
      zoom.style.transform = 'scale(2)'

      const surface = document.createElement('main')
      surface.className = 'tc-canvas'
      Object.defineProperty(surface, 'offsetWidth', { value: 10000, writable: true })
      Object.defineProperty(surface, 'offsetHeight', { value: 10000, writable: true })
      zoom.appendChild(surface)
      scroll.appendChild(zoom)
      document.body.appendChild(scroll)

      let captured = null
      showComposer.mockImplementation((ov, x, y) => {
        captured = { x, y }
        return { destroy: vi.fn(), moveTo: vi.fn() }
      })

      setCommentMode(true)
      const overlay = document.body.querySelector('.sb-comment-overlay')
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 220, clientY: 210 }))

      expect(captured).toEqual({ x: 1.5, y: 1.3 })
    })

    it('scrolls canvas on wheel while comment mode is active', () => {
      initCommentsConfig({ comments: { repo: { owner: 'o', name: 'r' } } })
      setToken('ghp_test')
      mountComments()

      const scroll = document.createElement('div')
      scroll.setAttribute('data-storyboard-canvas-scroll', '')
      Object.defineProperty(scroll, 'scrollLeft', { value: 0, writable: true })
      Object.defineProperty(scroll, 'scrollTop', { value: 0, writable: true })
      scroll.scrollBy = vi.fn(({ left = 0, top = 0 }) => {
        scroll.scrollLeft += left
        scroll.scrollTop += top
      })
      scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 })

      const zoom = document.createElement('div')
      zoom.setAttribute('data-storyboard-canvas-zoom', '')
      zoom.style.transform = 'scale(1)'

      const surface = document.createElement('main')
      surface.className = 'tc-canvas'
      Object.defineProperty(surface, 'offsetWidth', { value: 10000, writable: true })
      Object.defineProperty(surface, 'offsetHeight', { value: 10000, writable: true })
      zoom.appendChild(surface)
      scroll.appendChild(zoom)
      document.body.appendChild(scroll)

      setCommentMode(true)
      const overlay = document.body.querySelector('.sb-comment-overlay')
      const wheelEvent = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 8, deltaY: 24 })
      overlay.dispatchEvent(wheelEvent)

      expect(scroll.scrollBy).toHaveBeenCalledTimes(1)
      expect(scroll.scrollLeft).toBe(8)
      expect(scroll.scrollTop).toBe(24)
      expect(wheelEvent.defaultPrevented).toBe(true)
    })
  })

  describe('auth error handling', () => {
    it('opens auth modal with repo-specific message when PAT lacks repository access during submit', async () => {
      initCommentsConfig({
        comments: { discussions: { category: 'Comments' } },
        repository: { owner: 'correct', name: 'repository' },
      })
      setToken('ghp_test')

      createComment.mockRejectedValueOnce(
        new Error("GraphQL error: Could not resolve to a Repository with the name 'github/storyboard'.")
      )

      showComposer.mockImplementation((ov, x, y, route, opts) => {
        queueMicrotask(() => {
          opts.onSubmitOptimistic('Hello', x, y)
        })
        return {
          destroy: vi.fn(),
          moveTo: vi.fn(),
        }
      })

      mountComments()
      setCommentMode(true)

      const overlay = document.body.querySelector('.sb-comment-overlay')
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }))

      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(openAuthModal).toHaveBeenCalledTimes(1)
      const call = openAuthModal.mock.calls[0]?.[0]
      expect(call?.initialError).toContain('`correct/repository`')
      expect(call?.initialError).toContain('PAT repository access')
      expect(document.body.classList.contains('sb-comment-mode')).toBe(false)
    })
  })
})
