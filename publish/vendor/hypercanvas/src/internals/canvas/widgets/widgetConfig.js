/**
 * Widget Config Loader
 *
 * Resolves per-widget metadata (label, icon, prop schemas, features, chrome
 * options, interaction switches, connector rules) by merging the built-in
 * `widgets.config.json` baseline with consumer registrations from
 * `core/stores/widgetRegistry.js`.
 *
 * Resolution order, per widget type:
 *   1. Consumer override registered via `registerWidget()` /
 *      `mountStoryboardCore({ widgets })` — REPLACES the core entry entirely
 *      for this type. Consumers that want to extend a core widget must
 *      re-declare the full merged definition.
 *   2. Core entry from `widgets.config.json`.
 *
 * Supports `$variable` references in string values for core widgets only,
 * resolved from the top-level `variables` object in `widgets.config.json`.
 * (Consumer registrations are passed through verbatim.)
 */
import widgetsConfig from '../../../../widgets.config.json'
import {
  getWidgetDefinition,
  getAllWidgetDefinitions,
} from '../../../core/stores/widgetRegistry.js'
import { isCanvasProductionEnabled } from '../../../core/stores/canvasConfig.js'
import { getFlag } from '../../../core/stores/featureFlags.js'

/** Variables defined in config — used to resolve `$key` references. */
const variables = widgetsConfig.variables || {}

/**
 * Resolve `$variable` references in a string value.
 * Returns the original value if it's not a string or doesn't start with `$`.
 */
function resolveVar(value) {
  if (typeof value !== 'string' || !value.startsWith('$')) return value
  const key = value.slice(1)
  return variables[key] ?? value
}

/**
 * Resolve all string values in a feature object, including nested items.
 */
function resolveFeature(feature) {
  const resolved = {}
  for (const [key, val] of Object.entries(feature)) {
    if (key === 'items' && Array.isArray(val)) {
      resolved[key] = val.map((item) => {
        const r = {}
        for (const [k, v] of Object.entries(item)) {
          // Resolve nested alt object inside items
          if (k === 'alt' && v && typeof v === 'object') {
            const altResolved = {}
            for (const [ak, av] of Object.entries(v)) altResolved[ak] = resolveVar(av)
            r[k] = altResolved
          } else {
            r[k] = resolveVar(v)
          }
        }
        return r
      })
    } else if (key === 'alt' && val && typeof val === 'object') {
      const r = {}
      for (const [k, v] of Object.entries(val)) r[k] = resolveVar(v)
      resolved[key] = r
    } else if (key === 'toggle' && val && typeof val === 'object') {
      // Pass toggle config through as-is (stateKey, activeIcon, activeLabel)
      resolved[key] = { ...val }
    } else if (key === 'surfaces' && Array.isArray(val)) {
      resolved[key] = val
    } else {
      resolved[key] = resolveVar(val)
    }
  }
  return resolved
}

/**
 * Convert a config prop definition to the schema shape used by widgetProps.js.
 * Config uses `"default"`, schema uses `"defaultValue"`.
 */
function configPropToSchema(propDef) {
  const schema = {
    type: propDef.type,
    label: propDef.label,
    category: propDef.category,
  }
  if (propDef.default !== undefined) schema.defaultValue = propDef.default
  if (propDef.options) schema.options = propDef.options
  if (propDef.min !== undefined) schema.min = propDef.min
  if (propDef.max !== undefined) schema.max = propDef.max
  return schema
}

/**
 * Resolve the effective definition for a widget type.
 * Consumer registry replaces the core entry entirely; consumers that need
 * to extend a core widget should re-declare the merged definition.
 *
 * Features are NOT pre-resolved through `resolveFeature` for consumer
 * entries — consumers are expected to pass plain values rather than
 * `$label:foo` references, which are an internal storyboard.json idiom.
 *
 * @param {string} type
 * @returns {object|null} The full widget definition with resolved features, or null
 */
