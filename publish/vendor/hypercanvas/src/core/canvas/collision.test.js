import { describe, it, expect } from 'vitest'
import {
  getWidgetBounds,
  computeWidgetBounds,
  stampBounds,
  stampBoundsAll,
  rectsOverlap,
  findCollision,
  findCollisions,
  snapToGrid,
  findFreePosition,
  resolvePosition,
  DEFAULT_SIZES,
} from './collision.js'

describe('getWidgetBounds', () => {
  it('uses position and props dimensions', () => {
    const widget = {
      type: 'sticky-note',
      position: { x: 100, y: 200 },
      props: { width: 300, height: 180 },
    }
    expect(getWidgetBounds(widget)).toEqual({
      x: 100,
      y: 200,
      width: 300,
      height: 180,
    })
  })

  it('falls back to default sizes when props missing', () => {
    const widget = {
      type: 'sticky-note',
      position: { x: 50, y: 50 },
      props: {},
    }
    expect(getWidgetBounds(widget)).toEqual({
      x: 50,
      y: 50,
      width: DEFAULT_SIZES['sticky-note'].width,
      height: DEFAULT_SIZES['sticky-note'].height,
    })
  })

  it('handles missing position and props', () => {
    const widget = { type: 'markdown' }
    expect(getWidgetBounds(widget)).toEqual({
      x: 0,
      y: 0,
      width: DEFAULT_SIZES['markdown'].width,
      height: DEFAULT_SIZES['markdown'].height,
    })
  })

  it('uses generic fallback for unknown widget types', () => {
    const widget = { type: 'unknown-type', position: { x: 10, y: 20 } }
    expect(getWidgetBounds(widget)).toEqual({
      x: 10,
      y: 20,
      width: 270,
      height: 170,
    })
  })

  it('resolves story widget type from DEFAULT_SIZES', () => {
    const widget = { type: 'story', position: { x: 0, y: 0 }, props: {} }
    expect(getWidgetBounds(widget)).toEqual({
      x: 0, y: 0,
      width: DEFAULT_SIZES['story'].width,
      height: DEFAULT_SIZES['story'].height,
    })
  })

  it('resolves codepen-embed widget type from DEFAULT_SIZES', () => {
    const widget = { type: 'codepen-embed', position: { x: 0, y: 0 }, props: {} }
    expect(getWidgetBounds(widget)).toEqual({
      x: 0, y: 0,
      width: DEFAULT_SIZES['codepen-embed'].width,
      height: DEFAULT_SIZES['codepen-embed'].height,
    })
  })
})

describe('rectsOverlap', () => {
  it('returns true for overlapping rects', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 50, width: 100, height: 100 }
    expect(rectsOverlap(a, b)).toBe(true)
  })

  it('returns false for non-overlapping rects (side by side)', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 100, y: 0, width: 100, height: 100 }
    expect(rectsOverlap(a, b)).toBe(false)
  })

  it('returns false for non-overlapping rects (stacked)', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 0, y: 100, width: 100, height: 100 }
    expect(rectsOverlap(a, b)).toBe(false)
  })

  it('returns true when one rect contains another', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 }
    const b = { x: 50, y: 50, width: 50, height: 50 }
    expect(rectsOverlap(a, b)).toBe(true)
  })

  it('returns true for rects that share an edge partially', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 0, width: 100, height: 100 }
    expect(rectsOverlap(a, b)).toBe(true)
  })
})

describe('findCollision', () => {
  const widgets = [
    { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 270, height: 170 } },
    { id: 'w2', type: 'sticky-note', position: { x: 300, y: 0 }, props: { width: 270, height: 170 } },
  ]

  it('returns colliding widget', () => {
    const rect = { x: 100, y: 50, width: 270, height: 170 }
    const collision = findCollision(rect, widgets)
    expect(collision?.id).toBe('w1')
  })

  it('returns null when no collision', () => {
    const rect = { x: 0, y: 200, width: 270, height: 170 }
    const collision = findCollision(rect, widgets)
    expect(collision).toBeNull()
  })

  it('excludes specified widget ID', () => {
    // This rect only overlaps w1, not w2 — so excluding w1 means no collision
    const rect = { x: 50, y: 50, width: 200, height: 100 }
    const collision = findCollision(rect, widgets, 'w1')
    expect(collision).toBeNull()
  })
})

