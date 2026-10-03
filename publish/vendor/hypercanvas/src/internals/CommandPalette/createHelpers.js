/**
 * Map UI command-palette type ids (PascalCase) to schema keys (lowercase),
 * and normalise consumer-supplied `type` values to a schema key.
 *
 * Kept in its own file so React Fast Refresh stays happy in
 * `CreateArtifactForm.jsx` and `CreateDialog.jsx` (component-only modules).
 */
export const TYPE_KEY_MAP = {
  Prototype: 'prototype', Canvas: 'canvas', Component: 'component',
  Flow: 'flow', Object: 'object', Record: 'record', Page: 'page',
}

/**
 * Returns the schema key (lowercase) for a consumer-supplied type, or
 * `null` when no fixed type was requested (picker mode).
 */
export function resolveSchemaKey(type) {
  if (!type || type === 'Any' || String(type).toLowerCase() === 'any') return null
  return TYPE_KEY_MAP[type] || String(type).toLowerCase()
}

/**
 * Prepend `base` (e.g. `/storyboard/`) to an artifact route. Used by the
 * post-create navigation in `CreateArtifactForm`.
 */
export function withBase(base, route) {
  const b = (base || '/').replace(/\/+$/, '')
  const r = route?.startsWith('/') ? route : `/${route || ''}`
  return b === '' || b === '/' ? r : `${b}${r}`
}
