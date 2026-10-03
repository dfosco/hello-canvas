/**
 * Recent Artifacts — localStorage-backed recents for the workspace and
 * command palette.
 *
 * Stores artifact identity (type + key + label), not routes.
 * Routes are derived at read time from the live data index so they
 * stay correct across branch/basePath changes.
 *
 * Subscribable via {@link subscribeToRecent} / {@link getRecentSnapshot}
 * for `useSyncExternalStore` integration. Writes within the same tab
 * are surfaced via a synthetic `storage` event so other listeners
 * (including this module's own snapshot consumers) re-read immediately.
 */

const STORAGE_KEY = 'storyboard:recent-artifacts'
const MAX_ITEMS = 30
const CHANGE_EVENT = 'storyboard-recent-artifacts-changed'

/**
 * @typedef {{ type: string, key: string, label: string }} RecentEntry
 */

/**
 * Track a recently visited artifact.
 * Pushes to the top, deduplicates by type+key, trims to MAX_ITEMS.
 *
 * @param {string} type  — 'prototype' | 'canvas' | 'story' | 'flow'
 * @param {string} key   — unique identifier (e.g. dirName, canvas id, story name)
 * @param {string} label — display label
 */
export function trackRecent(type, key, label) {
  if (!type || !key) return
  const entries = _read()
  const deduped = entries.filter(e => !(e.type === type && e.key === key))
  deduped.unshift({ type, key, label: label || key })
  _write(deduped.slice(0, MAX_ITEMS))
}

/**
 * Get the list of recently visited artifacts, newest first.
 * @returns {RecentEntry[]}
 */
export function getRecent() {
  return _read()
}

/**
 * Clear all recent artifacts. Useful for testing.
 */
export function clearRecent() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    _notify()
  } catch { /* ignore */ }
}

/**
 * Subscribe to changes in the recent artifacts store. Fires for both
 * intra-tab writes (via a synthetic event) and cross-tab writes (via
 * the native `storage` event).
 *
 * Designed for `useSyncExternalStore` — pair with {@link getRecentSnapshot}.
 *
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeToRecent(callback) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e) => { if (!e || !e.key || e.key === STORAGE_KEY) callback() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, callback)
  }
}

/**
 * Return a stable string snapshot of the recent artifacts store for
 * `useSyncExternalStore`. Returns the raw JSON (or `'[]'` if absent).
 *
 * @returns {string}
 */
export function getRecentSnapshot() {
  try { return localStorage.getItem(STORAGE_KEY) || '[]' }
  catch { return '[]' }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function _write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    _notify()
  } catch { /* quota exceeded or unavailable */ }
}

function _notify() {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new Event(CHANGE_EVENT)) }
  catch { /* ignore (e.g. SSR / non-browser) */ }
}
