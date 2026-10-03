/**
 * Intercept ?hide and ?show URL params.
 *
 * Called at app startup AND on every client-side navigation.
 * Checks the URL for the special params, triggers the corresponding
 * hide-mode transition, and strips the param from the URL.
 */
import { activateHideMode, deactivateHideMode } from './hideMode.js'

/**
 * Check for ?hide or ?show in the current URL and act on them.
 * Safe to call multiple times (idempotent — only acts if the param exists).
 */
export function interceptHideParams() {
  const url = new URL(window.location.href)

  if (url.searchParams.has('hide')) {
    activateHideMode()
    return
  }

  if (url.searchParams.has('show')) {
    deactivateHideMode()
    return
  }
}

/**
 * Install a popstate listener so ?hide/?show are detected on
 * browser back/forward navigation too.
 */
export function installHideParamListener() {
  interceptHideParams()
  window.addEventListener('popstate', () => interceptHideParams())
}
