/**
 * Tool Registry — config-driven state management for toolbar tools.
 *
 * Every tool is declared in toolbar.config.json under the `tools` key.
 * Each tool specifies a `toolbar` target (command-toolbar, canvas-toolbar,
 * command-palette) and a `render` type (button, menu, sidepanel, submenu, link).
 *
 * Code modules register themselves via registerToolModule() to provide
 * component, handler, setup, and guard functions.
 *
 * Framework-agnostic (zero npm dependencies).
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @type {Record<string, object>} tool id → config from toolbar.config.json */
let _toolConfigs = {}

/** @type {Map<string, object>} tool id → code module { component?, handler?, setup?, guard? } */
const _modules = new Map()

/** @type {Map<string, any>} tool id → resolved component (after lazy loading) */
const _components = new Map()

/** @type {Map<string, boolean>} tool id → guard result */
const _guardResults = new Map()

/** @type {Set<Function>} */
const _listeners = new Set()

let _snapshotVersion = 0

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Seed the registry from toolbar config.
 * Called once at app startup.
 *
 * @param {object} config - The full toolbar config object
 */
export function initToolRegistry(config) {
  if (config.tools) {
    _toolConfigs = { ...config.tools }
  }
  _notify()
}

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------

/**
 * Register a code module for a declared tool.
 *
 * @param {string} id - Tool id (matches key in toolbar.config.json tools)
 * @param {object} mod
 * @param {Function} [mod.component] - () => import('../SomeComponent.jsx')
 * @param {object|Function} [mod.handler] - Command action handler
 * @param {Function} [mod.setup] - async (ctx) => void — called once at mount
 * @param {Function} [mod.guard] - async (ctx) => boolean — return false to hide
 */
export function registerToolModule(id, mod) {
  _modules.set(id, mod)
  _notify()
}

/**
 * Store a resolved component for a tool (after lazy loading).
 *
 * @param {string} id
 * @param {any} component
 */
export function setToolComponent(id, component) {
  _components.set(id, component)
  _notify()
}

/**
 * Store a guard result for a tool.
 *
 * @param {string} id
 * @param {boolean} result
 */
export function setToolGuardResult(id, result) {
  _guardResults.set(id, result)
  _notify()
}

/**
 * Get the resolved component for a tool.
 *
 * @param {string} id
 * @returns {any|null}
 */
export function getToolComponent(id) {
  return _components.get(id) || null
}

/**
 * Get the code module for a tool.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getToolModule(id) {
  return _modules.get(id) || null
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Get tools for a specific toolbar target, filtered by mode and visibility.
 *
 * @param {string} toolbar - "command-toolbar" | "canvas-toolbar" | "command-palette"
 * @param {string} mode - Current mode name
 * @param {object} [options]
 * @param {boolean} [options.isLocalDev] - Whether running in local dev
 * @returns {Array<{ id: string, config: object, module: object|null, component: any|null }>}
 */
export function getToolsForToolbar(toolbar, mode, options = {}) {
  const { isLocalDev = false } = options
  const results = []

  for (const [id, config] of Object.entries(_toolConfigs)) {
    if (config.disabled) continue
    if (config.toolbar !== toolbar) continue
    if (!config.prod && !isLocalDev) continue
    if (!isToolVisibleInMode(config, mode)) continue

    // Check guard result if one was registered
    if (_guardResults.has(id) && !_guardResults.get(id)) continue

    results.push({
      id,
      config,
      module: _modules.get(id) || null,
      component: _components.get(id) || null,
    })
  }

  return results
}

/**
 * Get the config for a specific tool.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getToolConfig(id) {
  return _toolConfigs[id] || null
}

/**
 * Get all tool configs.
 *
 * @returns {Record<string, object>}
 */
export function getAllToolConfigs() {
  return { ..._toolConfigs }
}

/**
 * Check if a tool is visible in a given mode.
 *
 * @param {object} config - Tool config
 * @param {string} mode - Current mode name
 * @returns {boolean}
 */
function isToolVisibleInMode(config, mode) {
  const modes = config.modes
  if (!modes) return true
  return modes.includes('*') || modes.includes(mode)
}

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

/**
 * Subscribe to registry changes. Compatible with useSyncExternalStore.
 *
 * @param {Function} callback
 * @returns {Function} Unsubscribe
 */
export function subscribeToToolRegistry(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

/**
 * Snapshot for useSyncExternalStore.
 *
 * @returns {string}
 */
export function getToolRegistrySnapshot() {
  return String(_snapshotVersion)
}

function _notify() {
  _snapshotVersion++
  for (const cb of _listeners) {
    try { cb() } catch (err) {
      console.error('[storyboard] Error in tool registry subscriber:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all state. Only for tests. */
export function _resetToolRegistry() {
  _toolConfigs = {}
  _modules.clear()
  _components.clear()
  _guardResults.clear()
  _listeners.clear()
  _snapshotVersion = 0
}
