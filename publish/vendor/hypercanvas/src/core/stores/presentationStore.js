/**
 * Presentation Store — consumer-supplied overrides for storyboard chrome elements.
 *
 * A chrome element is any rendered piece of storyboard UI that is wrapped in
 * `<ChromeSlot id="...">` (toolbar buttons, canvas title, page selector, etc.).
 *
 * Consumers seed this registry through `mountStoryboardCore({ presentation })`
 * and the store applies per-element overrides at render time:
 *
 *   {
 *     "tool:command-palette": {
 *       style:     { transform: 'translateY(20px)', opacity: 0 },
 *       className: 'landing-floating-button',
 *       props:     { onPointerEnter: handleHover },
 *       decorator: (Element, ctx) => <ScrollAnimator>{Element}</ScrollAnimator>,
 *     },
 *     "canvas:title": { hidden: true },
 *   }
 *
 * This is an **advanced, undocumented** extension surface — intended for
 * landing-page / hero canvas use cases where the consumer needs heavy
 * customization of storyboard chrome. Not part of the public API.
 *
 * Framework-agnostic (zero npm dependencies).
 */

/**
 * @typedef {object} PresentationOverride
 * @property {React.CSSProperties} [style]     - Spread onto the chrome element root style
 * @property {string}              [className] - Appended to the chrome element root className
 * @property {object}              [props]     - Spread as additional props on the chrome element
 * @property {Function}            [decorator] - (Element, ctx) => ReactNode wrapper
 * @property {boolean}             [hidden]    - If true, render null (shorthand for full hide)
 */

/** @type {Map<string, PresentationOverride>} */
let _overrides = new Map()

/** @type {Set<Function>} */
const _listeners = new Set()

let _snapshotVersion = 0

/**
 * Seed the presentation registry from a consumer-supplied map.
 * Replaces any previous overrides. Called once at app startup.
 *
 * @param {Record<string, PresentationOverride>} [map]
 */
export function initPresentation(map) {
  _overrides = new Map()
  if (map && typeof map === 'object') {
    for (const [id, override] of Object.entries(map)) {
      if (override && typeof override === 'object') {
        _overrides.set(id, override)
      }
    }
  }
  _notify()
}

/**
 * Set or replace a single chrome element's presentation override.
 * @param {string} id
 * @param {PresentationOverride|null|undefined} override Pass null/undefined to clear.
 */
export function setPresentation(id, override) {
  if (override == null) {
    _overrides.delete(id)
  } else if (typeof override === 'object') {
    _overrides.set(id, override)
  }
  _notify()
}

/**
 * Get the presentation override for a chrome element ID, or null if none.
 * @param {string} id
 * @returns {PresentationOverride|null}
 */
export function getPresentation(id) {
  return _overrides.get(id) || null
}

/**
 * Subscribe to presentation registry changes. Returns an unsubscribe fn.
 * Compatible with `useSyncExternalStore` shape.
 * @param {Function} callback
 * @returns {Function}
 */
export function subscribeToPresentation(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

/**
 * Snapshot version for change detection. Compatible with `useSyncExternalStore`.
 * @returns {string}
 */
export function getPresentationSnapshot() {
  return String(_snapshotVersion)
}

function _notify() {
  _snapshotVersion++
  for (const cb of _listeners) {
    try { cb() } catch (err) {
      console.error('[storyboard] Error in presentation subscriber:', err)
    }
  }
}

/** Reset all state. Only for tests. */
export function _resetPresentation() {
  _overrides = new Map()
  _listeners.clear()
  _snapshotVersion = 0
}
