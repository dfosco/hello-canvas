/**
 * Design Modes — mode registry, switching, and cross-plugin event bus.
 *
 * Framework-agnostic (zero npm dependencies).
 * State is stored in the ?mode= URL search param so it's shareable and bookmarkable.
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _modes = new Map()
const _listeners = new Set()
const _eventListeners = new Map()

const DEFAULT_MODE = 'prototype'

let _modesEnabled = false
let _lockedMode = null

// Tool registry — seeded from modes.config.json, state managed at runtime
const _tools = new Map()          // id → { id, label, group, modes[] }
const _toolState = new Map()      // id → { enabled, active, busy, hidden, badge }
const _toolActions = new Map()    // id → action function
const _toolListeners = new Set()  // subscribers to tool state/action changes

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Register a mode plugin.
 *
 * @param {string} name   Unique mode identifier (e.g. 'prototype', 'present')
 * @param {object} config Mode configuration
 * @param {string} config.label  Human-readable label for UI
 * @param {string} [config.icon] Icon name (Octicon, Feather, or custom)
 * @param {string|string[]} [config.className] Extra class(es) applied to <html> when active
 * @param {Function} [config.onActivate]   Called when mode becomes active
 * @param {Function} [config.onDeactivate] Called when leaving this mode
 * @param {Array}  [config.tools]    Tool definitions for the tools toolbar
 * @param {Array}  [config.devTools] Tool definitions for the dev toolbar
 */
export function registerMode(name, config = {}) {
  if (_modes.has(name)) {
    console.warn(`[storyboard] Mode "${name}" is already registered — overwriting.`)
  }
  _modes.set(name, { name, label: config.label ?? name, ...config })
  _notify()
}

/**
 * Remove a previously registered mode.
 */
export function unregisterMode(name) {
  if (name === DEFAULT_MODE) {
    console.warn(`[storyboard] Cannot unregister the default mode "${DEFAULT_MODE}".`)
    return
  }
  const mode = _modes.get(name)
  if (!mode) return
  // If this mode is currently active, deactivate first
  if (getCurrentMode() === name) {
    deactivateMode()
  }
  _modes.delete(name)
  _notify()
}

/**
 * Get all registered modes in insertion order.
 *
 * @returns {Array<{ name: string, label: string, icon?: string }>}
 */
export function getRegisteredModes() {
  return Array.from(_modes.values())
}

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

/**
 * Read the active mode from the ?mode= URL search param.
 * Falls back to DEFAULT_MODE when the param is absent or unrecognised.
 */
export function getCurrentMode() {
  if (_lockedMode && _modes.has(_lockedMode)) return _lockedMode
  if (typeof window === 'undefined') return DEFAULT_MODE
  const url = new URL(window.location.href)
  const param = url.searchParams.get('mode')
  if (param && _modes.has(param)) return param
  return DEFAULT_MODE
}

/**
 * Switch to a registered mode.
 * Calls onDeactivate on the previous mode and onActivate on the new one.
 *
 * @param {string} name    Mode to activate
 * @param {object} [options] Passed through to onActivate
 */
export function activateMode(name, options) {
  if (_lockedMode) {
    console.warn(`[storyboard] Modes are locked to "${_lockedMode}" — ignoring switch to "${name}".`)
    return
  }
  if (!_modes.has(name)) {
    console.warn(`[storyboard] Mode "${name}" is not registered.`)
    return
  }

  const prev = getCurrentMode()
  if (prev === name) return

  // Deactivate previous
  const prevMode = _modes.get(prev)
  _removeModeClasses(prevMode)
  if (prevMode?.onDeactivate) prevMode.onDeactivate()
  emit('mode:deactivate', prev)

  // Update URL param
  const url = new URL(window.location.href)
  if (name === DEFAULT_MODE) {
    url.searchParams.delete('mode')
  } else {
    url.searchParams.set('mode', name)
  }
  window.history.replaceState(null, '', url.toString())

  // Activate new
  const newMode = _modes.get(name)
  _applyModeClasses(newMode)
  if (newMode?.onActivate) newMode.onActivate(options)
  emit('mode:activate', name, options)
  emit('mode:change', prev, name)

  _notify()
}

/**
 * Return to the default mode.
 */
export function deactivateMode() {
  activateMode(DEFAULT_MODE)
}

// ---------------------------------------------------------------------------
// Reactivity (for useSyncExternalStore)
// ---------------------------------------------------------------------------

/**
 * Subscribe to mode changes. Compatible with React's useSyncExternalStore.
 *
 * @param {Function} callback Called whenever the mode or registry changes
 * @returns {Function} Unsubscribe function
 */
