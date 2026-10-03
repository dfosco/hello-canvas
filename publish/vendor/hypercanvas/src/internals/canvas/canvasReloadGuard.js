/**
 * Canvas reload guard — client-side state for preventing HMR full reloads.
 *
 * This module tracks whether a canvas is currently active. When active,
 * the Vite plugin suppresses full-page reloads to preserve canvas state.
 *
 * The actual guard logic is implemented in:
 * - Server: vite.config.js (ws.send monkey-patch + heartbeat)
 * - Client: CanvasPage.jsx (vite:beforeFullReload + vite:ws:disconnect)
 *
 * This module provides the state that those systems check.
 */

let active = false

/**
 * Enable the canvas reload guard.
 * Call when a canvas page mounts.
 */
export function enableCanvasGuard() {
  active = true
}

/**
 * Disable the canvas reload guard.
 * Call when a canvas page unmounts.
 */
export function disableCanvasGuard() {
  active = false
}

/**
 * Check if the canvas reload guard is currently active.
 */
export function isCanvasGuardActive() {
  return active
}
