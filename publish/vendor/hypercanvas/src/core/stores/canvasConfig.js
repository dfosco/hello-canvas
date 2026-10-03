/**
 * Canvas Config — project-level overrides for canvas behavior.
 *
 * Client repos use the "canvas" key in storyboard.config.json to customize
 * canvas paste rules and other canvas-level settings.
 *
 *   {
 *     "canvas": {
 *       "pasteRules": [
 *         { "pattern": "youtube\\.com/watch", "type": "link-preview", "props": { "url": "$url" } }
 *       ]
 *     }
 *   }
 *
 * Framework-agnostic (zero npm dependencies).
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _pasteRules = []
let _terminal = {}
let _agents = {}
let _zoom = { min: 10, max: 250, step: 10 }
let _production = { move: false, resize: false, editMarkdown: false, editSticky: false }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Initialize canvas config from storyboard.config.json's "canvas" key.
 * Called by mountStoryboardCore.
 *
 * @param {{ pasteRules?: object[], terminal?: object, agents?: object, zoom?: object, production?: object }} [config]
 */
export function initCanvasConfig(config = {}) {
  _pasteRules = Array.isArray(config.pasteRules) ? config.pasteRules : []
  _terminal = config.terminal && typeof config.terminal === 'object' ? config.terminal : {}
  _agents = config.agents && typeof config.agents === 'object' ? config.agents : {}
  _zoom = config.zoom && typeof config.zoom === 'object'
    ? { min: config.zoom.min ?? 10, max: config.zoom.max ?? 250, step: config.zoom.step ?? 10 }
    : { min: 10, max: 250, step: 10 }
  const prod = config.production && typeof config.production === 'object' ? config.production : {}
  _production = {
    move: prod.move === true,
    resize: prod.resize === true,
    editMarkdown: prod.editMarkdown === true,
    editSticky: prod.editSticky === true,
  }
}

/**
 * Get the configured paste rules (raw config objects).
 *
 * @returns {object[]}
 */
export function getPasteRules() {
  return _pasteRules
}

/**
 * Get terminal widget configuration.
 *
 * @returns {{ theme?: object, fontSize?: number, fontFamily?: string, prompt?: string }}
 */
export function getTerminalConfig() {
  return _terminal
}

/**
 * Get agent configurations.
 *
 * @returns {object}
 */
export function getAgentsConfig() {
  return _agents
}

/**
 * Get canvas zoom configuration (min, max, step).
 *
 * @returns {{ min: number, max: number, step: number }}
 */
export function getCanvasZoom() {
  return _zoom
}

/**
 * Get the canvas production-affordance flags. Each flag opts into a
 * normally dev-only interaction in production builds (and `?prodMode`
 * simulation). Defaults are all `false`.
 *
 * @returns {{ move: boolean, resize: boolean, editMarkdown: boolean, editSticky: boolean }}
 */
export function getCanvasProduction() {
  return _production
}

/**
 * Check whether a specific canvas-production affordance is enabled.
 *
 * @param {'move'|'resize'|'editMarkdown'|'editSticky'} feature
 * @returns {boolean}
 */
export function isCanvasProductionEnabled(feature) {
  return _production[feature] === true
}

/**
 * Check if a terminal/agent widget should be resizable based on config.
 * Agent-level `resizable` overrides the base `terminal.resizable`.
 *
 * @param {string|null} [agentId] — agent ID to check for overrides
 * @returns {boolean}
 */
export function isTerminalResizable(agentId = null) {
  if (agentId) {
    const agentCfg = _agents[agentId]
    if (agentCfg && agentCfg.resizable !== undefined) return agentCfg.resizable
  }
  return _terminal.resizable ?? false
}

/**
 * Get effective default dimensions for a terminal/agent widget.
 * Cascade: agent config > terminal config > provided fallbacks.
 *
 * @param {string|null} [agentId] — agent ID to check for overrides
 * @param {{ width: number, height: number }} [fallback] — schema-level fallbacks
 * @returns {{ width: number, height: number }}
 */
export function getTerminalDimensions(agentId = null, fallback = { width: 800, height: 450 }) {
  const base = {
    width: _terminal.defaultWidth ?? fallback.width,
    height: _terminal.defaultHeight ?? fallback.height,
  }
  if (agentId) {
    const agentCfg = _agents[agentId]
    if (agentCfg) {
      return {
        width: agentCfg.defaultWidth ?? base.width,
        height: agentCfg.defaultHeight ?? base.height,
      }
    }
  }
  return base
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all internal state. Only for use in tests.
 */
export function _resetCanvasConfig() {
  _pasteRules = []
  _terminal = {}
  _agents = {}
  _zoom = { min: 10, max: 250, step: 10 }
  _production = { move: false, resize: false, editMarkdown: false, editSticky: false }
}
