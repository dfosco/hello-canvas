/**
 * Canvas write guard — coordinates the canvas server with Vite's file watcher
 * to prevent duplicate HMR events.
 *
 * When the canvas server writes to a .canvas.jsonl file, it immediately pushes
 * an HMR event via pushCanvasUpdate(). Vite's file watcher also detects the
 * change ~100-500ms later and the data plugin sends a second HMR event. This
 * duplicate event can cause visible rollbacks when the client has made new edits
 * in the intervening window.
 *
 * The guard tracks files currently being written by the canvas server. The data
 * plugin checks this before sending watcher-triggered HMR events and skips them
 * if the server has already pushed.
 *
 * Uses globalThis with a Symbol key to guarantee the same Map instance is shared
 * across all import paths (e.g., relative imports from server.js vs package
 * imports from data-plugin.js).
 */

const KEY = Symbol.for('sb:canvasWriteGuard')
if (!globalThis[KEY]) globalThis[KEY] = new Map()

/** @type {Map<string, number>} filePath → active write count */
const guard = globalThis[KEY]

/**
 * Mark a file as being written by the canvas server.
 * Call before appendEvent / writeFileSync.
 */
export function markCanvasWrite(filePath) {
  guard.set(filePath, (guard.get(filePath) || 0) + 1)
}

/**
 * Unmark a file after the watcher has had time to fire.
 * Call via setTimeout after the write + push completes.
 */
export function unmarkCanvasWrite(filePath) {
  const count = (guard.get(filePath) || 1) - 1
  if (count <= 0) guard.delete(filePath)
  else guard.set(filePath, count)
}

/**
 * Check if a file is currently being written by the canvas server.
 * The data plugin uses this to skip duplicate watcher-triggered HMR events.
 */
export function isCanvasWriteInFlight(filePath) {
  return guard.has(filePath)
}

// Legacy export for backward compatibility
export const canvasWritesInFlight = guard
