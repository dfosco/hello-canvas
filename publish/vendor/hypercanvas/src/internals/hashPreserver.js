import { interceptHideParams } from '../core/index.js'
import { setNavigationRouter } from '../core/navigation/sbNavigate.js'

/**
 * Preserve URL hash params across all navigations — both <a> clicks
 * and programmatic router.navigate() calls.
 *
 * Also intercepts ?hide and ?show params on every navigation.
 *
 * Hash is NOT preserved when:
 * - The target path already has its own hash fragment
 * - The link points to an external origin (click handler only)
 * - The current URL has no hash
 *
 * @param {import('react-router-dom').Router} router - React Router instance
 * @param {string} basename - Router basename (e.g. "/storyboard")
 */
export function installHashPreserver(router, basename = '') {
  // Normalize basename: ensure no trailing slash
  const base = basename.replace(/\/+$/, '')

  // Expose the router to sbNavigate() so internal call sites can do SPA
  // navigation instead of full-reload via window.location.href.
  setNavigationRouter(router, base)

  // --- 1. Intercept <a> clicks ---
  document.addEventListener('click', (e) => {
    // Skip if modifier keys are held (open in new tab, etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

    const anchor = e.target.closest('a[href]')
    if (!anchor) return
    if (anchor.target === '_blank') return

    const targetUrl = new URL(anchor.href, window.location.origin)

    // Skip external links
    if (targetUrl.origin !== window.location.origin) return

    // H5 fix (closes server-state RCA hypothesis):
    // If the click points at a different /branch--<x>/, do NOT intercept.
    // Letting the browser do a full navigation routes the request through
    // Caddy to the correct devserver instead of feeding a foreign path
    // into our basename-aware router (which would prepend `base` and
    // produce /branch--A/branch--B/...).
    const foreignBranch = targetUrl.pathname.match(/^\/branch--([a-z0-9._-]+)(\/|$)/i)
    if (foreignBranch) {
      const ownBranch = base.match(/\/branch--([a-z0-9._-]+)$/i)?.[1] ?? null
      if (foreignBranch[1] !== ownBranch) {
        // Full navigation through Caddy — no preventDefault.
        return
      }
    }

    // Determine the hash to carry forward
    const currentHash = window.location.hash
    const hasCurrentHash = currentHash && currentHash !== '#'
    const targetHasOwnHash = targetUrl.hash && targetUrl.hash !== '#'

    // Use the target's own hash if it has one, otherwise carry current hash
    const hash = targetHasOwnHash ? targetUrl.hash : (hasCurrentHash ? currentHash : '')

    // Strip basename to get the route path
    let pathname = targetUrl.pathname
    if (base && pathname.startsWith(base)) {
      pathname = pathname.slice(base.length) || '/'
    }

    // Prevent full page reload — navigate client-side
    e.preventDefault()
    router.navigate(pathname + targetUrl.search + hash)

    // Check for ?hide/?show after client-side navigation
    setTimeout(interceptHideParams, 0)
  })

  // --- 2. Intercept programmatic router.navigate() ---
  const originalNavigate = router.navigate.bind(router)
  router.navigate = (to, opts) => {
    const currentHash = window.location.hash
    const hasCurrentHash = currentHash && currentHash !== '#'

    if (hasCurrentHash && typeof to === 'string' && !to.includes('#')) {
      to = to + currentHash
    }

    return originalNavigate(to, opts).then((result) => {
      // Check for ?hide/?show after programmatic navigation
      interceptHideParams()
      return result
    })
  }
}
