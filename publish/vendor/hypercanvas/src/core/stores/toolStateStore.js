/**
 * Tool State Store — runtime state management for toolbar tools.
 *
 * Each tool declared in toolbar.config.json can be in one of five states:
 *   active    — Normal, clickable (default)
 *   inactive  — Visible but unclickable, disabled-looking (also for errors)
 *   hidden    — Invisible but shortcuts still work, tool is loaded
 *   dimmed    — Visible but dimmed opacity, still clickable
 *   disabled  — Completely removed, not loaded on FE
 *
 * Tools default to "active" unless:
 *   1. Config declares a "state" property
 *   2. The tool lacks `prod: true` and the environment is not local dev → "disabled"
 *
 * State can be changed at runtime by application code via setToolbarToolState().
 * Framework-agnostic (zero npm dependencies).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid tool states. */
export const TOOL_STATES = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  HIDDEN: 'hidden',
  DIMMED: 'dimmed',
  DISABLED: 'disabled',
})

const VALID_STATES = new Set(Object.values(TOOL_STATES))

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} tool id → state */
let _states = new Map()

/** @type {Map<string, boolean>} tool id → dev-only flag (true when tool lacks `prod`) */
let _devOnlyFlags = new Map()

/** @type {Set<Function>} */
const _listeners = new Set()

let _snapshotVersion = 0

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Seed tool states from toolbar.config.json's `tools` object.
 * Called once at app startup.
 *
 * @param {object} toolsConfig - The `tools` object from toolbar.config.json
 *   (keys are tool IDs, values are tool config objects)
 * @param {{ isLocalDev?: boolean }} [options]
 */
export function initToolbarToolStates(toolsConfig, options = {}) {
  const { isLocalDev = false } = options

  _states = new Map()
  _devOnlyFlags = new Map()

  if (!toolsConfig || typeof toolsConfig !== 'object') {
    _notify()
    return
  }

  for (const [id, tool] of Object.entries(toolsConfig)) {
    // A tool is dev-only if it lacks `prod: true` (or has legacy `localOnly: true`)
    const isDevOnly = !tool.prod || tool.localOnly === true
    _devOnlyFlags.set(id, isDevOnly)

    if (isDevOnly && !isLocalDev) {
      _states.set(id, TOOL_STATES.DISABLED)
    } else if (tool.disabled === true) {
      _states.set(id, TOOL_STATES.DISABLED)
    } else {
      const state = tool.state || TOOL_STATES.ACTIVE
      _states.set(id, state)
    }
  }

  _notify()
}

// ---------------------------------------------------------------------------
// Runtime state changes
// ---------------------------------------------------------------------------

/**
 * Set state for a tool at runtime.
 * Validates that the state is one of the 5 valid values.
 *
 * @param {string} id    Tool id
 * @param {string} state One of: active, inactive, hidden, dimmed, disabled
 */
export function setToolbarToolState(id, state) {
  if (!VALID_STATES.has(state)) {
    console.warn(`[storyboard] Invalid tool state "${state}" for tool "${id}". Valid states: ${[...VALID_STATES].join(', ')}`)
    return
  }
  _states.set(id, state)
  _notify()
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Get the current state for a tool.
 * Returns "active" for unknown tool IDs (safe default).
 *
 * @param {string} id Tool id
 * @returns {string}
 */
export function getToolbarToolState(id) {
  return _states.get(id) || TOOL_STATES.ACTIVE
}

/**
 * Returns whether the tool is dev-only (lacks `prod: true` in config).
 * Returns false for unknown IDs.
 *
 * @param {string} id Tool id
 * @returns {boolean}
 */
export function isToolbarToolLocalOnly(id) {
  return _devOnlyFlags.get(id) || false
}

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

/**
 * Subscribe to tool state changes. Compatible with useSyncExternalStore.
 *
 * @param {Function} callback
 * @returns {Function} Unsubscribe
 */
export function subscribeToToolbarToolStates(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

/**
 * Snapshot for useSyncExternalStore.
 *
 * @returns {string}
 */
export function getToolbarToolStatesSnapshot() {
  return String(_snapshotVersion)
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _notify() {
  _snapshotVersion++
  for (const cb of _listeners) {
    try { cb() } catch (err) {
      console.error('[storyboard] Error in tool state subscriber:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all state. Only for tests. */
export function _resetToolbarToolStates() {
  _states = new Map()
  _devOnlyFlags = new Map()
  _listeners.clear()
  _snapshotVersion = 0
}