describe('findCollisions', () => {
  const widgets = [
    { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 270, height: 170 } },
    { id: 'w2', type: 'sticky-note', position: { x: 200, y: 0 }, props: { width: 270, height: 170 } },
  ]

  it('returns all colliding widgets', () => {
    const rect = { x: 100, y: 50, width: 270, height: 170 }
    const colliders = findCollisions(rect, widgets)
    expect(colliders).toHaveLength(2)
    expect(colliders.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
  })

  it('returns empty array when no collision', () => {
    const rect = { x: 0, y: 200, width: 270, height: 170 }
    expect(findCollisions(rect, widgets)).toEqual([])
  })

  it('excludes specified widget ID', () => {
    const rect = { x: 100, y: 50, width: 270, height: 170 }
    const colliders = findCollisions(rect, widgets, 'w1')
    expect(colliders).toHaveLength(1)
    expect(colliders[0].id).toBe('w2')
  })
})

describe('snapToGrid', () => {
  it('snaps to nearest grid line', () => {
    expect(snapToGrid(25, 24)).toBe(24)
    expect(snapToGrid(36, 24)).toBe(48)
    expect(snapToGrid(12, 24)).toBe(24) // 12 rounds to 24 (0.5 → 1)
    expect(snapToGrid(11, 24)).toBe(0)  // 11 rounds to 0
    expect(snapToGrid(48, 24)).toBe(48)
  })

  it('works with different grid sizes', () => {
    expect(snapToGrid(15, 10)).toBe(20)
    expect(snapToGrid(14, 10)).toBe(10)
  })
})

describe('findFreePosition', () => {
  it('returns original position when no collision', () => {
    const widgets = []
    const result = findFreePosition({
      x: 100,
      y: 100,
      width: 270,
      height: 170,
      widgets,
      gridSize: 24,
    })
    expect(result).toEqual({ x: 96, y: 96, adjusted: false })
  })

  it('moves right to avoid collision', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 270, height: 170 } },
    ]
    const result = findFreePosition({
      x: 0,
      y: 0,
      width: 270,
      height: 170,
      widgets,
      gridSize: 24,
    })
    // Should move right: 270 (width) + 24 (gap) = 294, snapped to 288 or 312
    expect(result.x).toBeGreaterThanOrEqual(288)
    expect(result.y).toBe(0)
    expect(result.adjusted).toBe(true)
  })

  it('moves down when rightward movement exhausted', () => {
    // Create a row of widgets that blocks rightward movement
    const widgets = []
    for (let i = 0; i < 10; i++) {
      widgets.push({
        id: `w${i}`,
        type: 'sticky-note',
        position: { x: i * 300, y: 0 },
        props: { width: 270, height: 170 },
      })
    }
    const result = findFreePosition({
      x: 0,
      y: 0,
      width: 270,
      height: 170,
      widgets,
      gridSize: 24,
      maxIterations: 5, // Force early switch to vertical
    })
    // After exhausting horizontal, should move down
    expect(result.adjusted).toBe(true)
  })

  it('respects excludeId parameter', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 270, height: 170 } },
    ]
    const result = findFreePosition({
      x: 0,
      y: 0,
      width: 270,
      height: 170,
      widgets,
      excludeId: 'w1',
      gridSize: 24,
    })
    // Should stay at original position since w1 is excluded
    expect(result).toEqual({ x: 0, y: 0, adjusted: false })
  })

  it('handles chain of collisions', () => {
    // Two widgets next to each other
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 270, height: 170 } },
      { id: 'w2', type: 'sticky-note', position: { x: 294, y: 0 }, props: { width: 270, height: 170 } },
    ]
    const result = findFreePosition({
      x: 0,
      y: 0,
      width: 270,
      height: 170,
      widgets,
      gridSize: 24,
    })
    // Should move past both widgets
    expect(result.x).toBeGreaterThan(294 + 270)
    expect(result.adjusted).toBe(true)
  })

  it('preferAxis: "vertical" cascades down past colliders instead of right', () => {
    // Simulates a hub fan-out: a leader on the left, two peers already placed
    // above-right and below-right, then trying to place a third peer at the
    // `right` direction (same column as the existing peers, leader-top y).
    const widgets = [
      { id: 'leader',      type: 'sticky-note', position: { x: 0,   y: 0 },   props: { width: 200, height: 200 } },
      { id: 'above-right', type: 'sticky-note', position: { x: 240, y: -100 }, props: { width: 200, height: 200 } },
      { id: 'below-right', type: 'sticky-note', position: { x: 240, y: 200 },  props: { width: 200, height: 200 } },
    ]
    const result = findFreePosition({
      x: 240,
      y: 0,
      width: 200,
      height: 200,
      widgets,
      gridSize: 24,
      preferAxis: 'vertical',
    })
    // Should cascade DOWN past the above-right and below-right widgets,
    // staying in the same X column as the fan, NOT jump far to the right.
    expect(result.x).toBe(240)
    expect(result.y).toBeGreaterThanOrEqual(200 + 200) // past below-right's endY
    expect(result.adjusted).toBe(true)
  })

  it('preferAxis: "horizontal" (default) still resolves rightward', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 200, height: 200 } },
    ]
    const result = findFreePosition({
      x: 50, y: 50,
      width: 200, height: 200,
      widgets,
      gridSize: 24,
    })
    expect(result.x).toBeGreaterThanOrEqual(200)
    expect(result.y).toBe(48) // snapped from 50
  })
})

