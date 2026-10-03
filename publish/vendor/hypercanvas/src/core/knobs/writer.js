/**
 * Knob hash writer.
 *
 * Mutates an existing Window location hash in place so knobs can update
 * same-window prototypes or iframe content windows without reassigning iframe
 * src and causing reloads.
 */

import { buildKnobKey } from './keys.js'

function resolveTargetWindow(target) {
  if (!target) return window
  if (target.location) return target
  if (target.contentWindow?.location) return target.contentWindow
  throw new Error('[storyboard-knobs] target must be a Window or iframe element')
}

// The hash can hold both a hash-router path (e.g. "#/MyProto/SignupForm")
// AND storyboard param state ("#knobFoo=bar"). When both coexist, the
// router pushes the path as "#/path" and storyboard appends params after
// the path with an "?" separator: "#/path?knobFoo=bar". Parse defensively:
// pull params from after the first "?" if present, otherwise treat the
// whole hash as the param string.
function splitHash(rawHash) {
  const hash = rawHash.replace(/^#/, '')
  if (!hash) return { path: '', query: '' }
  // Hash-router path always starts with "/" — separate path from params.
  if (hash.startsWith('/')) {
    const queryIdx = hash.indexOf('?')
    if (queryIdx >= 0) {
      return { path: hash.slice(0, queryIdx), query: hash.slice(queryIdx + 1) }
    }
    return { path: hash, query: '' }
  }
  return { path: '', query: hash }
}

function parseHash(location) {
  const { query } = splitHash(location.hash)
  return new URLSearchParams(query)
}

function writeHash(location, params) {
  const { path } = splitHash(location.hash)
  const query = params.toString()
  if (path && query) location.hash = `${path}?${query}`
  else if (path) location.hash = path
  else location.hash = query
}

function serializeRange(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return String(value ?? '')
  return `${value[0] ?? ''},${value[1] ?? ''}`
}

/**
 * Serialize a knob value for URL hash storage.
 *
 * @param {*} value
 * @param {{ type?: string }} [def]
 * @returns {string}
 */
export function serializeKnobValue(value, def = {}) {
  switch (def?.type) {
    case 'boolean':
      return value === false || value === 'false' ? 'false' : 'true'
    case 'number':
    case 'slider':
      return String(value)
    case 'range':
      return serializeRange(value)
    case 'string-array':
      return JSON.stringify(Array.isArray(value) ? value : [])
    case 'object':
      return JSON.stringify(value ?? {})
    default:
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (Array.isArray(value)) {
        const looksLikeRange = value.length === 2 && value.every(item =>
          typeof item === 'number' && Number.isFinite(item)
        )
        return looksLikeRange ? serializeRange(value) : JSON.stringify(value)
      }
      if (value && typeof value === 'object') return JSON.stringify(value)
      return String(value ?? '')
  }
}

/**
 * Set a knob value on a target window hash.
 *
 * @param {string} id
 * @param {*} value
 * @param {{ route?: string|null, target?: Window|HTMLIFrameElement, def?: object, type?: string }} [options]
 */
export function setKnobValue(id, value, { route, target, def, type } = {}) {
  const targetWindow = resolveTargetWindow(target)
  const key = buildKnobKey(id, { route })
  const params = parseHash(targetWindow.location)
  params.set(key, serializeKnobValue(value, def || { type }))
  writeHash(targetWindow.location, params)
}

/**
 * Clear a knob value from a target window hash.
 *
 * @param {string} id
 * @param {{ route?: string|null, target?: Window|HTMLIFrameElement }} [options]
 */
export function clearKnobValue(id, { route, target } = {}) {
  const targetWindow = resolveTargetWindow(target)
  const key = buildKnobKey(id, { route })
  const params = parseHash(targetWindow.location)
  params.delete(key)
  writeHash(targetWindow.location, params)
}
