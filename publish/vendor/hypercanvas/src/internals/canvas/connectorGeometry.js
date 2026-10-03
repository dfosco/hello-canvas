import { getConnectorDefaults } from './widgets/widgetConfig.js'

const connectorConfig = getConnectorDefaults()
const CONTROL_OFFSET = connectorConfig.controlOffset

/**
 * Compute the anchor point on a widget's edge.
 * Reads actual DOM dimensions for accuracy (widgets like markdown auto-size).
 * Falls back to props/bounds/defaults if DOM element isn't found.
 */
export function getAnchorPoint(widget, anchor) {
  const x = widget.position?.x ?? 0
  const y = widget.position?.y ?? 0

  let w, h
  const el = typeof document !== 'undefined' ? document.getElementById(widget.id) : null
  if (el) {
    const firstChild = el.querySelector('[data-widget-id]') || el.firstElementChild
    if (firstChild) {
      w = firstChild.offsetWidth
      h = firstChild.offsetHeight
    }
  }
  if (!w) w = widget.props?.width ?? widget.bounds?.width ?? 270
  if (!h) h = widget.props?.height ?? widget.bounds?.height ?? 170

  switch (anchor) {
    case 'top':    return { x: x + w / 2, y }
    case 'bottom': return { x: x + w / 2, y: y + h }
    case 'left':   return { x, y: y + h / 2 }
    case 'right':  return { x: x + w, y: y + h / 2 }
    default:       return { x: x + w / 2, y: y + h / 2 }
  }
}

/**
 * Compute the control point offset direction for an anchor.
 * When `scale` < 1, reduces the offset proportionally (for close widgets).
 */
export function getControlOffset(anchor, scale = 1) {
  const offset = CONTROL_OFFSET * scale
  switch (anchor) {
    case 'top':    return { dx: 0, dy: -offset }
    case 'bottom': return { dx: 0, dy: offset }
    case 'left':   return { dx: -offset, dy: 0 }
    case 'right':  return { dx: offset, dy: 0 }
    default:       return { dx: 0, dy: 0 }
  }
}

/** Threshold distance (3 grid sizes) below which curve bounciness is reduced. */
const CLOSE_THRESHOLD = 24 * 6 // 144px (6 grid sizes)

/**
 * Compute scale factor for control offset based on anchor distance.
 * When anchors are closer than CLOSE_THRESHOLD, reduce bounciness proportionally.
 */
function computeControlScale(dist) {
  if (dist >= CLOSE_THRESHOLD) return 1
  // Scale linearly from 0.15 at dist=0 to 1.0 at dist=CLOSE_THRESHOLD
  // More aggressive minimum (0.15) to prevent S-curves on close widgets
  return 0.15 + (dist / CLOSE_THRESHOLD) * 0.85
}

/**
 * Build a cubic Bézier path string between two anchor points.
 * When `freeEnd` is true, the end control point is computed from
 * the direction vector (end→start) so the curve never bends in
 * front of the cursor during drag.
 *
 * Control offset is scaled down when anchors are close on either axis
 * (< 6 gridSizes) to prevent the curve from bulging and overlapping widgets.
 */
export function buildPath(startPt, startAnchor, endPt, endAnchor, freeEnd = false) {
  const dx = Math.abs(startPt.x - endPt.x)
  const dy = Math.abs(startPt.y - endPt.y)
  // Use minimum of X or Y distance - if either is small, reduce bounce
  const minAxisDist = Math.min(dx, dy)
  const scale = computeControlScale(minAxisDist)

  const c1 = getControlOffset(startAnchor, scale)
  let c2
  if (freeEnd) {
    const fdx = startPt.x - endPt.x
    const fdy = startPt.y - endPt.y
    const dist = Math.hypot(fdx, fdy) || 1
    const freeScale = Math.min(CONTROL_OFFSET * scale, dist * 0.4)
    c2 = { dx: (fdx / dist) * freeScale, dy: (fdy / dist) * freeScale }
  } else {
    c2 = getControlOffset(endAnchor, scale)
  }
  return `M ${startPt.x} ${startPt.y} C ${startPt.x + c1.dx} ${startPt.y + c1.dy}, ${endPt.x + c2.dx} ${endPt.y + c2.dy}, ${endPt.x} ${endPt.y}`
}

/**
 * Evaluate a cubic Bézier curve at parameter t.
 * B(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
 */
function evalCubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const mt2 = mt * mt
  const mt3 = mt2 * mt
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  }
}

/**
 * Resolve a connector's Bézier control points from widget positions.
 * Returns { p0, cp1, cp2, p3 } or null if either widget is missing.
 */
export function getConnectorControlPoints(connector, widgetMap) {
  const startWidget = widgetMap.get(connector.start?.widgetId)
  const endWidget = widgetMap.get(connector.end?.widgetId)
  if (!startWidget || !endWidget) return null

  const p0 = getAnchorPoint(startWidget, connector.start.anchor)
  const p3 = getAnchorPoint(endWidget, connector.end.anchor)
  const c1 = getControlOffset(connector.start.anchor)
  const c2 = getControlOffset(connector.end.anchor)

  return {
    p0,
    cp1: { x: p0.x + c1.dx, y: p0.y + c1.dy },
    cp2: { x: p3.x + c2.dx, y: p3.y + c2.dy },
    p3,
  }
}

