/**
 * Body class sync for overrides and scenes.
 *
 * Mirrors active overrides as `sb-{key}--{value}` classes on <body>
 * and the active scene as `sb-scene--{name}`.
 *
 * Works in both normal mode (URL hash) and hide mode (localStorage shadows).
 */

import { getAllParams } from './session.js'
import { isHideMode, getAllShadows } from './hideMode.js'
import { subscribeToHash } from './hashSubscribe.js'
import { subscribeToStorage } from './localStorage.js'
import { syncFlagBodyClasses } from '../stores/featureFlags.js'

const PREFIX = 'sb-'
const FLOW_PREFIX = 'sb-scene--'

/**
 * Sanitize a string for use in a CSS class name.
 * Dots and spaces become dashes, lowercased, non-alphanumeric stripped.
 * @param {string} str
 * @returns {string}
 */
function sanitize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[.\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Build the class name for an override key/value pair.
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function overrideClass(key, value) {
  return `${PREFIX}${sanitize(key)}--${sanitize(value)}`
}

/**
 * Get all current sb- override classes on body.
 * Override classes follow the pattern `sb-{key}--{value}` (double-dash separator).
 * Other sb-* classes (comment mode, feature flags, etc.) are excluded
 * because they don't contain the `--` separator.
 * Flow/scene classes (`sb-scene--*`) are also excluded since they use
 * the same `--` separator but have their own lifecycle.
 * @returns {Set<string>}
 */
function getCurrentOverrideClasses() {
  const classes = new Set()
  for (const cls of document.body.classList) {
    if (cls.startsWith(PREFIX) && cls.includes('--') && !cls.startsWith(FLOW_PREFIX)) {
      classes.add(cls)
    }
  }
  return classes
}

/**
 * Sync override classes on <body> with current hash/shadow state.
 * Diffs against existing classes to minimize DOM mutations.
 */
export function syncOverrideClasses() {
  const overrides = isHideMode() ? getAllShadows() : getAllParams()
  const desired = new Set()
  for (const [key, value] of Object.entries(overrides)) {
    if (key && value != null && value !== '') {
      desired.add(overrideClass(key, value))
    }
  }

  const current = getCurrentOverrideClasses()

  // Remove stale classes
  for (const cls of current) {
    if (!desired.has(cls)) {
      document.body.classList.remove(cls)
    }
  }
  // Add missing classes
  for (const cls of desired) {
    if (!current.has(cls)) {
      document.body.classList.add(cls)
    }
  }
}

/**
 * Set the flow class on <body>. Removes any previous flow class.
 * @param {string} name - Flow name (e.g. "Dashboard")
 */
export function setFlowClass(name) {
  // Remove any existing flow classes
  for (const cls of [...document.body.classList]) {
    if (cls.startsWith(FLOW_PREFIX)) {
      document.body.classList.remove(cls)
    }
  }
  if (name) {
    document.body.classList.add(`${FLOW_PREFIX}${sanitize(name)}`)
  }
}

/** @deprecated Use setFlowClass() */
export const setSceneClass = setFlowClass

/**
 * Install listeners that keep body classes in sync with overrides.
 * Subscribes to both hashchange (normal mode) and storage (hide mode).
 * Runs an initial sync immediately.
 *
 * @returns {function} unsubscribe — removes all listeners
 */
export function installBodyClassSync() {
  syncOverrideClasses()
  syncFlagBodyClasses()
  const sync = () => { syncOverrideClasses(); syncFlagBodyClasses() }
  const unsubHash = subscribeToHash(sync)
  const unsubStorage = subscribeToStorage(sync)
  return () => {
    unsubHash()
    unsubStorage()
  }
}
