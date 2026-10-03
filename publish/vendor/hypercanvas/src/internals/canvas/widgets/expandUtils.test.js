import { describe, it, expect } from 'vitest'
import { assignToQuadrants, buildSplitLayout } from './expandUtils.js'

describe('assignToQuadrants', () => {
  it('assigns 2 items to left/right columns', () => {
    const result = assignToQuadrants([
      { x: 100, y: 200, data: 'A' },
      { x: 500, y: 200, data: 'B' },
    ])
    // centroid.y = 200 = both y values, so both get 'b' row (>= centroid)
    expect(result.bl).toBe('A')
    expect(result.br).toBe('B')
    expect(result.tl).toBeNull()
    expect(result.tr).toBeNull()
  })

  it('assigns 2 items stacked vertically to top/bottom in same column', () => {
    const result = assignToQuadrants([
      { x: 100, y: 100, data: 'A' },
      { x: 100, y: 500, data: 'B' },
    ])
    // Both same x → degenerate x, but different y
    // centroid = (100, 300). A.y=100 < 300 → top, B.y=500 >= 300 → bottom
    // A.x=100 is NOT < centroid.x=100, so both go to 'r'
    // → tr='A', br='B'
    expect(result.tr).toBe('A')
    expect(result.br).toBe('B')
  })

  it('assigns 4 items to all quadrants', () => {
    const result = assignToQuadrants([
      { x: 100, y: 100, data: 'TL' },
      { x: 500, y: 100, data: 'TR' },
      { x: 100, y: 500, data: 'BL' },
      { x: 500, y: 500, data: 'BR' },
    ])
    expect(result.tl).toBe('TL')
    expect(result.tr).toBe('TR')
    expect(result.bl).toBe('BL')
    expect(result.br).toBe('BR')
  })

  it('assigns 3 items: 2 in left column, 1 in right', () => {
    const result = assignToQuadrants([
      { x: 100, y: 100, data: 'TL' },
      { x: 100, y: 500, data: 'BL' },
      { x: 500, y: 300, data: 'R' },
    ])
    // centroid x = (100+100+500)/3 ≈ 233, y = (100+500+300)/3 = 300
    // TL: x=100 < 233 → l, y=100 < 300 → t → tl
    // BL: x=100 < 233 → l, y=500 >= 300 → b → bl
    // R: x=500 >= 233 → r, y=300 >= 300 → b → br
    expect(result.tl).toBe('TL')
    expect(result.bl).toBe('BL')
    expect(result.br).toBe('R')
  })

  it('cycles TL→TR→BL→BR when all positions are identical', () => {
    const result = assignToQuadrants([
      { x: 0, y: 0, data: 'A' },
      { x: 0, y: 0, data: 'B' },
      { x: 0, y: 0, data: 'C' },
    ])
    expect(result.tl).toBe('A')
    expect(result.tr).toBe('B')
    expect(result.bl).toBe('C')
    expect(result.br).toBeNull()
  })

  it('handles overflow: 2 items in same quadrant', () => {
    // Two items very close, both land in same quadrant → overflow redistributes
    const result = assignToQuadrants([
      { x: 100, y: 100, data: 'A' },
      { x: 110, y: 110, data: 'B' },
      { x: 500, y: 500, data: 'C' },
    ])
    // centroid = (236, 236). A: x<236 y<236 → tl. B: x<236 y<236 → tl (overflow!)
    // C: x>=236 y>=236 → br
    // A wins tl, B overflows to first empty slot (tr)
    expect(result.tl).toBe('A')
    expect(result.br).toBe('C')
    // B goes to overflow → first empty slot (tr)
    expect(result.tr).toBe('B')
  })

  it('returns all nulls for empty input', () => {
    const result = assignToQuadrants([])
    expect(result.tl).toBeNull()
    expect(result.tr).toBeNull()
    expect(result.bl).toBeNull()
    expect(result.br).toBeNull()
  })
})

describe('buildSplitLayout', () => {
  function mockPaneFn(widget) {
    return { id: widget.id, label: widget.id, kind: 'react', render: () => null }
  }

  it('returns single column for 1 widget (no connected)', () => {
    const primary = { id: 'a', type: 'terminal', position: { x: 0, y: 0 }, props: {} }
    const layout = buildSplitLayout(primary, [], mockPaneFn)
    expect(layout.length).toBe(1)
    expect(layout[0].length).toBe(1)
    expect(layout[0][0].id).toBe('a')
  })

  it('returns 2 columns for 2 horizontally-spaced widgets', () => {
    const primary = { id: 'a', type: 'terminal', position: { x: 0, y: 100 }, props: {} }
    const connected = [
      { id: 'b', type: 'prototype', position: { x: 500, y: 100 }, props: {} },
    ]
    const layout = buildSplitLayout(primary, connected, mockPaneFn)
    expect(layout.length).toBe(2)
    expect(layout[0].length).toBe(1) // left column
    expect(layout[1].length).toBe(1) // right column
  })

  it('returns 2 columns with row split for 3 widgets', () => {
    const primary = { id: 'a', type: 'terminal', position: { x: 0, y: 0 }, props: {} }
    const connected = [
      { id: 'b', type: 'prototype', position: { x: 500, y: 0 }, props: {} },
      { id: 'c', type: 'markdown', position: { x: 500, y: 500 }, props: {} },
    ]
    const layout = buildSplitLayout(primary, connected, mockPaneFn)
    const totalPanes = layout.flat().length
    expect(totalPanes).toBe(3)
    // One column should have 2 panes (row split)
    const hasRowSplit = layout.some((col) => col.length === 2)
    expect(hasRowSplit).toBe(true)
  })

  it('returns 2×2 grid for 4 widgets', () => {
    const primary = { id: 'a', type: 'terminal', position: { x: 0, y: 0 }, props: {} }
    const connected = [
      { id: 'b', type: 'prototype', position: { x: 500, y: 0 }, props: {} },
      { id: 'c', type: 'markdown', position: { x: 0, y: 500 }, props: {} },
      { id: 'd', type: 'agent', position: { x: 500, y: 500 }, props: {} },
    ]
    const layout = buildSplitLayout(primary, connected, mockPaneFn)
    expect(layout.length).toBe(2)
    expect(layout[0].length).toBe(2)
    expect(layout[1].length).toBe(2)
  })

  it('skips widgets where buildPaneFn returns null', () => {
    const primary = { id: 'a', type: 'terminal', position: { x: 0, y: 0 }, props: {} }
    const connected = [
      { id: 'b', type: 'unknown', position: { x: 500, y: 0 }, props: {} },
    ]
    const paneFn = (w) => w.id === 'a' ? mockPaneFn(w) : null
    const layout = buildSplitLayout(primary, connected, paneFn)
    expect(layout.flat().length).toBe(1)
  })
})
