/**
 * Production mode simulation.
 *
 * When `?prodMode` is in the URL, the UI renders as if in production
 * even when running on a local dev server. Toggling is done via the
 * devtools submenu or by manually adding/removing the URL param.
 */

let _forced = null

function hasProdModeParam() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('prodMode')
}

/** Returns true when the app should behave as local dev. */
export function isLocalDev() {
  if (typeof window === 'undefined') return false
  if (_forced !== null) return !_forced
  if (hasProdModeParam()) return false
  return window.__SB_LOCAL_DEV__ === true
}

/** Returns true when prod-mode simulation is active. */
export function isProdMode() {
  return !isLocalDev() && typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true
}

/** Toggle prodMode URL param and reload. */
export function toggleProdMode() {
  const url = new URL(window.location.href)
  if (url.searchParams.has('prodMode')) {
    url.searchParams.delete('prodMode')
  } else {
    url.searchParams.set('prodMode', '')
  }
  window.location.replace(url.toString())
}