export function subscribeToMode(callback) {
  _listeners.add(callback)
  // Also listen to popstate so browser back/forward syncs mode
  const onPopState = () => {
    _notify()
  }
  window.addEventListener('popstate', onPopState)
  return () => {
    _listeners.delete(callback)
    window.removeEventListener('popstate', onPopState)
  }
}

/**
 * Snapshot for useSyncExternalStore.
 * Returns a serialised string that changes when mode or registry changes.
 */
export function getModeSnapshot() {
  const mode = getCurrentMode()
  const names = Array.from(_modes.keys()).join(',')
  return `${mode}|${names}`
}

// ---------------------------------------------------------------------------
// Event bus (cross-plugin communication)
// ---------------------------------------------------------------------------

/**
 * Listen for an event.
 *
 * @param {string} event   Event name (e.g. 'mode:change', 'room:create')
 * @param {Function} callback
 */
export function on(event, callback) {
  if (!_eventListeners.has(event)) {
    _eventListeners.set(event, new Set())
  }
  _eventListeners.get(event).add(callback)
}

/**
 * Remove an event listener.
 */
export function off(event, callback) {
  const listeners = _eventListeners.get(event)
  if (listeners) listeners.delete(callback)
}

/**
 * Emit an event to all registered listeners.
 *
 * @param {string} event Event name
 * @param {...*} args     Arguments forwarded to listeners
 */