function resolveDefinition(type) {
  const consumer = getWidgetDefinition(type)
  if (consumer) {
    return {
      ...consumer,
      features: (consumer.features || []).map(resolveFeature),
    }
  }
  const core = widgetsConfig.widgets[type]
  if (!core) return null
  return {
    ...core,
    features: (core.features || []).map(resolveFeature),
  }
}

/**
 * Resolve schema (prop shape) for a widget type. Reads from the merged
 * definition (consumer over core).
 * @param {string} type
 * @returns {Record<string, object>}
 */
function resolveSchema(type) {
  const def = resolveDefinition(type) || consumerOrCorePropsOnly(type)
  if (!def?.props) return {}
  const schema = {}
  for (const [key, propDef] of Object.entries(def.props)) {
    schema[key] = configPropToSchema(propDef)
  }
  return schema
}

// Fallback for resolveSchema when the registry has a partial entry that
// lacks `props` — read from core so widgetProps' readProp helpers still work.
function consumerOrCorePropsOnly(type) {
  const consumer = getWidgetDefinition(type)
  if (consumer?.props) return consumer
  return widgetsConfig.widgets[type] || null
}

function getAllTypes() {
  // Set ensures consumer-only types AND core types are both included
  return new Set([
    ...Object.keys(widgetsConfig.widgets),
    ...Object.keys(getAllWidgetDefinitions()),
  ])
}

/** All widget schemas, keyed by type string. Reactive: re-resolved on each access. */
export const schemas = new Proxy({}, {
  get(_, type) {
    if (typeof type !== 'string') return undefined
    return resolveSchema(type)
  },
  has(_, type) {
    return typeof type === 'string' && (
      !!widgetsConfig.widgets[type] || !!getWidgetDefinition(type)
    )
  },
  ownKeys() {
    return [...getAllTypes()]
  },
  getOwnPropertyDescriptor(_, type) {
    if (typeof type !== 'string') return undefined
    if (!widgetsConfig.widgets[type] && !getWidgetDefinition(type)) return undefined
    return { enumerable: true, configurable: true, value: resolveSchema(type) }
  },
})

/**
 * Snapshot of all widget definitions with features resolved.
 * Reactive helper kept for tests and tooling — prefer the typed getters below
 * for runtime code.
 */
export function widgetTypesSnapshot() {
  const result = {}
  for (const type of getAllTypes()) {
    const def = resolveDefinition(type)
    if (def) result[type] = def
  }
  return result
}

/**
 * Back-compat: a Proxy that behaves like the previous `widgetTypes` constant.
 * Reads are live (consumer overrides win at access time).
 */
export const widgetTypes = new Proxy({}, {
  get(_, type) {
    if (typeof type !== 'string') return undefined
    return resolveDefinition(type) || undefined
  },
  has(_, type) {
    return typeof type === 'string' && (
      !!widgetsConfig.widgets[type] || !!getWidgetDefinition(type)
    )
  },
  ownKeys() {
    return [...getAllTypes()]
  },
  getOwnPropertyDescriptor(_, type) {
    if (typeof type !== 'string') return undefined
    const def = resolveDefinition(type)
    if (!def) return undefined
    return { enumerable: true, configurable: true, value: def }
  },
})

// ── Helpers to read the new `interaction` / `chrome` sub-blocks with
// back-compat fallback to the legacy top-level keys used by widgets.config.json.

function readInteraction(def) {
  if (!def) return null
  const i = def.interaction || {}
  // Preserve shape of `movable` so consumers can opt into prod via the
  // structured form `{ enabled, prod }` (mirroring `resize`). Boolean stays
  // boolean for back-compat — readers consult `isMovable()` for the
  // env-aware verdict.
  let movable
  if (i.movable === false) movable = false
  else if (typeof i.movable === 'object' && i.movable !== null) movable = i.movable
  else movable = true
  return {
    selectable: i.selectable !== false,                    // default true
    movable,                                               // default true
    resize: i.resize ?? def.resize ?? null,
    expandable: i.expandable ?? def.expandable ?? false,
    splitScreen: i.splitScreen ?? def.splitScreen ?? false,
    interactGate: i.interactGate ?? def.interactGate ?? false,
    interactGateLabel: i.interactGateLabel ?? def.interactGateLabel ?? 'Click to interact',
  }
}

