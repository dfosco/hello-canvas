/**
 * Canvas Interaction Store — runtime gates for canvas scroll + zoom behavior.
 *
 * Four knobs that go *beyond* presentation (which is purely visual):
 *
 *   - `scrollAxis` — restricts the native scroll axes of the canvas
 *     scroll container. Useful when a canvas is rendered as a "webpage"
 *     (e.g. a landing page) and should scroll only vertically.
 *     Valid values: `"both"` (default), `"vertical"`, `"horizontal"`, `"none"`.
 *
 *   - `zoomGestures` — when false, disables the cmd+wheel zoom, the
 *     trackpad pinch zoom, and the iframe-forwarded wheel-zoom message
 *     handler. The +/- toolbar buttons and keyboard shortcuts still work —
 *     only the gesture inputs are gated. Useful for landing pages where
 *     you want users to scroll the canvas like a normal webpage instead
 *     of accidentally zooming it.
 *
 *   - `zoomOrigin` — anchor point used by toolbar / keyboard zoom (and
 *     any other zoom invocation that doesn't pass an explicit cursor
 *     position). `"center"` (default) keeps the viewport-center point
 *     pinned, matching native canvas tools. `"top-left"` keeps the
 *     canvas's (0, 0) pinned to the viewport's top-left — useful for
 *     landing canvases where content is anchored to the top-left and
 *     center-anchored zoom would slide it off-screen.
 *     Pointer-driven zoom (wheel/pinch) is unaffected — it always
 *     anchors on the cursor.
 *
 *   - `surface` — sizes the underlying canvas surface (`.tc-canvas`)
 *     per axis. `{ width, height }` each accept `"auto"` (default,
 *     keeps the `max(100vw, 10000px)` floor so users can pan into a
 *     large workspace) or `"viewport"` (sizes to exactly `100vw` /
 *     `100vh`, so the unscaled surface matches the visible window
 *     exactly and zooming >100% surfaces real scroll). The store
 *     toggles `data-canvas-surface-width="viewport"` and
 *     `data-canvas-surface-height="viewport"` on `<html>` so CSS can
 *     pick up the override without React having to re-render.
 *
 * Defaults are seeded from `canvas.scroll.axis`, `canvas.zoom.gestures`,
 * `canvas.zoom.origin`, and `canvas.surface.{width,height}` in
 * `storyboard.config.json`. Runtime overrides can be applied at any
 * time via `setCanvasInteraction(partial)`.
 *
 * This is an **advanced, undocumented** extension surface — see
 * `core/stores/presentationStore.js` for the sibling system.
 *
 * Framework-agnostic (zero npm dependencies).
 */

const VALID_AXES = new Set(['both', 'vertical', 'horizontal', 'none'])
const VALID_ZOOM_ORIGINS = new Set(['center', 'top-left'])
const VALID_SURFACE_SIZES = new Set(['auto', 'viewport'])

const _defaults = {
  scrollAxis: 'both',
  zoomGestures: true,
  zoomOrigin: 'center',
  surface: { width: 'auto', height: 'auto' },
}

let _state = {
  ..._defaults,
  surface: { ..._defaults.surface },
}

/** @type {Set<Function>} */
const _listeners = new Set()

let _snapshotVersion = 0

function _applySurfaceAttrs() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (_state.surface.width === 'viewport') {
    root.dataset.canvasSurfaceWidth = 'viewport'
  } else {
    delete root.dataset.canvasSurfaceWidth
  }
  if (_state.surface.height === 'viewport') {
    root.dataset.canvasSurfaceHeight = 'viewport'
  } else {
    delete root.dataset.canvasSurfaceHeight
  }
}

function _readSurfaceFromConfig(input) {
  // Accept the nested shape ({ width, height }) directly, and ignore
  // anything malformed. Each axis is validated independently.
  if (!input || typeof input !== 'object') return null
  const next = {}
  if (typeof input.width === 'string' && VALID_SURFACE_SIZES.has(input.width)) {
    next.width = input.width
  }
  if (typeof input.height === 'string' && VALID_SURFACE_SIZES.has(input.height)) {
    next.height = input.height
  }
  return Object.keys(next).length ? next : null
}

