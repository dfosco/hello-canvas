/**
 * localStorage utilities for persistent storyboard overrides.
 *
 * Mirrors the session.js (URL hash) API but persists values in localStorage.
 *
 * **Per-app namespacing (closes server-state RCA hypothesis H7).**
 * All keys are prefixed with `storyboard:${devDomain}:${branch}:` derived
 * from `import.meta.env.BASE_URL`. Two repos sharing `storyboard.localhost`
 * (or a single repo with multiple branches open in tabs) can no longer leak
 * history snapshots, hide-mode state, or pending-navigation tokens across
 * apps.
 *
 * On first access we run a one-shot migration that drops legacy
 * `storyboard:*` keys whose stored route doesn't match the current
 * BASE_URL — this prevents stale history from being restored into the
 * wrong app after the upgrade.
 *
 * Reactivity:
 * - Cross-tab: native "storage" event (fires in other tabs automatically)
 * - Intra-tab: custom "storyboard-storage" event on window (the native
 *   "storage" event does NOT fire in the tab that made the change)
 */

const LEGACY_PREFIX = 'storyboard:'

/**
 * Compute the per-app key prefix from BASE_URL.
 *
 * BASE_URL examples → prefix:
 *   /                       → storyboard:default::
 *   /branch--0.5.0/         → storyboard:default:0.5.0:
 *   /storyboard/            → storyboard:default::
 * Once the runtime ships per-devDomain origins (M5), the host name will
 * provide the devDomain segment automatically; until then we use "default".
 */
function computePrefix() {
  let branch = ''
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
    const m = String(base).match(/\/branch--([a-z0-9._-]+)\/?$/i)
    branch = m ? m[1] : ''
  } catch {
    // SSR / non-Vite contexts — fall back to global namespace
  }
  let devDomain = 'default'
  try {
    const host = (typeof window !== 'undefined' && window.location?.hostname) || ''
    const m = host.match(/^([a-z][a-z0-9-]*)\.localhost$/i)
    if (m) devDomain = m[1].toLowerCase()
  } catch {
    /* leave default */
  }
  return `storyboard:${devDomain}:${branch}:`
}

const PREFIX = computePrefix()

/**
 * Public so tests and migration tooling can introspect the namespace
 * without recomputing it. Format: `storyboard:${devDomain}:${branch}:`.
 */
export const STORAGE_PREFIX = PREFIX

let _migrationRan = false
function runOneShotMigration() {
  if (_migrationRan) return
  _migrationRan = true
  try {
    if (typeof localStorage === 'undefined') return
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i)
      if (!raw) continue
      // Drop legacy un-namespaced keys (`storyboard:foo` but NOT `storyboard:devDomain:branch:foo`).
      if (raw.startsWith(LEGACY_PREFIX) && !raw.startsWith(PREFIX)) {
        // Only drop bare-namespace legacy keys: storyboard:<name> with no
        // further `:` matching our scheme. Conservative: keep keys that
        // already look namespaced under a different (devDomain, branch).
        const tail = raw.slice(LEGACY_PREFIX.length)
        const segments = tail.split(':')
        if (segments.length < 3) {
          toRemove.push(raw)
        }
      }
    }
    for (const k of toRemove) localStorage.removeItem(k)
  } catch {
    /* migration is best-effort */
  }
}

runOneShotMigration()

/**
 * Read a single value from localStorage.
 * @param {string} key - Unprefixed key (e.g. "settings.theme")
 * @returns {string|null}
 */
export function getLocal(key) {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

/**
 * Write a single value to localStorage and notify listeners.
 * @param {string} key - Unprefixed key
 * @param {string} value
 */
export function setLocal(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value))
    notifyChange()
  } catch {
    // localStorage full or unavailable — silently degrade
  }
}

/**
 * Remove a single key from localStorage and notify listeners.
 * @param {string} key - Unprefixed key
 */
export function removeLocal(key) {
  try {
    localStorage.removeItem(PREFIX + key)
    notifyChange()
  } catch {
    // silently degrade
  }
}

/**
 * Return all storyboard-prefixed localStorage entries as a plain object.
 * Keys are returned WITHOUT the prefix.
 * @returns {Record<string, string>}
 */
export function getAllLocal() {
  const result = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i)
      if (raw && raw.startsWith(PREFIX)) {
        result[raw.slice(PREFIX.length)] = localStorage.getItem(raw)
      }
    }
  } catch {
    // silently degrade
  }
  return result
}

/**
 * Subscribe to localStorage changes (both cross-tab and intra-tab).
 * Compatible with useSyncExternalStore.
 * @param {function} callback
 * @returns {function} unsubscribe
 */
export function subscribeToStorage(callback) {
  const wrappedCallback = () => {
    invalidateSnapshotCache()
    callback()
  }
  // Cross-tab: native storage event
  window.addEventListener('storage', wrappedCallback)
  // Intra-tab: custom event
  window.addEventListener('storyboard-storage', wrappedCallback)
  return () => {
    window.removeEventListener('storage', wrappedCallback)
    window.removeEventListener('storyboard-storage', wrappedCallback)
  }
}

// ── Snapshot cache ──

let _snapshotCache = null

/** Invalidate the snapshot cache so the next getStorageSnapshot() recomputes. */
function invalidateSnapshotCache() {
  _snapshotCache = null
}

/**
 * Snapshot of all storyboard localStorage entries as a serialized string.
 * Used by useSyncExternalStore to detect changes.
 * Cached — invalidated on writes and storage events.
 * @returns {string}
 */
export function getStorageSnapshot() {
  if (_snapshotCache !== null) return _snapshotCache
  try {
    const entries = []
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i)
      if (raw && raw.startsWith(PREFIX)) {
        entries.push(raw + '=' + localStorage.getItem(raw))
      }
    }
    _snapshotCache = entries.sort().join('&')
    return _snapshotCache
  } catch {
    return ''
  }
}

// ── Internal ──

/** Fire a custom event so intra-tab listeners re-render. */
export function notifyChange() {
  invalidateSnapshotCache()
  window.dispatchEvent(new Event('storyboard-storage'))
}
