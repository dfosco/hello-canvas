/**
 * Shared helpers for subscribing to URL hash changes in React hooks.
 */

/**
 * Subscribe to hash changes so React re-renders when the hash updates.
 * Compatible with useSyncExternalStore.
 */
export function subscribeToHash(callback) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

/**
 * Snapshot of the full hash string for useSyncExternalStore.
 */
export function getHashSnapshot() {
  return window.location.hash
}