function readChrome(def) {
  if (!def) return { enabled: true }
  const c = def.chrome || {}
  return {
    enabled: c.enabled !== false,                          // default true
  }
}

/**
 * Get the chrome options for a widget type (used by CanvasPage to decide
 * whether to wrap the widget in WidgetChrome at all).
 * @param {string} type
 * @returns {{ enabled: boolean }}
 */
export function getChromeOptions(type) {
  return readChrome(resolveDefinition(type))
}

/**
 * Get the per-widget interaction switches (selectable, movable, resize,
 * expandable, splitScreen, interactGate). Merges new `interaction.*`
 * sub-block over legacy top-level keys.
 * @param {string} type
 * @returns {{ selectable, movable, resize, expandable, splitScreen, interactGate, interactGateLabel }}
 */
export function getInteractionOptions(type) {
  return readInteraction(resolveDefinition(type)) || {
    selectable: true,
    movable: true,
    resize: null,
    expandable: false,
    splitScreen: false,
    interactGate: false,
    interactGateLabel: 'Click to interact',
  }
}

/**
 * Get the knob schema for a widget type (widget-instance knobs, e.g.
 * configuration exposed by custom widgets). Returns an empty array when the
 * widget declares none.
 * @param {string} type
 * @returns {Array}
 */
export function getWidgetKnobs(type) {
  return resolveDefinition(type)?.knobs ?? []
}

/**
 * Get the feature list for a widget type.
 * In production (or when isLocalDev is false, e.g. ?prodMode simulation),
 * only features with `prod: true` are returned.
 * In dev, all features are returned.
 *
 * Features with an explicit `surfaces` array that does NOT include `"toolbar"`
 * are excluded — they only render on their declared surfaces (fullbar/splitbar).
 * Features without a `surfaces` array default to toolbar-only.
 *
 * @param {string} type — widget type string
 * @param {{ isLocalDev?: boolean }} [options]
 * @returns {Array} features array from config (variables resolved), or empty array
 */
export function getFeatures(type, { isLocalDev = true } = {}) {
  const features = resolveDefinition(type)?.features ?? []
  let filtered = features.filter(f => {
    const surfaces = f.surfaces || ['toolbar']
    return surfaces.includes('toolbar')
  })
  if (import.meta.env?.PROD || !isLocalDev) {
    filtered = filtered.filter(f => f.prod)
  }
  return filtered
}

/**
 * Get features for a specific rendering surface.
 * Features without a `surfaces` array default to `["toolbar"]`.
 * @param {string} type — widget type string
 * @param {'toolbar' | 'fullbar' | 'splitbar'} surface — target surface
 * @param {{ isLocalDev?: boolean }} [options]
 * @returns {Array} filtered features for the given surface
 */
export function getFeaturesForSurface(type, surface, { isLocalDev = true } = {}) {
  let features = resolveDefinition(type)?.features ?? []
  if (import.meta.env?.PROD || !isLocalDev) {
    features = features.filter(f => f.prod)
  }
  return features.filter(f => {
    const surfaces = f.surfaces || ['toolbar']
    return surfaces.includes(surface)
  })
}

/**
 * Check if a widget type supports resize in the current environment.
 * Returns false if resize is disabled, or if in production and prod is not true.
 * Reads from `interaction.resize` (preferred) or legacy top-level `resize`.
 *
 * The global `canvas.production.resize` setting (from storyboard.config.json)
 * opts every resize-enabled widget into production resizing.
 *
 * @param {string} type — widget type string
 * @returns {boolean}
 */
