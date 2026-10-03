/**
 * fileContentStore.js
 *
 * Client-side per-path subscribe/broadcast store for FileWidget.
 * Manages loading, caching, in-memory editing, saving, and external change
 * detection for repo files served by the /_storyboard/file/ API.
 *
 * All state is module-level (singleton). Multiple widgets pointing at the
 * same path share a single cache entry and receive notifications together.
 */

import { storyboardWs } from '../../../storyboard-ws.js'

// ── Internal state ────────────────────────────────────────────────────────────

/** @type {Map<string, Object>} path → entry snapshot */
const cache = new Map()

/** @type {Map<string, Set<Function>>} path → subscriber callbacks */
const subscribers = new Map()

/** @type {Map<string, Promise>} path → in-flight load promise (de-dup) */
const inFlight = new Map()

let wsInitialized = false

// ── URL helpers ───────────────────────────────────────────────────────────────

function getApiBase() {
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
  return base + '/_storyboard/file'
}

// ── Entry helpers ─────────────────────────────────────────────────────────────

function defaultEntry() {
  return {
    content: '',
    exists: undefined,
    loading: false,
    dirty: false,
    error: null,
    mtime: null,
    size: null,
    hasExternalChange: false,
    renamedTo: undefined,
  }
}

function getOrCreateEntry(path) {
  if (!cache.has(path)) cache.set(path, defaultEntry())
  return cache.get(path)
}

function patch(path, updates) {
  const entry = getOrCreateEntry(path)
  Object.assign(entry, updates)
  return entry
}

function notify(path) {
  const subs = subscribers.get(path)
  if (!subs || subs.size === 0) return
  const entry = cache.get(path) || defaultEntry()
  for (const cb of subs) cb(entry)
}

// ── WS listener ───────────────────────────────────────────────────────────────

function initWsListener() {
  if (wsInitialized) return
  wsInitialized = true
  storyboardWs.on('storyboard:file-changed', ({ path }) => {
    handleExternalChange(path)
  })
}

function handleExternalChange(path) {
  if (!cache.has(path)) return
  const entry = cache.get(path)
  if (entry.dirty) {
    patch(path, { hasExternalChange: true })
    notify(path)
  } else {
    refetchFile(path)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a synchronous snapshot of the current entry for a path.
 * Unknown paths return a default empty entry without side effects.
 * @param {string} path Repo-relative file path
 * @returns {Object} Entry snapshot
 */
export function getFileEntry(path) {
  return cache.get(path) || defaultEntry()
}

/**
 * Subscribe to all state changes for a path.
 * If the path is not yet cached, schedules an initial load automatically.
 * The callback is called with the current entry immediately, then on every
 * subsequent change.
 *
 * @param {string} path Repo-relative file path
 * @param {Function} callback Receives the entry on every change
 * @returns {Function} Unsubscribe function
 */
export function subscribe(path, callback) {
  initWsListener()
  if (!subscribers.has(path)) subscribers.set(path, new Set())
  subscribers.get(path).add(callback)

  if (!cache.has(path)) {
    // loadFile patches → loading:true and notifies, which includes this subscriber
    loadFile(path)
  } else {
    // Already in cache (loaded or loading) — give immediate snapshot
    callback(cache.get(path))
  }

  return function unsubscribe() {
    const subs = subscribers.get(path)
    if (!subs) return
    subs.delete(callback)
    if (subs.size === 0) subscribers.delete(path)
  }
}

/**
 * Load file content from the server.
 * Concurrent calls for the same path share a single in-flight promise.
 * If the path is already loaded and not currently re-fetching, returns the
 * cached entry immediately.
 *
 * @param {string} path Repo-relative file path
 * @returns {Promise<Object>} Resolved entry
 */
export function loadFile(path) {
  if (inFlight.has(path)) return inFlight.get(path)

  const existing = cache.get(path)
  if (existing && existing.exists !== undefined && !existing.loading) {
    return Promise.resolve(existing)
  }

  patch(path, { loading: true, error: null })
  notify(path)

  const promise = fetch(`${getApiBase()}/read?path=${encodeURIComponent(path)}`)
    .then(async (res) => {
      if (res.status === 404) {
        const entry = patch(path, { content: '', exists: false, loading: false })
        notify(path)
        return entry
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      const entry = patch(path, {
        content: data.content,
        exists: true,
        loading: false,
        mtime: data.mtime,
        size: data.size,
        error: null,
      })
      notify(path)
      return entry
    })
    .catch((err) => {
      const entry = patch(path, { loading: false, error: err.message })
      notify(path)
      return entry
    })
    .finally(() => {
      inFlight.delete(path)
    })

  inFlight.set(path, promise)
  return promise
}

/**
 * Update in-memory content for a path and notify subscribers synchronously.
 * Skips the notification if neither content nor dirty flag changed.
 *
 * @param {string} path Repo-relative file path
 * @param {string} newContent New content string
 * @param {{ dirty?: boolean }} [options]
 */
export function updateContent(path, newContent, { dirty = true } = {}) {
  const existing = getOrCreateEntry(path)
  if (existing.content === newContent && existing.dirty === dirty) return
  patch(path, { content: newContent, dirty })
  notify(path)
}

/**
 * Save the current in-memory content to the server via PUT /write.
 * Clears dirty state on success; keeps dirty and sets error on failure.
 *
 * @param {string} path Repo-relative file path
 * @returns {Promise<Object>} Resolved entry
 */
export async function saveFile(path) {
  const entry = getOrCreateEntry(path)

  let res
  try {
    res = await fetch(`${getApiBase()}/write`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: entry.content }),
    })
  } catch (err) {
    patch(path, { error: err.message })
    notify(path)
    throw err
  }

  if (!res.ok) {
    let errMsg
    try { errMsg = await res.text() } catch { errMsg = `HTTP ${res.status}` }
    patch(path, { error: errMsg })
    notify(path)
    throw new Error(errMsg)
  }

  const data = await res.json()
  const updated = patch(path, {
    dirty: false,
    mtime: data.mtime,
    size: data.size,
    error: null,
    hasExternalChange: false,
  })
  notify(path)
  return updated
}

