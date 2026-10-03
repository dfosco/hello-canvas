import { useSyncExternalStore } from 'react'
import { getFlag, subscribeToStorage, getStorageSnapshot } from '../../core/index.js'

/**
 * React hook for reading a feature flag value.
 * Re-renders when the flag changes (via localStorage).
 *
 * @param {string} key - Flag key (without "flag." prefix)
 * @returns {boolean} Current resolved flag value
 */
export function useFeatureFlag(key) {
  useSyncExternalStore(subscribeToStorage, getStorageSnapshot)
  return getFlag(key)
}