export function isResizable(type) {
  const resize = getInteractionOptions(type).resize
  if (!resize?.enabled) return false
  if (import.meta.env?.PROD && !resize.prod && !isCanvasProductionEnabled('resize')) return false
  return true
}

/**
 * Check if a widget type supports drag-to-move in the current environment.
 *
 * `interaction.movable` accepts either:
 *   - boolean (default true)  — movable in dev only; locked in production
 *   - `{ enabled: boolean, prod?: boolean }` — opt into production drag via
 *     `prod: true` (mirrors the `resize` shape)
 *
 * The global `canvas.production.move` setting (from storyboard.config.json)
 * opts every movable widget into production drag.
 *
 * @param {string} type — widget type string
 * @returns {boolean}
 */
export function isMovable(type) {
  const movable = getInteractionOptions(type).movable
  if (movable === false) return false
  if (typeof movable === 'object' && movable !== null) {
    if (movable.enabled === false) return false
    if (import.meta.env?.PROD && !movable.prod && !isCanvasProductionEnabled('move')) return false
    return true
  }
  // Boolean true (or undefined): historical "movable in dev only" semantic.
  if (import.meta.env?.PROD && !isCanvasProductionEnabled('move')) return false
  return true
}

/**
 * Get the display metadata (label, icon) for a widget type.
 * @param {string} type — widget type string
 * @returns {{ label: string, icon: string } | null}
 */
export function getWidgetMeta(type) {
  const def = resolveDefinition(type)
  if (!def) return null
  return { label: def.label, icon: def.icon }
}

/**
 * Check if a widget type supports expanding to a full-screen modal.
 * Reads from `interaction.expandable` (preferred) or legacy top-level.
 * @param {string} type — widget type string
 * @returns {boolean}
 */
export function isExpandable(type) {
  return getInteractionOptions(type).expandable === true
}

/**
 * Check if a widget type can appear in a split-screen pane.
 * Reads from `interaction.splitScreen` (preferred) or legacy top-level.
 * @param {string} type — widget type string
 * @returns {boolean}
 */
export function isSplitScreenCapable(type) {
  return getInteractionOptions(type).splitScreen === true
}

/**
 * Get the interact gate config for a widget type.
 * Reads from `interaction.interactGate` (preferred) or legacy top-level.
 * @returns {{ enabled: boolean, label: string }}
 */
export function getInteractGate(type) {
  const i = getInteractionOptions(type)
  if (!i.interactGate) return { enabled: false, label: i.interactGateLabel || 'Click to interact' }
  return { enabled: true, label: i.interactGateLabel || 'Click to interact' }
}

/**
 * Get the delete-confirm config for a widget type, or null if the widget
 * does not require confirmation before deletion.
 *
 * Shape: `{ enabled: true, title?: string, message?: string, confirmLabel?: string }`
 *
 * @param {string} type — widget type string
 * @returns {{ enabled: boolean, title?: string, message?: string, confirmLabel?: string } | null}
 */
export function getDeleteConfirm(type) {
  const def = resolveDefinition(type)
  const dc = def?.deleteConfirm
  if (!dc || !dc.enabled) return null
  return {
    enabled: true,
    title: dc.title,
    message: dc.message,
    confirmLabel: dc.confirmLabel,
  }
}

/**
 * Widget creation gate: a definition may declare `flag` to stay hidden from
 * creation surfaces (add-widget menus) while that feature flag resolves
 * false. Unflagged types are always offered.
 * @param {string} type — widget type string
 * @returns {boolean}
 */
export function isWidgetFlagEnabled(type) {
  const flag = resolveDefinition(type)?.flag
  return !flag || getFlag(flag)
}

/**
 * Get all widget types as an array of { type, label, icon } for menus.
 * Excludes hidden core widgets (created via paste only), any widget with
 * `unlisted: true` (consumer- or core-side), and widgets whose feature
 * `flag` is off.
 */
