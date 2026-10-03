import { useContext, useMemo, useSyncExternalStore } from 'react'
import { loadObject, resolveObjectName } from '../../core/index.js'
import { getByPath, deepClone, setByPath } from '../../core/index.js'
import { getParam, getAllParams } from '../../core/index.js'
import { isHideMode, getShadow, getAllShadows } from '../../core/index.js'
import { subscribeToHash, getHashSnapshot } from '../../core/index.js'
import { subscribeToStorage, getStorageSnapshot } from '../../core/index.js'
import { StoryboardContext } from '../StoryboardContext.js'

/**
 * Load an object data file directly by name, without going through a scene.
 * Supports dot-notation path access and URL hash overrides.
 * Objects inside prototypes are automatically resolved with prototype scope.
 *
 * Hash override convention: object.{objectName}.{field}=value
 *
 * @param {string} objectName - Name of the object file (e.g., "jane-doe")
 * @param {string} [path] - Optional dot-notation path (e.g., "profile.name")
 * @returns {*} The resolved value, or undefined if loading fails
 *
 * @example
 * const user = useObject('jane-doe')
 * const name = useObject('jane-doe', 'profile.name')
 *
 * // Override via URL hash: #object.jane-doe.name=Alice
 */
export function useObject(objectName, path) {
  const context = useContext(StoryboardContext)
  const prototypeName = context?.prototypeName ?? null
  const hashString = useSyncExternalStore(subscribeToHash, getHashSnapshot)
  const storageString = useSyncExternalStore(subscribeToStorage, getStorageSnapshot)

  return useMemo(() => {
    const resolvedName = resolveObjectName(prototypeName, objectName)
    let data
    try {
      data = loadObject(resolvedName)
    } catch (err) {
      console.error(`[useObject] ${err.message}`)
      return undefined
    }

    const hidden = isHideMode()
    const readParam = hidden ? getShadow : getParam
    const readAllParams = hidden ? getAllShadows : getAllParams

    // Apply overrides scoped to this object.
    // Check both the resolved (scoped) prefix and the plain (unscoped) prefix
    // so overrides work whether written with the bare or scoped name.
    const resolvedPrefix = `object.${resolvedName}.`
    const plainPrefix = objectName !== resolvedName ? `object.${objectName}.` : null
    const allParams = readAllParams()
    const overrideKeys = Object.keys(allParams).filter(k =>
      k.startsWith(resolvedPrefix) || (plainPrefix && k.startsWith(plainPrefix))
    )

    if (overrideKeys.length > 0) {
      data = deepClone(data)
      for (const key of overrideKeys) {
        const fieldPath = key.startsWith(resolvedPrefix)
          ? key.slice(resolvedPrefix.length)
          : key.slice(plainPrefix.length)
        setByPath(data, fieldPath, allParams[key])
      }
    }

    if (!path) return data

    // Exact match for this sub-path override (check both prefixes)
    const exactResolved = `${resolvedPrefix}${path}`
    const exactPlain = plainPrefix ? `${plainPrefix}${path}` : null
    const exact = readParam(exactResolved) ?? (exactPlain ? readParam(exactPlain) : null)
    if (exact !== null) return exact

    // Child overrides under the sub-path
    const subResolved = exactResolved + '.'
    const subPlain = exactPlain ? exactPlain + '.' : null
    const childKeys = overrideKeys.filter(k =>
      k.startsWith(subResolved) || (subPlain && k.startsWith(subPlain))
    )
    const baseValue = getByPath(data, path)

    if (childKeys.length > 0 && baseValue !== undefined) {
      const merged = deepClone(baseValue)
      for (const key of childKeys) {
        const relativePath = key.startsWith(subResolved)
          ? key.slice(subResolved.length)
          : key.slice(subPlain.length)
        setByPath(merged, relativePath, allParams[key])
      }
      return merged
    }

    if (baseValue === undefined) {
      console.warn(`[useObject] Path "${path}" not found in object "${objectName}".`)
      return undefined
    }

    return baseValue
  }, [objectName, prototypeName, path, hashString, storageString]) // eslint-disable-line react-hooks/exhaustive-deps
}
