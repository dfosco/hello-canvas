/**
 * Hide-mode + undo/redo override history.
 *
 * In normal mode, overrides live in the URL hash (#key=value).
 * In hide mode, overrides live in localStorage and the URL stays clean.
 *
 * The localStorage mirror stores three keys under storyboard:
 *
 *   historyState  → [[0, "/route", "params"], [1, "/other", "params"], ...]
 *                   Ordered chronologically: 0 = first state, 1, 2, 3…
 *                   Each entry is [position, route, paramString].
 *
 *   currentState  → index into historyState for the active snapshot
 *
 *   nextState     → index into historyState for redo target (null if none).
 *                   Cleared when the user creates a new state that doesn't
 *                   match previousState or nextState (i.e. a "branch").
 *
 * Undo moves currentState backward (currentState - 1 = previousState).
 * Redo moves currentState forward to nextState.
 * A fresh override write appends to historyState, advances currentState,
 * and clears nextState (forking the timeline).
 *
 * The hide flag is stored as: storyboard:__hide__
 */

import { getLocal, setLocal, removeLocal, notifyChange } from './localStorage.js'
import { setParam } from './session.js'

const HIDE_FLAG = '__hide__'
const HISTORY_KEY = 'historyState'
const CURRENT_KEY = 'currentState'
const NEXT_KEY = 'nextState'
const MAX_HISTORY = 200

// ── Hide Mode ──

/**
 * Check whether hide mode is currently active.
 * @returns {boolean}
 */
export function isHideMode() {
  return getLocal(HIDE_FLAG) === '1'
}

/**
 * Activate hide mode:
 * 1. Snapshot current state into the history
 * 2. Set the hide flag
 * 3. Clear the URL hash and strip ?hide
 */
export function activateHideMode() {
  pushSnapshot()
  setLocal(HIDE_FLAG, '1')

  const url = new URL(window.location.href)
  url.searchParams.delete('hide')
  url.hash = ''
  window.history.replaceState(window.history.state, '', url.toString())
}

/**
 * Deactivate hide mode:
 * 1. Restore current snapshot params → URL hash
 * 2. Remove hide flag
 * 3. Strip ?show from the URL
 * (History is never cleared)
 */
export function deactivateHideMode() {
  const params = getCurrentSnapshot()
  if (params) {
    window.location.hash = ''
    const parsed = new URLSearchParams(params)
    for (const [key, value] of parsed.entries()) {
      setParam(key, value)
    }
  }

  removeLocal(HIDE_FLAG)
  stripSearchParam('show')
}

// ── History Stack ──

/**
 * Get the current route pathname.
 * @returns {string}
 */
function currentRoute() {
  return window.location.pathname
}

/**
 * Get the current hash as a normalized param string.
 * @returns {string}
 */
function currentParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).toString()
}

/**
 * Push a new snapshot onto the history stack.
 *
 * Appends after currentState, advances currentState, and clears nextState
 * (forking the timeline — any redo future is discarded).
 *
 * @param {string} [paramString] - Override param string. Defaults to current hash.
 * @param {string} [route] - Route pathname. Defaults to current pathname.
 */
export function pushSnapshot(paramString, route) {
  const params = paramString !== undefined ? paramString : currentParams()
  const routePath = route !== undefined ? route : currentRoute()

  const history = getOverrideHistory()
  const current = getCurrentIndex()

  // Don't push duplicates of the current state (same route + params)
  if (current !== null && history[current]) {
    const [, prevRoute, prevParams] = history[current]
    if (prevRoute === routePath && prevParams === params) return
  }

  // Trim any entries after currentState (fork the timeline)
  const base = current !== null ? history.slice(0, current + 1) : history

  // Append new entry: [position, route, params]
  const newIndex = base.length
  const entry = [newIndex, routePath, params]

  // Enforce max history by dropping oldest entries
  const updated = [...base, entry]
  if (updated.length > MAX_HISTORY) {
    const trimmed = updated.slice(updated.length - MAX_HISTORY)
    for (let i = 0; i < trimmed.length; i++) {
      trimmed[i] = [i, trimmed[i][1], trimmed[i][2]]
    }
    setLocal(HISTORY_KEY, JSON.stringify(trimmed))
    setLocal(CURRENT_KEY, String(trimmed.length - 1))
  } else {
    setLocal(HISTORY_KEY, JSON.stringify(updated))
    setLocal(CURRENT_KEY, String(newIndex))
  }

  // New state forks the timeline — clear redo target
  removeLocal(NEXT_KEY)
}

/**
 * Undo: move currentState back by one. Sets nextState to the old current
 * so redo can return.
 * @returns {{ route: string, params: string }|null}
 */
export function undo() {
  const current = getCurrentIndex()
  if (current === null || current <= 0) return null

  const prevIndex = current - 1
  const history = getOverrideHistory()
  if (!history[prevIndex]) return null

  setLocal(NEXT_KEY, String(current))
  setLocal(CURRENT_KEY, String(prevIndex))

  const [, route, params] = history[prevIndex]
  applySnapshot(params)
  return { route, params }
}

/**
 * Redo: move currentState forward to nextState.
 * @returns {{ route: string, params: string }|null}
 */
export function redo() {
  const nextIndex = getNextIndex()
  if (nextIndex === null) return null

  const history = getOverrideHistory()
  if (!history[nextIndex]) return null

  const followingIndex = nextIndex + 1
  if (history[followingIndex]) {
    setLocal(NEXT_KEY, String(followingIndex))
  } else {
    removeLocal(NEXT_KEY)
  }

  setLocal(CURRENT_KEY, String(nextIndex))

  const [, route, params] = history[nextIndex]
  applySnapshot(params)
  return { route, params }
}

