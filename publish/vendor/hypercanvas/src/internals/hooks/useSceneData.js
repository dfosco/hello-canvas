import { useContext, useMemo, useSyncExternalStore } from 'react'
import { StoryboardContext } from '../StoryboardContext.js'
import { getByPath, deepClone, setByPath } from '../../core/index.js'
import { getParam, getAllParams } from '../../core/index.js'
import { subscribeToHash, getHashSnapshot } from '../../core/index.js'
import { isHideMode, getShadow, getAllShadows } from '../../core/index.js'
import { subscribeToStorage, getStorageSnapshot } from '../../core/index.js'

/**
 * Access flow data by dot-notation path.
 * Hash params override flow data — both exact matches and nested paths.
 *
 * Examples:
 *   useFlowData('user.name') with #user.name=Alice → "Alice"
 *   useFlowData('repositories') with #repositories.0.name=Foo
 *     → deep clone of repositories array with [0].name overridden to "Foo"
 *
 * @param {string} [path] - Dot-notation path (e.g. 'user.profile.name').
 *                          Omit to get the entire flow object.
 * @param {{ optional?: boolean }} [opts] - Pass { optional: true } to suppress
 *                          the "path not found" warning for optional data.
 * @returns {*} The resolved value. Returns {} if path is missing after loading.
 * @throws If used outside a StoryboardProvider.
 */
export function useFlowData(path, opts) {
  const context = useContext(StoryboardContext)

  if (context === null) {
    throw new Error('useFlowData must be used within a <StoryboardProvider>')
  }

  const { data, loading, error } = context

  // Re-render on any hash or localStorage change
  const hashString = useSyncExternalStore(subscribeToHash, getHashSnapshot)
  const storageString = useSyncExternalStore(subscribeToStorage, getStorageSnapshot)

  // Collect overrides relevant to this path
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const result = useMemo(() => {
    if (loading || error || data == null) return undefined

    const hidden = isHideMode()
    // In hide mode, read from shadow localStorage; otherwise from URL hash
    const readParam = hidden ? getShadow : getParam
    const readAllParams = hidden ? getAllShadows : getAllParams

    if (!path) {
      // No path → return full scene data with all overrides applied
      const allParams = readAllParams()
      const keys = Object.keys(allParams)
      if (keys.length === 0) return data
      const merged = deepClone(data)
      for (const key of keys) setByPath(merged, key, allParams[key])
      return merged
    }

    // Exact match: param directly for this path
    const exact = readParam(path)
    if (exact !== null) return exact

    // Child overrides: params that are nested under this path
    const prefix = path + '.'
    const allParams = readAllParams()
    const childKeys = Object.keys(allParams).filter(k => k.startsWith(prefix))

    const sceneValue = getByPath(data, path)

    if (childKeys.length > 0 && sceneValue !== undefined) {
      const merged = deepClone(sceneValue)
      for (const key of childKeys) {
        const relativePath = key.slice(prefix.length)
        setByPath(merged, relativePath, allParams[key])
      }
      return merged
    }

    if (sceneValue === undefined) {
      if (!opts?.optional && data != null && Object.keys(data).length > 0) {
        console.warn(`[useFlowData] Path "${path}" not found in flow data.`)
      }
      return {}
    }

    return sceneValue
  }, [data, loading, error, path, hashString, storageString]) // eslint-disable-line react-hooks/exhaustive-deps

  return result
}

/** @deprecated Use useFlowData() */
export const useSceneData = useFlowData

/**
 * Returns true while flow data is still loading.
 */
export function useFlowLoading() {
  const context = useContext(StoryboardContext)

  if (context === null) {
    throw new Error('useFlowLoading must be used within a <StoryboardProvider>')
  }

  return context.loading
}

/** @deprecated Use useFlowLoading() */
export const useSceneLoading = useFlowLoading
