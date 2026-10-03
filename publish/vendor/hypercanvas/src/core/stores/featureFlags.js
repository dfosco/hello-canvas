/**
 * Feature flag system for Storyboard.
 *
 * Flags are defined in storyboard.config.json under "featureFlags" and
 * initialized at app startup via the Vite data plugin.
 *
 * Read priority:  localStorage → config defaults
 * Write target:   localStorage (persistent per-browser)
 *
 * All flag keys in localStorage are prefixed with "flag." to avoid
 * collisions with scene overrides.
 */

import { getLocal, setLocal, removeLocal, getAllLocal } from '../session/localStorage.js'

const FLAG_PREFIX = 'flag.'
const BODY_CLASS_PREFIX = 'sb-ff-'
// These policies are persisted through Settings and resolved by Core at startup.
// They cannot participate in browser-local overrides or live runtime toggles.
const STARTUP_ONLY_FLAGS = new Set(['usePaseoApp'])

/** Built-in flags — live desktop source mode defaults all reload policies on. */
const LIVE_SOURCE_DEFAULT = import.meta.env?.VITE_HYPERCANVAS_LIVE_SOURCE === '1'

const BUILTIN_DEFAULTS = {
  'canvas-auto-reload': LIVE_SOURCE_DEFAULT,
  'configuration-auto-reload': LIVE_SOURCE_DEFAULT,
  'prototype-auto-reload': LIVE_SOURCE_DEFAULT,
  'agents-ready': false,
  'notebook-folder-drop': false,
  // Experimental canvas widgets — hidden from creation surfaces until enabled.
  'prompt-widget': false,
  'agent-chat-widget': false,
}

/** Module-level storage for config defaults */
let _defaults = {}

/**
 * Sync body classes for active feature flags.
 * Adds `sb-ff-{name}` for every flag that resolves to true,
 * removes it for every flag that resolves to false.
 */
export function syncFlagBodyClasses() {
  if (typeof document === 'undefined') return
  for (const key of Object.keys(_defaults)) {
    const cls = BODY_CLASS_PREFIX + key
    if (getFlag(key)) {
      document.body.classList.add(cls)
    } else {
      document.body.classList.remove(cls)
    }
  }
}

/**
 * Initialize the feature flag system with config defaults.
 * Only writes a default to localStorage when no user override exists yet,
 * so toggled values survive across reloads.
 * @param {Record<string, boolean>} defaults - Flag key → default value
 */
export function initFeatureFlags(defaults = {}) {
  _defaults = Object.fromEntries(Object.entries({ ...BUILTIN_DEFAULTS, ...defaults })
    .filter(([key]) => !STARTUP_ONLY_FLAGS.has(key)))
  for (const key of STARTUP_ONLY_FLAGS) {
    if (getLocal(FLAG_PREFIX + key) !== null) removeLocal(FLAG_PREFIX + key)
  }
  for (const [key, value] of Object.entries(_defaults)) {
    if (getLocal(FLAG_PREFIX + key) === null) {
      setLocal(FLAG_PREFIX + key, String(value))
    }
  }
  syncFlagBodyClasses()
}

/**
 * Read a flag value. Priority: localStorage → config default.
 * @param {string} key - Flag key (without prefix)
 * @returns {boolean}
 */
export function getFlag(key) {
  if (STARTUP_ONLY_FLAGS.has(key)) return false
  const localVal = getLocal(FLAG_PREFIX + key)
  if (localVal !== null) return localVal === 'true'

  return _defaults[key] ?? BUILTIN_DEFAULTS[key] ?? false
}

/**
 * Set a flag value. Writes to localStorage for persistence.
 * @param {string} key - Flag key (without prefix)
 * @param {boolean} value
 */
export function setFlag(key, value) {
  if (STARTUP_ONLY_FLAGS.has(key)) return
  setLocal(FLAG_PREFIX + key, String(value))
  syncFlagBodyClasses()
}

/**
 * Toggle a flag. Reads current value, writes opposite to localStorage.
 * @param {string} key - Flag key (without prefix)
 */
export function toggleFlag(key) {
  setFlag(key, !getFlag(key))
}

/**
 * Get all flags with their default and current (resolved) values.
 * @returns {Record<string, { default: boolean, current: boolean }>}
 */
export function getAllFlags() {
  const allKeys = new Set([...Object.keys(BUILTIN_DEFAULTS), ...Object.keys(_defaults)])
  const result = {}
  for (const key of allKeys) {
    result[key] = {
      default: _defaults[key] ?? BUILTIN_DEFAULTS[key] ?? false,
      current: getFlag(key),
    }
  }
  return result
}

/**
 * Reset all flags — removes localStorage overrides.
 * Flags revert to config defaults.
 */
export function resetFlags() {
  const allLocal = getAllLocal()
  for (const localKey of Object.keys(allLocal)) {
    if (localKey.startsWith(FLAG_PREFIX)) {
      removeLocal(localKey)
    }
  }
  syncFlagBodyClasses()
}

/**
 * Get all registered flag keys.
 * @returns {string[]}
 */
export function getFlagKeys() {
  return [...new Set([...Object.keys(BUILTIN_DEFAULTS), ...Object.keys(_defaults)])]
}
