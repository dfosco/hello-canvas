/**
 * Storyboard Knobs core barrel.
 *
 * Re-exports framework-agnostic knob helpers for hash keys, coercion,
 * discovery, iframe-safe writes, and in-page highlight overlay.
 */

export { buildKnobKey, pascal } from './keys.js'
export { coerceByType } from './coerce.js'
export {
  initKnobs,
  getPrototypeKnobs,
  getComponentKnobs,
  resolveKnobDef,
  flattenKnobs,
  normalizeScope,
} from './discovery.js'
export { setKnobValue, clearKnobValue, serializeKnobValue } from './writer.js'
export { detectCurrentPrototypeRoute } from './route.js'
export {
  resolveKnobColor,
  isKnobHighlightEnabled,
  installKnobsHighlight,
  uninstallKnobsHighlight,
  DEFAULT_KNOB_COLOR,
} from './highlight.js'