/**
 * Seed the store from a partial config (typically from
 * `storyboard.config.json` → `canvas.scroll.axis`, `canvas.zoom.gestures`,
 * `canvas.zoom.origin`, and `canvas.surface`). Replaces any previous
 * overrides. Called once at app startup.
 *
 * @param {{
 *   scrollAxis?: string,
 *   zoomGestures?: boolean,
 *   zoomOrigin?: string,
 *   surface?: { width?: string, height?: string },
 * }} [config]
 */
export function initCanvasInteraction(config) {
  _state = {
    ..._defaults,
    surface: { ..._defaults.surface },
  }
  if (config && typeof config === 'object') {
    if (typeof config.scrollAxis === 'string' && VALID_AXES.has(config.scrollAxis)) {
      _state.scrollAxis = config.scrollAxis
    }
    if (typeof config.zoomGestures === 'boolean') {
      _state.zoomGestures = config.zoomGestures
    }
    if (typeof config.zoomOrigin === 'string' && VALID_ZOOM_ORIGINS.has(config.zoomOrigin)) {
      _state.zoomOrigin = config.zoomOrigin
    }
    const surfaceUpdate = _readSurfaceFromConfig(config.surface)
    if (surfaceUpdate) {
      _state.surface = { ..._state.surface, ...surfaceUpdate }
    }
  }
  _applySurfaceAttrs()
  _notify()
}

/**
 * Apply a partial runtime override. Unspecified keys keep their current value.
 * @param {{
 *   scrollAxis?: string,
 *   zoomGestures?: boolean,
 *   zoomOrigin?: string,
 *   surface?: { width?: string, height?: string },
 * }} partial
 */
export function setCanvasInteraction(partial) {
  if (!partial || typeof partial !== 'object') return
  let changed = false
  if (typeof partial.scrollAxis === 'string' && VALID_AXES.has(partial.scrollAxis) && partial.scrollAxis !== _state.scrollAxis) {
    _state.scrollAxis = partial.scrollAxis
    changed = true
  }
  if (typeof partial.zoomGestures === 'boolean' && partial.zoomGestures !== _state.zoomGestures) {
    _state.zoomGestures = partial.zoomGestures
    changed = true
  }
  if (typeof partial.zoomOrigin === 'string' && VALID_ZOOM_ORIGINS.has(partial.zoomOrigin) && partial.zoomOrigin !== _state.zoomOrigin) {
    _state.zoomOrigin = partial.zoomOrigin
    changed = true
  }
  const surfaceUpdate = _readSurfaceFromConfig(partial.surface)
  if (surfaceUpdate) {
    const merged = { ..._state.surface, ...surfaceUpdate }
    if (merged.width !== _state.surface.width || merged.height !== _state.surface.height) {
      _state.surface = merged
      _applySurfaceAttrs()
      changed = true
    }
  }
  if (changed) _notify()
}

/**
 * @returns {{
 *   scrollAxis: 'both'|'vertical'|'horizontal'|'none',
 *   zoomGestures: boolean,
 *   zoomOrigin: 'center'|'top-left',
 *   surface: { width: 'auto'|'viewport', height: 'auto'|'viewport' },
 * }}
 */
export function getCanvasInteraction() {
  return _state
}

/**
 * Subscribe to interaction changes. Returns an unsubscribe fn.
 * Compatible with `useSyncExternalStore`.
 * @param {Function} callback
 * @returns {Function}
 */
export function subscribeToCanvasInteraction(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

/**
 * Snapshot version for change detection. Compatible with `useSyncExternalStore`.
 * @returns {string}
 */
export function getCanvasInteractionSnapshot() {
  return String(_snapshotVersion)
}

function _notify() {
  _snapshotVersion++
  for (const cb of _listeners) {
    try { cb() } catch (err) {
      console.error('[storyboard] Error in canvas-interaction subscriber:', err)
    }
  }
}

/** Reset all state. Only for tests. */
export function _resetCanvasInteraction() {
  _state = {
    ..._defaults,
    surface: { ..._defaults.surface },
  }
  _applySurfaceAttrs()
  _listeners.clear()
  _snapshotVersion = 0
}
