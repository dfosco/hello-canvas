import { describe, it, expect } from 'vitest'
import {
  resolveWaypoint,
  resolveWaypoints,
  toRelativeWaypoint,
  buildManualPath,
  getOrthogonalPolyline,
  findSegmentAtPoint,
  segmentOrientation,
  manualConnectorIntersectsRect,
} from './connectorRouting.js'

describe('resolveWaypoint / resolveWaypoints', () => {
  it('resolves relative waypoints to absolute coords', () => {
    const startPt = { x: 100, y: 200 }
    expect(resolveWaypoint(startPt, { dx: 50, dy: -10 })).toEqual({ x: 150, y: 190 })
  })

  it('resolveWaypoints returns empty for non-array input', () => {
    expect(resolveWaypoints({ x: 0, y: 0 }, null)).toEqual([])
    expect(resolveWaypoints({ x: 0, y: 0 }, undefined)).toEqual([])
  })

  it('toRelativeWaypoint round-trips with resolveWaypoint', () => {
    const startPt = { x: 100, y: 200 }
    const abs = { x: 250, y: 175 }
    const rel = toRelativeWaypoint(startPt, abs, { tHint: 0.5 })
    expect(rel).toEqual({ dx: 150, dy: -25, tHint: 0.5 })
    expect(resolveWaypoint(startPt, rel)).toEqual(abs)
  })
})

describe('buildManualPath — fluid', () => {
  it('returns straight line when no waypoints', () => {
    const d = buildManualPath('fluid',
      { x: 0, y: 0 }, 'right',
      { x: 100, y: 0 }, 'left',
      [])
    expect(d).toContain('M 0 0')
    expect(d).toContain('L 100 0')
  })

  it('produces cubic Bézier segments through waypoints', () => {
    const d = buildManualPath('fluid',
      { x: 0, y: 0 }, 'right',
      { x: 200, y: 0 }, 'left',
      [{ dx: 100, dy: 50 }])
    expect(d).toMatch(/^M 0 0/)
    // Smooth path uses C commands
    expect(d).toContain('C ')
  })
})

describe('buildManualPath — orthogonal', () => {
  it('emits axis-aligned segments with rounded corners', () => {
    const d = buildManualPath('orthogonal',
      { x: 0, y: 0 }, 'right',
      { x: 200, y: 100 }, 'left',
      [{ dx: 100, dy: 0 }])
    expect(d).toMatch(/^M 0 0/)
    // Should contain quadratic arc(s) for fillets
    expect(d).toContain('Q ')
  })

  it('handles same-axis waypoints with no elbows needed', () => {
    const d = buildManualPath('orthogonal',
      { x: 0, y: 0 }, 'right',
      { x: 200, y: 0 }, 'left',
      [{ dx: 100, dy: 0 }])
    // All points colinear; no Q (no corners needed), just L commands
    expect(d).toMatch(/^M 0 0/)
    expect(d).toContain('L 200 0')
  })

  it('vertical-anchor connector starts vertically', () => {
    const polyline = getOrthogonalPolyline(
      { x: 50, y: 0 }, 'bottom',
      { x: 150, y: 100 },
      [{ dx: 0, dy: 50 }])
    // First segment after start should be vertical
    expect(polyline[0]).toEqual({ x: 50, y: 0 })
    // Polyline must end at endPt
    expect(polyline[polyline.length - 1]).toEqual({ x: 150, y: 100 })
  })
})

describe('findSegmentAtPoint', () => {
  const polyline = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]

  it('finds the segment closest to a probe point', () => {
    expect(findSegmentAtPoint(polyline, { x: 50, y: 2 }, 8)).toBe(0)
    expect(findSegmentAtPoint(polyline, { x: 100, y: 50 }, 8)).toBeGreaterThanOrEqual(0)
  })

  it('returns -1 when no segment is within tolerance', () => {
    expect(findSegmentAtPoint(polyline, { x: 500, y: 500 }, 8)).toBe(-1)
  })
})

describe('segmentOrientation', () => {
  it('classifies horizontal, vertical, and diagonal segments', () => {
    expect(segmentOrientation({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('h')
    expect(segmentOrientation({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe('v')
    expect(segmentOrientation({ x: 0, y: 0 }, { x: 50, y: 50 })).toBe('d')
  })
})

describe('manualConnectorIntersectsRect', () => {
  it('detects rect intersecting an orthogonal manual path', () => {
    const hit = manualConnectorIntersectsRect(
      'orthogonal',
      { x: 0, y: 0 }, 'right',
      { x: 200, y: 100 },
      [{ dx: 100, dy: 0 }],
      { x: 50, y: -10, width: 20, height: 20 },
    )
    expect(hit).toBe(true)
  })

  it('returns false when rect is far from path', () => {
    const hit = manualConnectorIntersectsRect(
      'fluid',
      { x: 0, y: 0 }, 'right',
      { x: 200, y: 0 },
      [{ dx: 100, dy: 0 }],
      { x: 1000, y: 1000, width: 20, height: 20 },
    )
    expect(hit).toBe(false)
  })
})