/**
 * Get the full override history stack.
 * @returns {Array<[number, string, string]>} Array of [index, route, paramString]
 */
export function getOverrideHistory() {
  const raw = getLocal(HISTORY_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Get the current state index.
 * @returns {number|null}
 */
export function getCurrentIndex() {
  const raw = getLocal(CURRENT_KEY)
  if (raw === null) return null
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? null : n
}

/**
 * Get the next state index (redo target).
 * @returns {number|null}
 */
export function getNextIndex() {
  const raw = getLocal(NEXT_KEY)
  if (raw === null) return null
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? null : n
}

/**
 * Get the current snapshot's param string.
 * @returns {string|null}
 */
export function getCurrentSnapshot() {
  const current = getCurrentIndex()
  if (current === null) return null
  const history = getOverrideHistory()
  if (!history[current]) return null
  return history[current][2]
}

/**
 * Get the current snapshot's route.
 * @returns {string|null}
 */
export function getCurrentRoute() {
  const current = getCurrentIndex()
  if (current === null) return null
  const history = getOverrideHistory()
  if (!history[current]) return null
  return history[current][1]
}

/**
 * Check if undo is available.
 * @returns {boolean}
 */
export function canUndo() {
  const current = getCurrentIndex()
  return current !== null && current > 0
}

/**
 * Check if redo is available.
 * @returns {boolean}
 */
export function canRedo() {
  return getNextIndex() !== null
}

// ── Shadow Read/Write (used by useOverride in hide mode) ──

/**
 * Read a single shadow value from the current snapshot.
 * @param {string} key - Dot-notation path
 * @returns {string|null}
 */
export function getShadow(key) {
  const params = getCurrentSnapshot()
  if (!params) return null
  return new URLSearchParams(params).get(key)
}

/**
 * Write a shadow value by pushing a new snapshot with the key updated.
 * @param {string} key
 * @param {string} value
 */
export function setShadow(key, value) {
  const params = getCurrentSnapshot() || ''
  const parsed = new URLSearchParams(params)
  parsed.set(key, String(value))
  pushSnapshot(parsed.toString(), getCurrentRoute() || currentRoute())
}

/**
 * Remove a shadow value by pushing a new snapshot without the key.
 * @param {string} key
 */
export function removeShadow(key) {
  const params = getCurrentSnapshot() || ''
  const parsed = new URLSearchParams(params)
  parsed.delete(key)
  pushSnapshot(parsed.toString(), getCurrentRoute() || currentRoute())
}

/**
 * Return all shadow entries from the current snapshot as a plain object.
 * @returns {Record<string, string>}
 */
export function getAllShadows() {
  const params = getCurrentSnapshot()
  if (!params) return {}
  const parsed = new URLSearchParams(params)
  const result = {}
  for (const [key, value] of parsed.entries()) {
    result[key] = value
  }
  return result
}

// ── Hash ↔ History Sync ──

/**
 * Sync localStorage currentState when the URL changes externally
 * (e.g. browser back/forward). Matches on route + params.
 *
 * - Adjacent move backward → treated as undo (sets nextState)
 * - Adjacent move forward to nextState → treated as redo (advances nextState)
 * - Non-adjacent jump → clears nextState and truncates history
 * - No match in history → pushes as new snapshot
 */
export function syncHashToHistory() {
  if (isHideMode()) return

  const route = currentRoute()
  const params = currentParams()

  const history = getOverrideHistory()
  const current = getCurrentIndex()

  // Empty state and empty history — nothing to sync
  if (!params && !route && history.length === 0) return

  // Find matching entry (same route AND params)
  const matchIndex = history.findIndex(
    ([, r, p]) => r === route && p === params
  )

  if (matchIndex === -1) {
    pushSnapshot(params, route)
    return
  }

  if (matchIndex === current) return

  const prevIndex = current !== null ? current - 1 : null
  const nextIndex = getNextIndex()

  if (prevIndex !== null && matchIndex === prevIndex) {
    setLocal(NEXT_KEY, String(current))
    setLocal(CURRENT_KEY, String(matchIndex))
  } else if (nextIndex !== null && matchIndex === nextIndex) {
    const followingIndex = nextIndex + 1
    if (history[followingIndex]) {
      setLocal(NEXT_KEY, String(followingIndex))
    } else {
      removeLocal(NEXT_KEY)
    }
    setLocal(CURRENT_KEY, String(matchIndex))
  } else {
    // Non-adjacent jump — clear nextState and truncate
    removeLocal(NEXT_KEY)
    setLocal(CURRENT_KEY, String(matchIndex))
    const trimmed = history.slice(0, matchIndex + 1)
    setLocal(HISTORY_KEY, JSON.stringify(trimmed))
  }

  notifyChange()
}

/**
 * Install listeners that keep localStorage history in sync
 * with browser navigation. Call once at app startup.
 * Also records the initial page load as the first history entry.
 */
export function installHistorySync() {
  // Record initial page state — but skip in hide mode where the hash
  // is intentionally empty; pushing it would clobber the real shadow data.
  if (!isHideMode()) {
    pushSnapshot()
  }

  window.addEventListener('hashchange', () => syncHashToHistory())
  window.addEventListener('popstate', () => syncHashToHistory())
}

// ── Internal ──

/**
 * Apply a snapshot param string to the active override target.
 * In hide mode, localStorage is already updated — just notify.
 * In normal mode, write to the URL hash.
 * @param {string} params
 */
function applySnapshot(params) {
  if (isHideMode()) {
    notifyChange()
  } else {
    window.location.hash = params
  }
}

/**
 * Remove a search param from the URL without triggering a navigation.
 * @param {string} param
 */
function stripSearchParam(param) {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(param)) return
  url.searchParams.delete(param)
  window.history.replaceState(window.history.state, '', url.toString())
}
