/**
 * localStorage cache for comment pin data.
 *
 * Stores lightweight comment listings per route so pins render instantly
 * on repeat visits without hitting the GitHub API.
 */

const CACHE_PREFIX = 'sb-comments:'
const TTL_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Get cached comment listing for a route.
 * Returns null if cache is missing or expired.
 * @param {string} route
 * @returns {object|null} - Cached discussion object (with .comments array)
 */
export function getCachedComments(route) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + route)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (Date.now() - entry.ts > TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + route)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

/**
 * Store comment listing in cache for a route.
 * @param {string} route
 * @param {object} data - Discussion object with .comments array
 */
export function setCachedComments(route, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + route, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // localStorage full or unavailable — ignore
  }
}

/**
 * Clear cached comments for a specific route.
 * @param {string} route
 */
export function clearCachedComments(route) {
  try {
    localStorage.removeItem(CACHE_PREFIX + route)
  } catch {
    // ignore
  }
}

// --- Pending (failed) comments ---

const PENDING_PREFIX = 'sb-pending-comments:'

/**
 * Save a pending comment that failed to submit.
 * @param {string} route
 * @param {{ id: string, x: number, y: number, text: string, author: object }} comment
 */
export function savePendingComment(route, comment) {
  try {
    const pending = getPendingComments(route)
    // Replace if same id already exists, else append
    const idx = pending.findIndex(c => c.id === comment.id)
    if (idx >= 0) pending[idx] = comment
    else pending.push(comment)
    localStorage.setItem(PENDING_PREFIX + route, JSON.stringify(pending))
  } catch {
    // ignore
  }
}

/**
 * Get all pending (failed) comments for a route.
 * @param {string} route
 * @returns {Array<{ id: string, x: number, y: number, text: string, author: object }>}
 */
export function getPendingComments(route) {
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + route)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Remove a pending comment (after successful retry or dismissal).
 * @param {string} route
 * @param {string} pendingId
 */
export function removePendingComment(route, pendingId) {
  try {
    const pending = getPendingComments(route).filter(c => c.id !== pendingId)
    if (pending.length > 0) {
      localStorage.setItem(PENDING_PREFIX + route, JSON.stringify(pending))
    } else {
      localStorage.removeItem(PENDING_PREFIX + route)
    }
  } catch {
    // ignore
  }
}