export function getMenuWidgetTypes() {
  const hidden = new Set(['link-preview', 'image', 'figma-embed', 'codepen-embed', 'story', 'terminal-read'])
  const out = []
  for (const type of getAllTypes()) {
    if (hidden.has(type)) continue
    const def = resolveDefinition(type)
    if (!def || def.unlisted) continue
    if (!isWidgetFlagEnabled(type)) continue
    out.push({ type, label: def.label, icon: def.icon })
  }
  return out
}

/**
 * Check whether a widget type's content remains editable in production
 * (a built-in capability for `markdown` and `sticky-note`, opted into via
 * `canvas.production.editMarkdown` / `canvas.production.editSticky` in
 * `storyboard.config.json`). Always true in dev.
 *
 * Consumed by `CanvasPage` to decide whether to forward an `onUpdate`
 * callback to the widget when `!isLocalDev`.
 *
 * @param {string} type — widget type string
 * @returns {boolean}
 */
export function isEditableInProduction(type) {
  if (type === 'markdown') return isCanvasProductionEnabled('editMarkdown')
  if (type === 'sticky-note') return isCanvasProductionEnabled('editSticky')
  return false
}

/**
 * Get the connector configuration for a widget type.
 * @param {string} type — widget type string
 * @returns {{ anchors: Record<string, string>, accept: string[], exclude: string[], defaults: Object|undefined }}
 */
export function getConnectorConfig(type) {
  const def = resolveDefinition(type)?.connectors
  return {
    anchors: def?.anchors ?? { top: 'available', bottom: 'available', left: 'available', right: 'available' },
    accept: def?.accept ?? ['*'],
    exclude: def?.exclude ?? [],
    defaults: def?.defaults,
  }
}

/**
 * Check if a specific anchor is available on a widget type.
 * @param {string} type — widget type string
 * @param {string} anchor — anchor name (top/bottom/left/right)
 * @returns {'available' | 'disabled' | 'unavailable'}
 */
export function getAnchorState(type, anchor) {
  const config = getConnectorConfig(type)
  return config.anchors[anchor] ?? 'available'
}

/**
 * Get the connector styling defaults from config.
 * @returns {Object} connector default styles
 */
export function getConnectorDefaults() {
  const defaults = widgetsConfig.connectorDefaults ?? {}
  return {
    controlOffset: defaults.controlOffset ?? 80,
    stroke: defaults.stroke ?? 'var(--color-foreground-accent, #0969da)',
    strokeWidth: defaults.strokeWidth ?? 4,
    hoverStroke: defaults.hoverStroke ?? 'var(--color-foreground-danger, #cf222e)',
    hoverStrokeWidth: defaults.hoverStrokeWidth ?? 5,
    endpointRadius: defaults.endpointRadius ?? 6,
    endpointFill: defaults.endpointFill ?? 'var(--color-foreground-accent, #0969da)',
    endpointStroke: defaults.endpointStroke ?? 'var(--color-background, #ffffff)',
    endpointStrokeWidth: defaults.endpointStrokeWidth ?? 3,
    hitAreaStrokeWidth: defaults.hitAreaStrokeWidth ?? 24,
    dragStroke: defaults.dragStroke ?? 'var(--color-foreground-accent, #0969da)',
    dragStrokeWidth: defaults.dragStrokeWidth ?? 2,
    dragDasharray: defaults.dragDasharray ?? '6 4',
    dragOpacity: defaults.dragOpacity ?? 0.7,
    startEndpoint: defaults.startEndpoint ?? 'circle',
    endEndpoint: defaults.endEndpoint ?? 'circle',
  }
}

/**
 * Check if a connection from sourceType to targetType is allowed.
 * @param {string} targetType — widget type receiving the connection
 * @param {string} sourceType — widget type initiating the connection
 * @returns {boolean}
 */
export function canAcceptConnection(targetType, sourceType) {
  const config = getConnectorConfig(targetType)
  if (config.exclude.includes(sourceType)) return false
  if (config.accept.includes('*')) return true
  return config.accept.includes(sourceType)
}
