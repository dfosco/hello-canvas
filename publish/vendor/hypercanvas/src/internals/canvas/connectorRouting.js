/**
 * Connector routing — manual (waypoint-based) path generation.
 *
 * Waypoints are stored relative to the connector's start anchor:
 *   { dx: number, dy: number, tHint?: number, orientation?: 'h' | 'v' }
 *
 * On render, the absolute waypoint position = startAnchorPt + (dx, dy).
 * This means waypoints translate when the start widget moves (B3 policy).
 *
 * The connector's path passes through:
 *   startPt → wp1 → wp2 → … → endPt
 *
 * In fluid mode, the path is a Catmull-Rom-style smooth curve.
 * In orthogonal mode, segments are axis-aligned with rounded corner fillets.
 */

import { getControlOffset } from './connectorGeometry.js'

const DEFAULT_CORNER_RADIUS = 12

/**
 * Resolve a waypoint's absolute position from the start anchor point.
 */
export function resolveWaypoint(startPt, waypoint) {
  return { x: startPt.x + waypoint.dx, y: startPt.y + waypoint.dy }
}

/**
 * Resolve all waypoints to absolute positions.
 */
export function resolveWaypoints(startPt, waypoints) {
  if (!Array.isArray(waypoints)) return []
  return waypoints.map((wp) => resolveWaypoint(startPt, wp))
}

/**
 * Convert an absolute (x, y) point to a waypoint relative to startPt.
 */
export function toRelativeWaypoint(startPt, absPt, extra = {}) {
  return { dx: absPt.x - startPt.x, dy: absPt.y - startPt.y, ...extra }
}

/* --------------------------------------------------------------------------
 * Fluid (smooth curve) — Catmull-Rom through points → cubic Bézier segments
 * -------------------------------------------------------------------------- */

/**
 * Build a smooth path through a sequence of points using a Catmull-Rom spline
 * converted to cubic Bézier segments.
 *
 * @param {Array<{x:number,y:number}>} pts — at least 2 points
 * @param {number} tension — 0.5 default (standard Catmull-Rom)
 */
function catmullRomPath(pts, tension = 0.5) {
  if (pts.length < 2) return ''
  if (pts.length === 2) {
    // Straight line for two-point case (waypoint-less manual path shouldn't happen
    // but be defensive).
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  }

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2

    const cp1x = p1.x + (p2.x - p0.x) * tension / 3
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/* --------------------------------------------------------------------------
 * Orthogonal — axis-aligned segments with rounded corner fillets
 * -------------------------------------------------------------------------- */

/**
 * Project a point along an anchor's outward direction by `offset` pixels.
 * Used to insert a "stub" segment so the connector leaves/enters perpendicular
 * to a widget edge.
 */
function projectAnchorStub(pt, anchor, offset) {
  const dir = getControlOffset(anchor, 1)
  // Normalize to unit vector then scale to offset
  const len = Math.hypot(dir.dx, dir.dy) || 1
  return { x: pt.x + (dir.dx / len) * offset, y: pt.y + (dir.dy / len) * offset }
}

/**
 * Snap a sequence of points to alternating horizontal/vertical segments.
 * Inserts elbow corner points where two consecutive points are diagonal so
 * the path stays axis-aligned.
 *
 * Heuristic: alternate orientation, starting with whichever axis has the
 * larger initial delta. For each consecutive pair (a, b), if they're already
 * axis-aligned, keep them; otherwise insert one elbow at (b.x, a.y) or
 * (a.x, b.y) depending on the desired orientation.
 *
 * @param {Array<{x,y}>} pts
 * @param {'h' | 'v'} firstOrientation — direction of the first segment
 * @returns {Array<{x,y}>}
 */
function orthogonalize(pts, firstOrientation = 'h') {
  if (pts.length < 2) return pts
  const out = [pts[0]]
  let orient = firstOrientation
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const next = pts[i]
    if (prev.x === next.x || prev.y === next.y) {
      out.push(next)
      // Update orientation based on what segment we just emitted
      orient = prev.y === next.y ? 'h' : 'v'
      // Flip for next
      orient = orient === 'h' ? 'v' : 'h'
      continue
    }
    // Insert an elbow point
    const elbow = orient === 'h'
      ? { x: next.x, y: prev.y }
      : { x: prev.x, y: next.y }
    out.push(elbow)
    out.push(next)
    orient = orient === 'h' ? 'v' : 'h'
  }
  return out
}

/**
 * Build an SVG path with rounded corner fillets through a polyline.
 * Each interior vertex becomes a quadratic-arc transition of `radius`
 * (clamped to half the shorter adjacent segment).
 */
