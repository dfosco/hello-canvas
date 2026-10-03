/**
 * Resolves a dot-notation path against an object.
 *
 * @param {object} obj  - The source object
 * @param {string} path - Dot-notation path (e.g. 'user.profile.name' or 'projects.0')
 * @returns {*} The value at the path, or undefined if any segment is missing
 */
export function getByPath(obj, path) {
  if (obj == null || typeof path !== 'string' || path === '') {
    return undefined
  }

  const segments = path.split('.')
  let current = obj

  for (const segment of segments) {
    if (current == null || typeof current !== 'object') {
      return undefined
    }
    current = current[segment]
  }

  return current
}

/**
 * Deep-clone a value (arrays and plain objects only).
 */
export function deepClone(val) {
  if (Array.isArray(val)) return val.map(deepClone)
  if (val !== null && typeof val === 'object') {
    const out = {}
    for (const k of Object.keys(val)) out[k] = deepClone(val[k])
    return out
  }
  return val
}

/**
 * Set a value at a dot-notation path inside an object, mutating it.
 */
export function setByPath(obj, path, value) {
  const segments = path.split('.')
  // Guard against prototype pollution: refuse paths that traverse into
  // special object internals. Override params can come from the URL.
  if (segments.some((seg) => seg === '__proto__' || seg === 'constructor' || seg === 'prototype')) {
    return
  }
  let current = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (current[seg] == null || typeof current[seg] !== 'object') {
      current[seg] = /^\d+$/.test(segments[i + 1]) ? [] : {}
    }
    current = current[seg]
  }
  current[segments[segments.length - 1]] = value
}
