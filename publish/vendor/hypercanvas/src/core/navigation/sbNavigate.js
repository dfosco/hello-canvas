/**
 * sbNavigate(url) — SPA navigation when possible, hard navigation otherwise.
 *
 * Many call sites use `window.location.href = url` for internal navigation,
 * which always triggers a full page reload. When the target is same-origin
 * and shares the app's BASE_URL (i.e. a normal in-app route), prefer the
 * router's client-side navigation so the shell stays mounted across moves
 * between prototype flows, palette actions, page selections, etc.
 *
 * The router instance is captured at install time by hashPreserver via
 * `setNavigationRouter(router, base)`; until that happens, sbNavigate
 * always falls back to hard navigation.
 *
 * @param {string} url - target URL (absolute or path-relative)
 * @param {object} [opts]
 * @param {boolean} [opts.replace] - history.replaceState semantics
 * @param {boolean} [opts.forceReload] - always fall back to location.href
 */

let _router = null
let _base = ''

/** Called by hashPreserver after it patches the router. */
export function setNavigationRouter(router, basename = '') {
  _router = router
  _base = String(basename || '').replace(/\/+$/, '')
}

export function getNavigationRouter() { return _router }

function canSpaNavigate(url) {
  if (!_router || typeof window === 'undefined') return null
  let target
  try {
    target = new URL(url, window.location.origin)
  } catch {
    return null
  }
  if (target.origin !== window.location.origin) return null
  let pathname = target.pathname
  if (_base) {
    if (pathname === _base || pathname.startsWith(_base + '/')) {
      pathname = pathname.slice(_base.length) || '/'
    } else {
      // Different base path (e.g. another /branch--<name>/) — can't SPA.
      return null
    }
  }
  return pathname + target.search + target.hash
}

export function sbNavigate(url, opts = {}) {
  if (typeof url !== 'string' || !url) return
  if (opts.forceReload) {
    window.location.href = url
    return
  }
  const spaPath = canSpaNavigate(url)
  if (spaPath != null) {
    _router.navigate(spaPath, { replace: !!opts.replace })
    return
  }
  window.location.href = url
}