function roundedPolylinePath(pts, radius = DEFAULT_CORNER_RADIUS) {
  if (pts.length < 2) return ''
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
  }
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const ab = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const bc = Math.hypot(c.x - b.x, c.y - b.y) || 1
    const r = Math.min(radius, ab / 2, bc / 2)
    const t1x = b.x - ((b.x - a.x) / ab) * r
    const t1y = b.y - ((b.y - a.y) / ab) * r
    const t2x = b.x + ((c.x - b.x) / bc) * r
    const t2y = b.y + ((c.y - b.y) / bc) * r
    d += ` L ${t1x} ${t1y} Q ${b.x} ${b.y} ${t2x} ${t2y}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

/* --------------------------------------------------------------------------
 * Public: build a manual path through waypoints
 * -------------------------------------------------------------------------- */

/**
 * Build an SVG path string for a connector with manual waypoints.
 *
 * @param {'fluid' | 'orthogonal'} style
 * @param {{x,y}} startPt
 * @param {string} startAnchor
 * @param {{x,y}} endPt
 * @param {string} endAnchor
 * @param {Array<{dx,dy,tHint?,orientation?}>} waypoints
 * @param {Object} [opts] — { radius?: number }
 * @returns {string} SVG path 'd' attribute
 */
export function buildManualPath(style, startPt, startAnchor, endPt, endAnchor, waypoints, opts = {}) {
  const wpAbs = resolveWaypoints(startPt, waypoints || [])
  if (wpAbs.length === 0) {
    // Degenerate manual: no waypoints. Caller should fall back to auto path,
    // but be defensive: render a straight line.
    return `M ${startPt.x} ${startPt.y} L ${endPt.x} ${endPt.y}`
  }

  const allPts = [startPt, ...wpAbs, endPt]

  if (style === 'orthogonal') {
    // Decide first segment orientation from start anchor:
    //   left/right anchors → first segment is horizontal
    //   top/bottom anchors → first segment is vertical
    const firstOrient = (startAnchor === 'top' || startAnchor === 'bottom') ? 'v' : 'h'
    const ortho = orthogonalize(allPts, firstOrient)
    return roundedPolylinePath(ortho, opts.radius ?? DEFAULT_CORNER_RADIUS)
  }

  // Fluid: smooth curve through points. We add tiny anchor stubs at start/end
  // so the curve leaves/enters perpendicular to widget edges.
  const stub = 8
  const startStub = projectAnchorStub(startPt, startAnchor, stub)
  const endStub = projectAnchorStub(endPt, endAnchor, stub)
  const fluidPts = [startPt, startStub, ...wpAbs, endStub, endPt]
  return catmullRomPath(fluidPts)
}

/* --------------------------------------------------------------------------
 * Hit testing & segment helpers (used by drag interactions in CanvasPage)
 * -------------------------------------------------------------------------- */

/**
 * Compute the polyline point sequence for a manual orthogonal path.
 * Useful for hit testing segments to support drag.
 */
export function getOrthogonalPolyline(startPt, startAnchor, endPt, waypoints) {
  const wpAbs = resolveWaypoints(startPt, waypoints || [])
  const allPts = [startPt, ...wpAbs, endPt]
  const firstOrient = (startAnchor === 'top' || startAnchor === 'bottom') ? 'v' : 'h'
  return orthogonalize(allPts, firstOrient)
}

/**
 * Find which segment of a polyline contains a point (within tolerance).
 * Returns the index i such that the segment from pts[i] to pts[i+1] is
 * closest to `pt`, or -1 if no segment is within tolerance.
 */
export function findSegmentAtPoint(polyline, pt, tolerance = 8) {
  let bestIdx = -1
  let bestDist = tolerance
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    const d = distanceToSegment(pt, a, b)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

/**
 * Compute the orientation of a segment: 'h' (horizontal), 'v' (vertical), or
 * 'd' (diagonal).
 */
export function segmentOrientation(a, b) {
  if (a.y === b.y) return 'h'
  if (a.x === b.x) return 'v'
  return 'd'
}

/**
 * Distance from a point to a line segment.
 */
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

/**
 * Test whether a manual connector path falls within a selection rectangle.
 * Samples the resolved polyline (fluid: anchors+waypoints; orthogonal: orthogonalized).
 */
export function manualConnectorIntersectsRect(style, startPt, startAnchor, endPt, waypoints, rect) {
  const polyline = style === 'orthogonal'
    ? getOrthogonalPolyline(startPt, startAnchor, endPt, waypoints)
    : [startPt, ...resolveWaypoints(startPt, waypoints || []), endPt]

  const rRight = rect.x + rect.width
  const rBottom = rect.y + rect.height
  const samplesPerSegment = 8

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    for (let s = 0; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      if (x >= rect.x && x <= rRight && y >= rect.y && y <= rBottom) {
        return true
      }
    }
  }
  return false
}