describe('resolvePosition', () => {
  it('uses widget type defaults', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} },
    ]
    const result = resolvePosition({
      x: 0,
      y: 0,
      type: 'sticky-note',
      widgets,
      gridSize: 24,
    })
    // Should detect collision and move
    expect(result.adjusted).toBe(true)
    expect(result.x).toBeGreaterThan(0)
  })

  it('uses custom props dimensions', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 100, height: 100 } },
    ]
    const result = resolvePosition({
      x: 0,
      y: 0,
      type: 'sticky-note',
      props: { width: 50, height: 50 },
      widgets,
      gridSize: 24,
    })
    // Should collide with w1 at (0,0) even though new widget is smaller
    expect(result.adjusted).toBe(true)
  })

  it('returns snapped position when no collision', () => {
    const result = resolvePosition({
      x: 500,
      y: 500,
      type: 'markdown',
      widgets: [],
      gridSize: 24,
    })
    expect(result).toEqual({ x: 504, y: 504, adjusted: false })
  })
})

describe('computeWidgetBounds', () => {
  it('computes bounds from position and size', () => {
    const widget = { type: 'sticky-note', position: { x: 100, y: 200 }, props: { width: 270, height: 170 } }
    expect(computeWidgetBounds(widget)).toEqual({
      width: 270, height: 170,
      startX: 100, startY: 200,
      endX: 370, endY: 370,
    })
  })

  it('uses defaults when props missing', () => {
    const widget = { type: 'sticky-note', position: { x: 0, y: 0 }, props: {} }
    expect(computeWidgetBounds(widget)).toEqual({
      width: 270, height: 170,
      startX: 0, startY: 0,
      endX: 270, endY: 170,
    })
  })
})

describe('stampBounds', () => {
  it('adds bounds field to widget', () => {
    const widget = { id: 'w1', type: 'sticky-note', position: { x: 48, y: 24 }, props: { width: 270, height: 170 } }
    const stamped = stampBounds(widget)
    expect(stamped.bounds).toEqual({
      width: 270, height: 170,
      startX: 48, startY: 24,
      endX: 318, endY: 194,
    })
    expect(stamped.id).toBe('w1')
  })

  it('does not mutate original widget', () => {
    const widget = { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} }
    stampBounds(widget)
    expect(widget.bounds).toBeUndefined()
  })
})

describe('stampBoundsAll', () => {
  it('stamps bounds on all widgets', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 270, height: 170 } },
      { id: 'w2', type: 'markdown', position: { x: 300, y: 0 }, props: { width: 530, height: 240 } },
    ]
    const stamped = stampBoundsAll(widgets)
    expect(stamped).toHaveLength(2)
    expect(stamped[0].bounds.endX).toBe(270)
    expect(stamped[1].bounds.endX).toBe(830)
  })
})
