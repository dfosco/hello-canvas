/**
 * Read-only knob hook.
 *
 * Resolves the current prototype/route, reads the corresponding knob hash
 * value through useOverride, coerces it by schema, and falls back to defaults.
 */

import { useContext } from 'react'
import { StoryboardContext } from '../StoryboardContext.js'
import { useOverride } from './useOverride.js'
import {
  buildKnobKey,
  coerceByType,
  getPrototypeKnobs,
  normalizeScope,
  resolveKnobDef,
} from '../../core/knobs/index.js'

/**
 * Detect the active prototype and route scope from the current URL.
 *
 * Handles the dev-only `/prototypes.html/<proto>/...` iframe-isolation
 * prefix (`packages/storyboard/src/internals/canvas/widgets/PrototypeEmbed.jsx`)
 * by stripping it before parsing — otherwise `prototypes.html` ends up as
 * the prototype name and the real prototype is treated as a route segment.
 *
 * @param {string} [pathname]
 * @param {string} [basePath]
 * @returns {{ prototypeName: string|null, route: string|undefined }}
 */
export function detectKnobRoute(
  pathname = window.location.pathname,
  basePath = import.meta.env?.BASE_URL || '/',
) {
  let path = pathname
  const base = basePath.replace(/\/+$/, '')
  if (base && base !== '/' && path.startsWith(base)) {
    path = path.slice(base.length) || '/'
  }

  // Strip the prototypes.html isolation prefix (dev iframe path).
  path = path.replace(/^\/prototypes\.html(?=\/|$)/, '') || '/'

  path = path.replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean)
  const branchSegment = segments[0]?.startsWith('branch--') ? segments[0] : null
  const protoIdx = branchSegment ? 1 : 0
  const prototypeName = segments[protoIdx] || null
  const routeSegments = prototypeName ? segments.slice(protoIdx + 1) : []
  const route = routeSegments.length > 0 ? `/${routeSegments.join('/')}` : undefined

  return { prototypeName, route }
}

/**
 * Read a typed knob value from URL hash state.
 *
 * Behaves like `useOverride`: reads the URL hash key, re-renders on
 * `hashchange`. When a schema is declared, coercion + default fallback
 * apply. When no schema is discovered, returns the raw hash value as-is
 * so prototypes always react to URL changes (even before discovery runs).
 *
 * @param {string} id
 * @param {{ route?: string|null, scope?: string|null }} [options]
 * @returns {*}
 */
export function useKnob(id, { route, scope } = {}) {
  const context = useContext(StoryboardContext)
  const detected = detectKnobRoute()
  const hasExplicitRoute = route !== undefined || scope !== undefined
  const routeValue = route !== undefined ? route : scope
  const resolvedRoute = hasExplicitRoute ? normalizeScope(routeValue) : detected.route
  const prototypeName = context?.prototypeName ?? detected.prototypeName

  const key = buildKnobKey(id, { route: resolvedRoute })
  const [rawValue] = useOverride(key)
  const knobs = prototypeName ? getPrototypeKnobs(prototypeName) : []
  const def = resolveKnobDef(id, { route: resolvedRoute, knobs })

  // No schema discovered? Best-effort coerce common string forms so
  // consumers don't have to ?? against the string "false" (truthy!).
  // Numeric strings stay numeric. Everything else passes through as-is.
  if (!def) {
    if (rawValue == null) return undefined
    if (rawValue === 'true') return true
    if (rawValue === 'false') return false
    const asNumber = Number(rawValue)
    if (rawValue !== '' && !Number.isNaN(asNumber)) return asNumber
    return rawValue
  }

  // With a schema: coerce → fall back to default when raw is missing or
  // un-coercible. Mirrors the original "URL is invalid, use the default"
  // semantics so consumers always get a typed value.
  const coerced = coerceByType(rawValue, def)
  return coerced !== undefined ? coerced : def.default
}
