/**
 * Knob hash-key helpers.
 *
 * Converts knob ids and optional route scopes into deterministic URL hash keys
 * shared by the reader hook, form surfaces, and iframe-safe writer.
 */

function pascal(value) {
  return String(value ?? '')
    .match(/[a-zA-Z0-9]+/g)
    ?.map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || ''
}

/**
 * Build the URL hash key for a knob id.
 *
 * @param {string} id - Knob id, including optional nested dot notation.
 * @param {{ route?: string|null }} [options]
 * @returns {string}
 */
export function buildKnobKey(id, { route } = {}) {
  return `knob${route ? pascal(route) : ''}${pascal(id)}`
}

export { pascal }
