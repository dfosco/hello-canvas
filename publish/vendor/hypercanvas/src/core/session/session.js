/**
 * URL hash-based utilities for storyboard session state.
 *
 * Session params are stored in the URL hash fragment (after #) to avoid
 * triggering React Router re-renders. React Router (used by generouted)
 * patches history.replaceState/pushState, so any search-param change
 * causes a full route tree re-render. The hash is invisible to the router.
 *
 * Format:  #key1=value1&key2=value2
 * Example: /page?scene=default#user.name=Alice&settings.theme=dark
 */

/**
 * Parse the current hash into a Map of key→value pairs.
 *
 * Tolerates two coexisting hash formats:
 *   "#key=val&other=x"           — plain storyboard params (workspace SPA)
 *   "#/path?key=val&other=x"     — hash-router path + params (iframe entry)
 *
 * In the second form, the params live after the first "?" so the path
 * portion ("/path") survives unchanged when we re-serialize.
 *
 * @returns {URLSearchParams}
 */
function parseHash() {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return new URLSearchParams('')
  if (raw.startsWith('/')) {
    const queryIdx = raw.indexOf('?')
    return new URLSearchParams(queryIdx >= 0 ? raw.slice(queryIdx + 1) : '')
  }
  return new URLSearchParams(raw)
}

/**
 * Extract the hash-router path prefix (if any) so writes can re-attach
 * it. Returns '' for the plain-params format.
 */
function hashPathPrefix() {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw.startsWith('/')) return ''
  const queryIdx = raw.indexOf('?')
  return queryIdx >= 0 ? raw.slice(0, queryIdx) : raw
}

/**
 * Write a URLSearchParams back to the hash, preserving any hash-router
 * path prefix so the iframe's hash router doesn't lose its route.
 * Uses window.location.hash (NOT history.replaceState) because
 * generouted/React Router patches replaceState and would trigger
 * a full route re-render. Native hash assignment only fires
 * 'hashchange' which React Router ignores.
 * @param {URLSearchParams} params
 */
function writeHash(params) {
  const path = hashPathPrefix()
  const query = params.toString()
  if (path && query) window.location.hash = `${path}?${query}`
  else if (path) window.location.hash = path
  else window.location.hash = query
}

/**
 * Read a single session param value.
 * @param {string} key
 * @returns {string|null}
 */
export function getParam(key) {
  return parseHash().get(key)
}

/**
 * Write a single session param. Updates the hash in-place.
 * @param {string} key
 * @param {string} value
 */
export function setParam(key, value) {
  const params = parseHash()
  params.set(key, String(value))
  writeHash(params)
}

/**
 * Return all session params as a plain object.
 * @returns {Record<string, string>}
 */
export function getAllParams() {
  const params = parseHash()
  const result = {}
  for (const [key, value] of params.entries()) {
    result[key] = value
  }
  return result
}

/**
 * Remove a single session param from the hash.
 * @param {string} key
 */
export function removeParam(key) {
  const params = parseHash()
  params.delete(key)
  writeHash(params)
}
