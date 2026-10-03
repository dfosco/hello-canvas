/**
 * Unified Config Store — single source of truth for all storyboard configuration.
 *
 * Replaces the scattered init/store pattern with one reactive config object.
 * Domain-specific stores (toolbarConfigStore, canvasConfig, etc.) become thin
 * wrappers that delegate here — zero consumer changes needed.
 *
 * Override priority (lowest → highest):
 *   core defaults → widgets → paste → toolbar → commandPalette → storyboard.config.json → prototype
 *
 * Framework-agnostic (zero npm dependencies).
 */

import { deepMerge } from '../data/loader.js'

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @type {object} Full merged config (set once at startup) */
let _baseConfig = {}

/** @type {Record<string, object>} Domain → prototype-level overrides */
let _prototypeOverrides = {}

/** @type {object} Final merged config (base + prototype overrides) */
let _mergedConfig = {}

/** @type {Set<Function>} */
const _listeners = new Set()

let _snapshotVersion = 0

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Seed the unified config with the pre-merged config object.
 * Called once at app startup (from the virtual module or mountStoryboardCore).
 *
 * @param {object} config - The unified config with all domains
 */
export function initConfig(config) {
  _baseConfig = config || {}
  _prototypeOverrides = {}
  _recompute()
}

// ---------------------------------------------------------------------------
// Domain access
// ---------------------------------------------------------------------------

/**
 * Get the full merged config or a specific domain slice.
 *
 * @param {string} [domain] - Optional domain key (e.g. 'toolbar', 'canvas')
 * @returns {object}
 */
export function getConfig(domain) {
  if (!domain) return _mergedConfig
  return _mergedConfig[domain] || {}
}

// ---------------------------------------------------------------------------
// Prototype overrides
// ---------------------------------------------------------------------------

/**
 * Set overrides for a specific domain from a prototype-local config file.
 * Called on route change when entering a prototype with local config.
 *
 * @param {string} domain - Config domain (e.g. 'toolbar', 'widgets')
 * @param {object} overrides - Prototype-level overrides to deep-merge
 */
export function setOverrides(domain, overrides) {
  if (!overrides) return
  _prototypeOverrides[domain] = overrides
  _recompute()
}

/**
 * Clear overrides for a specific domain.
 *
 * @param {string} domain
 */
export function clearOverrides(domain) {
  if (!_prototypeOverrides[domain]) return
  delete _prototypeOverrides[domain]
  _recompute()
}

/**
 * Clear all prototype overrides (e.g. when leaving a prototype).
 */
export function clearAllOverrides() {
  if (Object.keys(_prototypeOverrides).length === 0) return
  _prototypeOverrides = {}
  _recompute()
}

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

/**
 * Subscribe to config changes. Compatible with external stores.
 *
 * @param {Function} callback - Called with the full merged config
 * @returns {Function} Unsubscribe
 */
export function subscribeToConfig(callback) {
  _listeners.add(callback)
  callback(_mergedConfig)
  return () => _listeners.delete(callback)
}

/**
 * Snapshot version for useSyncExternalStore.
 *
 * @returns {string}
 */
export function getConfigSnapshot() {
  return String(_snapshotVersion)
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _recompute() {
  if (Object.keys(_prototypeOverrides).length === 0) {
    _mergedConfig = _baseConfig
  } else {
    const result = { ..._baseConfig }
    for (const [domain, overrides] of Object.entries(_prototypeOverrides)) {
      result[domain] = result[domain]
        ? deepMerge(result[domain], overrides)
        : overrides
    }
    _mergedConfig = result
  }
  _snapshotVersion++
  for (const cb of _listeners) {
    try { cb(_mergedConfig) } catch (err) {
      console.error('[storyboard] Error in config subscriber:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function _resetConfig() {
  _baseConfig = {}
  _prototypeOverrides = {}
  _mergedConfig = {}
  _listeners.clear()
  _snapshotVersion = 0
}
