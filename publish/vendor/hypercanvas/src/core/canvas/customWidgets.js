/**
 * Server-side Custom Widget Registry
 *
 * Consumer widget metadata loaded from `storyboard.config.json.widgets` at
 * dev-server startup. Server-side modules (collision detection, widget
 * placement, prop validation) consult this registry to resolve widget
 * metadata for consumer-registered widget types.
 *
 * Mirrors the browser-side `core/stores/widgetRegistry.js` but holds only
 * the JSON-serializable subset — no React components (those live in the
 * browser only). The `definition` shape is otherwise identical:
 *
 *   {
 *     label, icon,
 *     chrome: { enabled },
 *     interaction: { selectable, movable, resize, expandable, splitScreen, interactGate, interactGateLabel },
 *     connectors: { anchors, accept, exclude, defaults },
 *     features: [...],
 *     unlisted,
 *     props: { width: { type, default, ... }, ... }
 *   }
 *
 * Consumer entries OVERRIDE the built-in `widgets.config.json` entry of the
 * same type. The merge is whole-entry replacement (consumer wins) to match
 * the browser-side behavior — consumers that want to extend a core widget
 * must re-declare the merged definition.
 */

import widgetsConfig from '../../../widgets.config.json' with { type: 'json' }

/** @type {Map<string, object>} */
const _registry = new Map()

/**
 * Replace the entire registry from a consumer-supplied map.
 * @param {Record<string, object>|null|undefined} map
 */
export function initServerWidgets(map) {
  _registry.clear()
  if (map && typeof map === 'object') {
    for (const [type, def] of Object.entries(map)) {
      if (def && typeof def === 'object') {
        _registry.set(type, def)
      }
    }
  }
}

/**
 * Register a single widget type. Replaces any existing entry.
 * @param {string} type
 * @param {object} definition
 */
export function registerServerWidget(type, definition) {
  if (!type || typeof type !== 'string') {
    throw new Error('[storyboard] registerServerWidget: type must be a non-empty string')
  }
  if (!definition || typeof definition !== 'object') {
    throw new Error(`[storyboard] registerServerWidget("${type}"): definition must be an object`)
  }
  _registry.set(type, definition)
}

/**
 * Resolve the effective server-side widget definition for a type.
 * Returns the consumer entry if present, otherwise the built-in entry from
 * `widgets.config.json`, otherwise null.
 * @param {string} type
 * @returns {object|null}
 */
export function getServerWidgetDefinition(type) {
  if (_registry.has(type)) return _registry.get(type)
  return widgetsConfig.widgets?.[type] || null
}

/**
 * Snapshot all definitions (consumer + built-in) keyed by type.
 * Consumer entries override built-ins.
 * @returns {Record<string, object>}
 */
export function getAllServerWidgetDefinitions() {
  const merged = { ...(widgetsConfig.widgets || {}) }
  for (const [type, def] of _registry) {
    merged[type] = def
  }
  return merged
}

/** Reset all state. Only for tests. */
export function _resetServerWidgets() {
  _registry.clear()
}
