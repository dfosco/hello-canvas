/**
 * Detect the current prototype name + route from the URL pathname.
 *
 * Extracted so both `KnobsPanel.jsx` and `installKnobsHighlight` agree
 * on the lookup key for the active prototype's knobs.
 *
 * The pathname shape is `{basePath}/{?branch--<x>}/{prototypeName}/{...route}`.
 * Branch deploys prefix the path with `branch--<branch-name>/`, which we
 * skip before reading the prototype segment.
 */
export function detectCurrentPrototypeRoute(
  basePath = '/',
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
) {
  let path = pathname
  const base = basePath.replace(/\/+$/, '')
  if (base && path.startsWith(base)) path = path.slice(base.length)
  path = path.replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean)

  const branchSegment = segments[0]?.startsWith('branch--') ? segments[0] : null
  const protoIdx = branchSegment ? 1 : 0
  const prototypeName = segments[protoIdx] || null
  const routeSegments = prototypeName ? segments.slice(protoIdx + 1) : []
  const route = routeSegments.length > 0 ? `/${routeSegments.join('/')}` : undefined

  return { prototypeName, route, path }
}
