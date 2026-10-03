import { useCallback, useContext, useSyncExternalStore } from 'react'
import { StoryboardContext } from '../StoryboardContext.js'
import { getByPath } from '../../core/index.js'
import { getParam } from '../../core/index.js'
import { getLocal, setLocal, removeLocal, subscribeToStorage, getStorageSnapshot } from '../../core/index.js'
import { subscribeToHash, getHashSnapshot } from '../../core/index.js'

/**
 * Persistent localStorage override on top of scene data.
 *
 * Read priority:  URL hash param → localStorage → Scene JSON value → undefined
 * Write target:   localStorage (not the URL hash)
 *
 * Use this hook for values that should survive page refreshes (e.g. theme).
 * For ephemeral URL-based overrides, use `useOverride()`.
 *
 * @param {string} path - Dot-notation key (e.g. 'settings.theme')
 * @returns {[any, function, function]}
 *   [0] current value (hash ?? localStorage ?? scene default)
 *   [1] setValue(newValue) – write to localStorage
 *   [2] clearValue()      – remove from localStorage
 */
export function useLocalStorage(path) {
  const context = useContext(StoryboardContext)
  if (context === null) {
    throw new Error('useLocalStorage must be used within a <StoryboardProvider>')
  }

  const { data } = context

  // Scene default for this path
  const sceneDefault = data != null ? getByPath(data, path) : undefined

  // Subscribe to both hash and localStorage changes for reactivity
  useSyncExternalStore(subscribeToHash, getHashSnapshot)
  useSyncExternalStore(subscribeToStorage, getStorageSnapshot)

  // Read priority: hash → localStorage → scene default
  const hashValue = getParam(path)
  const localValue = getLocal(path)
  const value = hashValue !== null ? hashValue : (localValue !== null ? localValue : sceneDefault)

  /** Write a value to localStorage */
  const setValue = useCallback(
    (newValue) => {
      setLocal(path, newValue)
    },
    [path],
  )

  /** Remove the localStorage value, reverting to scene default */
  const clearValue = useCallback(() => {
    removeLocal(path)
  }, [path])

  return [value, setValue, clearValue]
}