/**
 * Force a re-fetch of file content from the server, bypassing cache.
 * Used internally by the WS handler when an external change is detected.
 *
 * @param {string} path Repo-relative file path
 * @returns {Promise<Object>} Resolved entry
 */
export function refetchFile(path) {
  // Reset exists so loadFile's early-return guard doesn't short-circuit
  if (cache.has(path)) patch(path, { exists: undefined })
  inFlight.delete(path)
  return loadFile(path)
}

/**
 * Poll the server for the latest content of a path without disturbing the
 * cache when nothing changed. Used by FileWidget's 5s polling fallback (the
 * HMR `storyboard:file-changed` WS event isn't always delivered) and to make
 * sure the freshest content is loaded the moment a user enters edit mode.
 *
 * Behaviour:
 * - Never clobbers unsaved edits: if the entry is dirty, it flags
 *   `hasExternalChange` (matching the WS path) instead of overwriting.
 * - Only notifies subscribers when the content or existence actually changed,
 *   so idle widgets (markdown/MDX previews) don't re-render every interval.
 * - Skips while a load is already in flight to avoid stacking requests.
 *
 * @param {string} path Repo-relative file path
 * @returns {Promise<void>}
 */
export async function pollFile(path) {
  if (inFlight.has(path)) return

  let res
  try {
    res = await fetch(`${getApiBase()}/read?path=${encodeURIComponent(path)}`)
  } catch {
    return // transient network error — try again on the next tick
  }

  // Re-read the entry after the await: the user may have started editing
  // (dirty) while the request was in flight.
  const prev = cache.get(path)

  if (res.status === 404) {
    if (prev && prev.dirty) {
      if (!prev.hasExternalChange) {
        patch(path, { hasExternalChange: true })
        notify(path)
      }
      return
    }
    if (!prev || prev.exists !== false) {
      patch(path, { content: '', exists: false, mtime: null, size: null })
      notify(path)
    }
    return
  }

  if (!res.ok) return

  let data
  try {
    data = await res.json()
  } catch {
    return
  }

  const after = cache.get(path)

  // Unsaved local edits win — surface the external change but keep the buffer.
  if (after && after.dirty) {
    if (after.content !== data.content && !after.hasExternalChange) {
      patch(path, { hasExternalChange: true })
      notify(path)
    }
    return
  }

  const contentChanged = !after || after.content !== data.content || after.exists !== true
  if (contentChanged) {
    patch(path, {
      content: data.content,
      exists: true,
      loading: false,
      mtime: data.mtime,
      size: data.size,
      error: null,
      hasExternalChange: false,
    })
    notify(path)
  } else if (after.mtime !== data.mtime || after.size !== data.size) {
    // Metadata drift only — keep it current without forcing a re-render.
    patch(path, { mtime: data.mtime, size: data.size })
  }
}

/**
 * Check whether a file exists at the given repo-relative path.
 *
 * @param {string} path Repo-relative file path
 * @returns {Promise<boolean>}
 */
export async function fileExists(path) {
  try {
    const res = await fetch(`${getApiBase()}/exists?path=${encodeURIComponent(path)}`)
    if (!res.ok) return false
    const data = await res.json()
    return data.exists === true
  } catch {
    return false
  }
}

/**
 * Rename a file from one path to another.
 * On success, moves the cache entry: old-path subscribers receive
 * `{ exists: false, renamedTo: to }` so their widget can update `props.path`.
 *
 * @param {string} from Source repo-relative path
 * @param {string} to   Destination repo-relative path
 * @returns {Promise<{ from: string, to: string }>}
 */
export async function renameFile(from, to) {
  const res = await fetch(`${getApiBase()}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })

  if (!res.ok) {
    throw new Error(`Rename failed: HTTP ${res.status}`)
  }

  const oldEntry = cache.get(from)
  if (oldEntry) {
    // Snapshot before mutating the from entry
    const snapshot = { ...oldEntry }

    // Notify old path subscribers that the file is gone/renamed
    patch(from, { exists: false, renamedTo: to })
    notify(from)

    // Seed the new cache entry from the snapshot
    cache.set(to, { ...snapshot, renamedTo: undefined, error: null })
    notify(to)
  }

  return { from, to }
}

/**
 * Reset all store state. For use in tests only.
 *
 * @returns {{ triggerFileChanged: Function }} Test helpers
 */
export function _resetStoreForTests() {
  cache.clear()
  subscribers.clear()
  inFlight.clear()
  wsInitialized = false

  return {
    /** Simulate a `storyboard:file-changed` WS event for a path. */
    triggerFileChanged: (path) => handleExternalChange(path),
  }
}
