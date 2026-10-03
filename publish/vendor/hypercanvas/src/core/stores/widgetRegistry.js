/**
 * Widget Registry — consumer-supplied custom widget types.
 *
 * Consumers register widgets through `mountStoryboardCore({ widgets })`:
 *
 *   mountStoryboardCore(config, {
 *     widgets: {
 *       'my-thing': {
 *         component: MyThing,
 *         label: 'My Thing',
 *         icon: 'sparkle',
 *         chrome: { enabled: true },                  // optional, default true
 *         interaction: {
 *           selectable: true,                          // default true
 *           movable: true,                             // default true
 *           resize: { enabled: true, prod: false },    // default disabled
 *           expandable: false,
 *           splitScreen: false,
 *           interactGate: false,
 *           interactGateLabel: 'Click to interact',
 *         },
 *         connectors: { anchors: {...}, accept: ['*'], exclude: [] },
 *         features: [ ... ],                          // toolbar actions
 *         unlisted: false,                            // hide from "+ Add widget"
 *         props: { width: { type: 'number', default: 400 }, ... },
 *       },
 *     },
 *   })
 *
 * Definitions registered through this store are merged with — and override —
 * the built-in widget configs from `widgets.config.json` on a per-type basis.
 *
 * Built-in core widgets (sticky-note, markdown, image, etc.) ALSO live in
 * this registry once `seedCoreWidgets()` runs at module load. Consumer
 * overrides for those types replace the core entry entirely; if a consumer
 * wants to extend a core widget they should re-declare the merged definition.
 *
 * Framework-agnostic (zero npm dependencies). React typing is structural —
 * the `component` field is opaque from this store's perspective.
 *
 * @typedef {object} WidgetChromeOptions
 * @property {boolean} [enabled]  Render component inside WidgetChrome. Default: true.
 *                                When false, the widget renders raw with no toolbar,
 *                                no anchor ports, no select handle, no interact gate.
 *                                Consumer owns 100% of the visible UI.
 *
 * @typedef {object} WidgetInteractionOptions
 * @property {boolean} [selectable]   Default: true. False → no select handle, single-click
 *                                    does not select.
 * @property {boolean} [movable]      Default: true. False → drag surface class is omitted,
 *                                    widget cannot be dragged.
 * @property {{ enabled: boolean, prod?: boolean }} [resize]
 *                                    Default: disabled. Same shape as widgets.config.json.
 * @property {boolean} [expandable]   Default: false. Adds the "Expand" action.
 * @property {boolean} [splitScreen]  Default: false. Eligible as a split-screen pane.
 * @property {boolean} [interactGate] Default: false. Overlays "Click to interact" until clicked.
 * @property {string}  [interactGateLabel] Default: 'Click to interact'.
 *
 * @typedef {object} WidgetDefinition
 * @property {*}        [component]    React component or render function.
 *                                     Required for consumer widgets; not stored for
 *                                     core widgets when they fall back to widgets.config.json.
 * @property {string}   [label]        Display label for menus and selectors.
 * @property {string}   [icon]         Icon key from ICON_REGISTRY.
 * @property {WidgetChromeOptions}      [chrome]
 * @property {WidgetInteractionOptions} [interaction]
 * @property {object}   [connectors]   { anchors, accept, exclude, defaults }.
 * @property {Array<object>} [features] Toolbar feature list.
 * @property {boolean}  [unlisted]     Hide from "+ Add widget" menu.
 * @property {Record<string, object>} [props] Prop schema.
 *
 * The following back-compat fields are still read (mirrors widgets.config.json
 * legacy shape so an unchanged JSON entry continues to work after migration):
 * @property {{ enabled: boolean, prod?: boolean }} [resize]
 * @property {boolean} [expandable]
 * @property {boolean} [splitScreen]
 * @property {boolean} [interactGate]
 * @property {string}  [interactGateLabel]
 */

/** @type {Map<string, WidgetDefinition>} */
let _registry = new Map()

/** @type {Set<Function>} */
const _listeners = new Set()

let _snapshotVersion = 0

/**
 * Replace the entire registry from a consumer-supplied map.
 * Pass null/undefined to clear.
 * @param {Record<string, WidgetDefinition>|null|undefined} map
 */
export function initWidgetRegistry(map) {
  _registry = new Map()
  if (map && typeof map === 'object') {
    for (const [type, def] of Object.entries(map)) {
      if (def && typeof def === 'object') {
        _registry.set(type, def)
      }
    }
  }
  _notify()
}

/**
 * Register a single widget type (consumer-side). Replaces any existing entry.
 * @param {string} type
 * @param {WidgetDefinition} definition
 */
export function registerWidget(type, definition) {
  if (!type || typeof type !== 'string') {
    throw new Error('[storyboard] registerWidget: type must be a non-empty string')
  }
  if (!definition || typeof definition !== 'object') {
    throw new Error(`[storyboard] registerWidget("${type}"): definition must be an object`)
  }
  _registry.set(type, definition)
  _notify()
}

/**
 * Remove a registry entry. Built-in widgets re-seeded via seedCoreWidgets()
 * are unaffected; only the consumer override is removed.
 * @param {string} type
 */
export function unregisterWidget(type) {
  if (_registry.delete(type)) _notify()
}

/**
 * Get the registered definition for a widget type, or null.
 * Consumers should prefer `getMergedWidgetDefinition()` which also folds in
 * the static widgets.config.json shape.
 * @param {string} type
 * @returns {WidgetDefinition|null}
 */
export function getWidgetDefinition(type) {
  return _registry.get(type) || null
}

/**
 * Snapshot of the entire registry as a plain object.
 * @returns {Record<string, WidgetDefinition>}
 */
export function getAllWidgetDefinitions() {
  return Object.fromEntries(_registry)
}

/**
 * Subscribe to registry changes. Returns unsubscribe fn.
 * Compatible with `useSyncExternalStore`.
 * @param {Function} callback
 * @returns {Function}
 */
export function subscribeToWidgetRegistry(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

/**
 * Snapshot version string for change detection.
 * Compatible with `useSyncExternalStore`.
 * @returns {string}
 */
export function getWidgetRegistrySnapshot() {
  return String(_snapshotVersion)
}

function _notify() {
  _snapshotVersion++
  for (const cb of _listeners) {
    try { cb() } catch (err) {
      console.error('[storyboard] Error in widgetRegistry subscriber:', err)
    }
  }
}

/** Reset all state. Only for tests. */
export function _resetWidgetRegistry() {
  _registry = new Map()
  _listeners.clear()
  _snapshotVersion = 0
}
