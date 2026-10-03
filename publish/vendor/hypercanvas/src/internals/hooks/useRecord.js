import { useContext, useMemo, useSyncExternalStore } from 'react'
import { useParams } from 'react-router-dom'
import { loadRecord, resolveRecordName } from '../../core/index.js'
import { deepClone, setByPath } from '../../core/index.js'
import { getAllParams } from '../../core/index.js'
import { isHideMode, getAllShadows } from '../../core/index.js'
import { subscribeToHash, getHashSnapshot } from '../../core/index.js'
import { subscribeToStorage, getStorageSnapshot } from '../../core/index.js'
import { StoryboardContext } from '../StoryboardContext.js'

/**
 * Collect overrides for a record and merge them into the base array.
 *
 * In normal mode reads from URL hash params; in hide mode reads from
 * localStorage shadow snapshots.
 *
 * Hash convention: record.{recordName}.{entryId}.{field}=value
 *
 * - Existing entries (matched by id) get fields merged on top.
 * - Unknown ids create new entries appended to the array.
 *
 * @param {Array} baseRecords - The original record array (will be deep-cloned)
 * @param {string} resolvedName - Resolved (possibly scoped) record name (e.g. "security/rules")
 * @param {string} [plainName] - Original unscoped record name (e.g. "rules"). Falls back to resolvedName.
 * @returns {Array} Merged array
 */
function applyRecordOverrides(baseRecords, resolvedName, plainName) {
  const allParams = isHideMode() ? getAllShadows() : getAllParams()

  // Check both the resolved (scoped) prefix and the plain (unscoped) prefix.
  // Callers write overrides with the plain name, but the data index resolves
  // to the scoped name — we need to match both so overrides are not silently
  // dropped for prototype-scoped records.
  const resolvedPrefix = `record.${resolvedName}.`
  const plainPrefix = plainName && plainName !== resolvedName
    ? `record.${plainName}.`
    : null

  // Collect only the params that target this record
  const overrideKeys = Object.keys(allParams).filter(k =>
    k.startsWith(resolvedPrefix) || (plainPrefix && k.startsWith(plainPrefix))
  )
  if (overrideKeys.length === 0) return baseRecords

  const records = deepClone(baseRecords)

  // Group overrides by entry id
  // key format: record.{name}.{entryId}.{field...}
  const byEntryId = {}
  for (const key of overrideKeys) {
    // Determine which prefix matched to slice correctly
    const prefix = key.startsWith(resolvedPrefix) ? resolvedPrefix : plainPrefix
    const rest = key.slice(prefix.length) // "{entryId}.{field...}"
    const dotIdx = rest.indexOf('.')
    if (dotIdx === -1) continue // no field path — skip
    const entryId = rest.slice(0, dotIdx)
    const fieldPath = rest.slice(dotIdx + 1)
    if (!byEntryId[entryId]) byEntryId[entryId] = {}
    byEntryId[entryId][fieldPath] = allParams[key]
  }

  for (const [entryId, fields] of Object.entries(byEntryId)) {
    const existing = records.find(e => e.id === entryId)
    if (existing) {
      // Merge fields into existing entry
      for (const [fieldPath, value] of Object.entries(fields)) {
        setByPath(existing, fieldPath, value)
      }
    } else {
      // Create new entry and append
      const newEntry = { id: entryId }
      for (const [fieldPath, value] of Object.entries(fields)) {
        setByPath(newEntry, fieldPath, value)
      }
      records.push(newEntry)
    }
  }

  return records
}

/**
 * Loads a single record entry from a record collection, matched by URL param.
 * Hash overrides are applied before lookup — both field overrides on existing
 * entries and entirely new entries added via the URL are supported.
 *
 * The `paramName` serves double duty: it's both the route param to read from
 * the URL and the record field to match against. This maps naturally to the
 * file-based routing convention — `[id].jsx` matches entry.id,
 * `[permalink].jsx` would match entry.permalink, etc.
 *
 * @param {string} recordName - Name of the record file (e.g., "posts")
 * @param {string} paramName - Route param name, also used as the entry field to match
 * @returns {object|null} The matched record entry, or null if not found
 *
 * @example
 * // In pages/issues/[id].jsx:
 * const issue = useRecord('issues', 'id')
 * // URL /issues/refactor-auth-sso → finds entry where entry.id === 'refactor-auth-sso'
 *
 * // In pages/posts/[permalink].jsx:
 * const post = useRecord('posts', 'permalink')
 * // URL /posts/hello-world → finds entry where entry.permalink === 'hello-world'
 */
export function useRecord(recordName, paramName = 'id') {
  const params = useParams()
  const paramValue = params[paramName]
  const context = useContext(StoryboardContext)
  const prototypeName = context?.prototypeName ?? null

  // Re-render on hash or localStorage changes so overrides are reactive
  const hashString = useSyncExternalStore(subscribeToHash, getHashSnapshot)
  const storageString = useSyncExternalStore(subscribeToStorage, getStorageSnapshot)

  return useMemo(() => {
    if (!paramValue) return null
    try {
      const resolvedName = resolveRecordName(prototypeName, recordName)
      const base = loadRecord(resolvedName)
      const merged = applyRecordOverrides(base, resolvedName, recordName)
      return merged.find(e => e[paramName] === paramValue) ?? null
    } catch (err) {
      console.error(`[useRecord] ${err.message}`)
      return null
    }
  }, [recordName, paramName, paramValue, prototypeName, hashString, storageString]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Loads all entries from a record collection.
 * Hash overrides are applied — existing entries can be modified and
 * new entries can be created entirely from URL hash params.
 *
 * @param {string} recordName - Name of the record file (e.g., "posts")
 * @returns {Array} All record entries (with overrides applied)
 *
 * @example
 * const allPosts = useRecords('posts')
 */
export function useRecords(recordName) {
  const context = useContext(StoryboardContext)
  const prototypeName = context?.prototypeName ?? null

  // Re-render on hash or localStorage changes so overrides are reactive
  const hashString = useSyncExternalStore(subscribeToHash, getHashSnapshot)
  const storageString = useSyncExternalStore(subscribeToStorage, getStorageSnapshot)

  return useMemo(() => {
    try {
      const resolvedName = resolveRecordName(prototypeName, recordName)
      const base = loadRecord(resolvedName)
      return applyRecordOverrides(base, resolvedName, recordName)
    } catch (err) {
      console.error(`[useRecords] ${err.message}`)
      return []
    }
  }, [recordName, prototypeName, hashString, storageString]) // eslint-disable-line react-hooks/exhaustive-deps
}
