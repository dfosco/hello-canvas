/**
 * Pure (dependency-free) route-tree filtering for the isolated prototypes
 * iframe. Kept separate from `prototypeRoutes.jsx` so it can be unit-tested
 * without pulling in that module's eager `import.meta.glob` chain.
 *
 * Filter a route tree's children down to a single prototype subtree:
 *   - `*` splat fallback is always kept.
 *   - Pathless layout wrappers are kept, descending into their children to
 *     reach the prototype routes.
 *   - Any route WITH a path is kept iff its first segment matches the
 *     requested proto. When it matches, its ENTIRE subtree is kept intact,
 *     because generouted nests sub-routes under the prototype's path node
 *     (e.g. `canvas-threats/threats` → a `threats` child of `canvas-threats`).
 *     Re-filtering those children by first segment would drop them since
 *     their own segment isn't the proto name — that was the nested-route bug.
 */
export function filterChildrenForProto(children, proto) {
  const matchesProto = (route) => {
    const seg = (route.path || '').split('/').filter(Boolean)[0]
    return seg === proto
  }
  return children
    .map((r) => {
      if (r.path === '*') return r
      if (!r.path) {
        return r.children ? { ...r, children: filterChildrenForProto(r.children, proto) } : r
      }
      return matchesProto(r) ? r : null
    })
    .filter(Boolean)
}