export function emit(event, ...args) {
  const listeners = _eventListeners.get(event)
  if (!listeners) return
  for (const cb of listeners) {
    try {
      cb(...args)
    } catch (err) {
      console.error(`[storyboard] Error in "${event}" listener:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect all classes for a mode: the automatic `storyboard-mode-{name}`
 * plus any custom `className` string(s) from the mode config.
 */
function _getModeClasses(mode) {
  if (!mode) return []
  const classes = [`storyboard-mode-${mode.name}`]
  if (mode.className) {
    const extra = Array.isArray(mode.className) ? mode.className : mode.className.split(/\s+/)
    classes.push(...extra.filter(Boolean))
  }
  return classes
}

function _applyModeClasses(mode) {
  if (typeof document === 'undefined') return
  const classes = _getModeClasses(mode)
  if (classes.length) document.documentElement.classList.add(...classes)
}

function _removeModeClasses(mode) {
  if (typeof document === 'undefined') return
  const classes = _getModeClasses(mode)
  if (classes.length) document.documentElement.classList.remove(...classes)
}

/**
 * Apply classes for the current mode on first load.
 * Called automatically so the initial mode is reflected in the DOM.
 */
export function syncModeClasses() {
  const name = getCurrentMode()
  const mode = _modes.get(name)
  if (mode) _applyModeClasses(mode)
}

function _notify() {
  for (const cb of _listeners) {
    try {
      cb()
    } catch (err) {
      console.error('[storyboard] Error in mode subscriber:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Initialize modes configuration.
 * Called by the Vite data plugin's generated virtual module.
 * @param {{ enabled?: boolean, locked?: string }} [config]
 */
export function initModesConfig(config = {}) {
  _modesEnabled = config.enabled !== false
  _lockedMode = typeof config.locked === 'string' ? config.locked : null
}

/**
 * Check whether modes UI is enabled.
 * When false, the app stays in prototype mode with no mode switcher.
 * @returns {boolean}
 */
export function isModesEnabled() {
  return _modesEnabled
}

/**
 * Get the locked mode name, or null if modes are not locked.
 * When locked, the mode switcher is hidden and activateMode() is a no-op.
 * @returns {string|null}
 */
export function getLockedMode() {
  return _lockedMode
}

/**
 * Check whether the mode switcher UI should be visible.
 * Returns false when modes are disabled or locked to a specific mode.
 * @returns {boolean}
 */
export function isModeSwitcherVisible() {
  return _modesEnabled && !_lockedMode
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_STATE = Object.freeze({
  enabled: true,
  active: false,
  busy: false,
  hidden: false,
  badge: null,
})

/**
 * Seed the tool registry from modes.config.json.
 * Called by the Vite data plugin's generated virtual module.
 *
 * @param {Record<string, Array<{ id: string, label: string, group: string }>>} config
 *        Keys are mode names or '*' (all modes). Values are tool declarations.
 */
export function initTools(config = {}) {
  for (const [modeKey, tools] of Object.entries(config)) {
    if (!Array.isArray(tools)) continue
    for (const tool of tools) {
      if (!tool.id) continue
      const existing = _tools.get(tool.id)
      if (existing) {
        // Merge mode assignments (tool declared in multiple mode keys)
        if (!existing.modes.includes(modeKey)) {
          existing.modes.push(modeKey)
        }
      } else {
        _tools.set(tool.id, {
          id: tool.id,
          label: tool.label ?? tool.id,
          group: tool.group ?? 'tools',
          icon: tool.icon ?? null,
          order: tool.order ?? 100,
          modes: [modeKey],
        })
        _toolState.set(tool.id, { ...DEFAULT_TOOL_STATE })
      }
    }
  }
  _notifyTools()
}

/**
 * Wire up a click handler for a declared tool.
 * Plugins call this to provide the action callback.
 *
 * @param {string} id       Tool id (must exist in registry)
 * @param {Function} action Click handler
 */
export function setToolAction(id, action) {
  if (!_tools.has(id)) {
    console.warn(`[storyboard] Tool "${id}" is not declared in modes.config.json.`)
    return
  }
  _toolActions.set(id, action)
  _notifyTools()
}

/**
 * Update the runtime state of a tool.
 * Merges the update into existing state — only the provided keys change.
 *
 * @param {string} id    Tool id (must exist in registry)
 * @param {object} state Partial state update
 * @param {boolean} [state.enabled]  Whether the tool can be interacted with
 * @param {boolean} [state.active]   Whether the tool is currently "on" (highlighted)
 * @param {boolean} [state.busy]     Whether the tool is in use / unavailable
 * @param {boolean} [state.hidden]   Whether the tool should be hidden entirely
 * @param {string|number|null} [state.badge] Notification badge
 */
export function setToolState(id, state = {}) {
  if (!_tools.has(id)) {
    console.warn(`[storyboard] Tool "${id}" is not declared in modes.config.json.`)
    return
  }
  const current = _toolState.get(id) ?? { ...DEFAULT_TOOL_STATE }
  _toolState.set(id, { ...current, ...state })
  _notifyTools()
}

/**
 * Get the current runtime state of a tool.
 *
 * @param {string} id Tool id
 * @returns {{ enabled: boolean, active: boolean, busy: boolean, hidden: boolean, badge: string|number|null } | null}
 */
export function getToolState(id) {
  return _toolState.get(id) ?? null
}

/**
 * Get all tools for a given mode, merged with '*' wildcard tools.
 * Returns tool declarations with their current state and action.
 * Sorted by group (tools first, dev second), then by order.
 *
 * @param {string} modeName
 * @returns {Array<{ id, label, group, icon, order, modes, state, action }>}
 */
export function getToolsForMode(modeName) {
  const result = []
  for (const [id, tool] of _tools) {
    if (!tool.modes.includes(modeName) && !tool.modes.includes('*')) continue
    const state = _toolState.get(id) ?? { ...DEFAULT_TOOL_STATE }
    if (state.hidden) continue
    result.push({
      ...tool,
      state,
      action: _toolActions.get(id) ?? null,
    })
  }
  // Sort: 'tools' group before 'dev', then by order
  const groupOrder = { tools: 0, dev: 1 }
  result.sort((a, b) => {
    const ga = groupOrder[a.group] ?? 0
    const gb = groupOrder[b.group] ?? 0
    if (ga !== gb) return ga - gb
    return (a.order ?? 100) - (b.order ?? 100)
  })
  return result
}

/**
 * Subscribe to tool state/action changes.
 * Compatible with React's useSyncExternalStore.
 *
 * @param {Function} callback Called on any tool change
 * @returns {Function} Unsubscribe function
 */
export function subscribeToTools(callback) {
  _toolListeners.add(callback)
  return () => _toolListeners.delete(callback)
}

/**
 * Snapshot for useSyncExternalStore.
 * Returns a serialised string that changes when tool state/actions change.
 */
export function getToolsSnapshot() {
  const entries = []
  for (const [id, state] of _toolState) {
    const hasAction = _toolActions.has(id) ? '1' : '0'
    entries.push(`${id}:${state.enabled}:${state.active}:${state.busy}:${state.hidden}:${state.badge}:${hasAction}`)
  }
  return entries.join('|')
}

function _notifyTools() {
  for (const cb of _toolListeners) {
    try {
      cb()
    } catch (err) {
      console.error('[storyboard] Error in tool subscriber:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all internal state. Only for use in tests.
 */
export function _resetModes() {
  _modes.clear()
  _listeners.clear()
  _eventListeners.clear()
  _tools.clear()
  _toolState.clear()
  _toolActions.clear()
  _toolListeners.clear()
  _modesEnabled = false
  _lockedMode = null
}