/**
 * Test whether any point along a connector's Bézier path falls inside a rect.
 * @param {Object} connector — { start: { widgetId, anchor }, end: { widgetId, anchor } }
 * @param {Map} widgetMap — Map<widgetId, widget>
 * @param {{ x, y, width, height }} rect — axis-aligned selection rectangle
 * @param {number} numSamples — number of evenly-spaced points to test (default 24)
 * @returns {boolean}
 */
export function connectorIntersectsRect(connector, widgetMap, rect, numSamples = 24) {
  const pts = getConnectorControlPoints(connector, widgetMap)
  if (!pts) return false

  const { p0, cp1, cp2, p3 } = pts
  const rRight = rect.x + rect.width
  const rBottom = rect.y + rect.height

  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples
    const pt = evalCubicBezier(p0, cp1, cp2, p3, t)
    if (pt.x >= rect.x && pt.x <= rRight && pt.y >= rect.y && pt.y <= rBottom) {
      return true
    }
  }
  return false
}

const ANCHORS = ['top', 'bottom', 'left', 'right']

/**
 * Get widget bounding box from position and dimensions.
 */
function getWidgetBounds(widget) {
  const x = widget.position?.x ?? 0
  const y = widget.position?.y ?? 0
  let w, h
  const el = typeof document !== 'undefined' ? document.getElementById(widget.id) : null
  if (el) {
    const firstChild = el.querySelector('[data-widget-id]') || el.firstElementChild
    if (firstChild) {
      w = firstChild.offsetWidth
      h = firstChild.offsetHeight
    }
  }
  if (!w) w = widget.props?.width ?? widget.bounds?.width ?? 270
  if (!h) h = widget.props?.height ?? widget.bounds?.height ?? 170
  return { x, y, width: w, height: h }
}

/**
 * Check if a point is inside a rect (with optional margin for edge tolerance).
 */
function pointInRect(pt, rect, margin = 0) {
  return (
    pt.x >= rect.x + margin &&
    pt.x <= rect.x + rect.width - margin &&
    pt.y >= rect.y + margin &&
    pt.y <= rect.y + rect.height - margin
  )
}

/**
 * Check if a Bézier path overlaps with a widget's bounding box.
 * Samples points along the curve and checks for intersection.
 * Skips the first and last 10% of the curve (near anchors).
 */
function pathOverlapsWidget(p0, cp1, cp2, p3, widgetBounds, numSamples = 16) {
  // Sample from t=0.1 to t=0.9 to skip anchor vicinity
  for (let i = 1; i < numSamples; i++) {
    const t = 0.1 + (i / numSamples) * 0.8
    const pt = evalCubicBezier(p0, cp1, cp2, p3, t)
    if (pointInRect(pt, widgetBounds, 8)) {
      return true
    }
  }
  return false
}

/**
 * Find the best anchor pair between two widgets.
 * Considers both distance and overlap avoidance:
 * 1. Prefers paths that don't overlap either widget
 * 2. Among valid paths, picks the shortest
 * 3. Falls back to shortest path if all overlap
 *
 * @param {Object} widgetA — source widget { id, position, props }
 * @param {Object} widgetB — target widget { id, position, props }
 * @returns {{ startAnchor: string, endAnchor: string }}
 */
export function findBestAnchors(widgetA, widgetB) {
  const boundsA = getWidgetBounds(widgetA)
  const boundsB = getWidgetBounds(widgetB)

  const candidates = []

  for (const anchorA of ANCHORS) {
    const ptA = getAnchorPoint(widgetA, anchorA)

    for (const anchorB of ANCHORS) {
      const ptB = getAnchorPoint(widgetB, anchorB)
      const dx = Math.abs(ptA.x - ptB.x)
      const dy = Math.abs(ptA.y - ptB.y)
      const dist = Math.hypot(dx, dy)
      // Use min axis distance for scale (matches buildPath logic)
      const minAxisDist = Math.min(dx, dy)

      // Use same scaling as buildPath for accurate overlap detection
      const scale = computeControlScale(minAxisDist)
      const c1 = getControlOffset(anchorA, scale)
      const c2 = getControlOffset(anchorB, scale)
      const cp1 = { x: ptA.x + c1.dx, y: ptA.y + c1.dy }
      const cp2 = { x: ptB.x + c2.dx, y: ptB.y + c2.dy }

      // Check if path overlaps either widget
      const overlapsA = pathOverlapsWidget(ptA, cp1, cp2, ptB, boundsA)
      const overlapsB = pathOverlapsWidget(ptA, cp1, cp2, ptB, boundsB)

      candidates.push({
        startAnchor: anchorA,
        endAnchor: anchorB,
        dist,
        overlaps: overlapsA || overlapsB,
      })
    }
  }

  // Sort: non-overlapping first, then by distance
  candidates.sort((a, b) => {
    if (a.overlaps !== b.overlaps) return a.overlaps ? 1 : -1
    return a.dist - b.dist
  })

  const best = candidates[0]
  return { startAnchor: best.startAnchor, endAnchor: best.endAnchor }
}
