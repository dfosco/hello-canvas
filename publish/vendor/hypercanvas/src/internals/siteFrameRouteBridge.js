import { normalizeSiteId, normalizeSiteRoute, siteRouteFromPreviewUrl } from '../core/site/contract.js'

const ROUTE_EVENT = 'hypercanvas:site-route-change'
const PATCHED_HISTORY_KEY = '__hypercanvasSiteHistoryPatched'

function normalizedBasePath(basePath = '/') {
  const base = `/${String(basePath || '/').split('/').filter(Boolean).join('/')}`
  return base === '/' ? '' : base
}

export function siteViewerPath(basePath, siteId, route = '') {
  const base = normalizedBasePath(basePath)
  const id = encodeURIComponent(normalizeSiteId(siteId))
  const normalizedRoute = normalizeSiteRoute(route)
  return `${base}/sites/${id}${normalizedRoute ? `/${normalizedRoute}` : '/'}`
}

/** Observe same-origin Site iframe navigations and report their route to the host. */
export function observeSiteFrameRoute(iframe, { siteId, basePath = '/', onRouteChange } = {}) {
  let frameWindow
  try {
    frameWindow = iframe?.contentWindow
    if (!frameWindow || frameWindow.location.origin !== window.location.origin) return () => {}
  } catch {
    return () => {}
  }

  const sync = event => {
    let route
    try {
      route = siteRouteFromPreviewUrl(frameWindow.location.href, siteId, {
        basePath,
        origin: window.location.origin,
      })
    } catch { return }
    if (route !== null) onRouteChange?.(route, { replace: event?.detail?.replace === true || event?.type === 'popstate' })
  }

  try {
    const history = frameWindow.history
    if (!frameWindow[PATCHED_HISTORY_KEY]) {
      for (const methodName of ['pushState', 'replaceState']) {
        const original = history[methodName]
        history[methodName] = function patchedSiteHistoryMethod(...args) {
          const result = original.apply(this, args)
          frameWindow.dispatchEvent(new frameWindow.CustomEvent(ROUTE_EVENT, {
            detail: { replace: methodName === 'replaceState' },
          }))
          return result
        }
      }
      Object.defineProperty(frameWindow, PATCHED_HISTORY_KEY, { value: true })
    }
  } catch { /* the Site may lock down its history object */ }

  frameWindow.addEventListener(ROUTE_EVENT, sync)
  frameWindow.addEventListener('popstate', sync)
  frameWindow.addEventListener('hashchange', sync)
  sync()
  return () => {
    frameWindow.removeEventListener(ROUTE_EVENT, sync)
    frameWindow.removeEventListener('popstate', sync)
    frameWindow.removeEventListener('hashchange', sync)
  }
}
