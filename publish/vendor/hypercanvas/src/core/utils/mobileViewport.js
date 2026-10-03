/**
 * Mobile viewport detection — reactive store for compact viewport state.
 *
 * Uses window.matchMedia for efficient, debounce-free detection.
 * Threshold: 500px (matches the mobile breakpoint for toolbar compacting).
 */

const MOBILE_QUERY = '(max-width: 499px)'

/** @type {boolean} */
let _isMobile = false

/** @type {Set<(mobile: boolean) => void>} */
const _listeners = new Set()

/** @type {MediaQueryList | null} */
let _mql = null

function _handleChange(e) {
  _isMobile = e.matches
  for (const cb of _listeners) cb(_isMobile)
}

// Initialize on load (SSR-safe)
if (typeof window !== 'undefined') {
  _mql = window.matchMedia(MOBILE_QUERY)
  _isMobile = _mql.matches
  _mql.addEventListener('change', _handleChange)
}

/**
 * Returns true when the viewport is narrower than 500px.
 * @returns {boolean}
 */
export function isMobile() {
  return _isMobile
}

/**
 * Subscribe to mobile state changes.
 * @param {(mobile: boolean) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeToMobile(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

/**
 * Check if the device has a coarse pointer (touch device).
 * Useful for PWA install prompts — avoids showing on narrow desktop windows.
 * @returns {boolean}
 */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}
