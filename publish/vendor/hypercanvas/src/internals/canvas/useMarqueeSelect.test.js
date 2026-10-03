import { describe, it, expect } from 'vitest'
import { rectsIntersect, getWidgetBounds, getConnectedWidgetIds } from './useMarqueeSelect.js'

describe('rectsIntersect', () => {
  it('returns true for overlapping rectangles', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 50, width: 100, height: 100 }
    expect(rectsIntersect(a, b)).toBe(true)
  })

  it('returns false for non-overlapping rectangles', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 200, y: 200, width: 100, height: 100 }
    expect(rectsIntersect(a, b)).toBe(false)
  })

  it('returns false for edge-touching rectangles (no overlap)', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 100, y: 0, width: 100, height: 100 }
    expect(rectsIntersect(a, b)).toBe(false)
  })

  it('returns true when one rectangle contains the other', () => {
    const a = { x: 0, y: 0, width: 200, height: 200 }
    const b = { x: 50, y: 50, width: 50, height: 50 }
    expect(rectsIntersect(a, b)).toBe(true)
  })

  it('returns true for partial horizontal overlap', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 0, width: 100, height: 50 }
    expect(rectsIntersect(a, b)).toBe(true)
  })
})

describe('getWidgetBounds', () => {
  const fallbackSizes = {
    'sticky-note': { width: 270, height: 170 },
    'component': { width: 200, height: 150 },
  }

  it('returns bounds for JSON widgets', () => {
    const widgets = [
      { id: 'w1', type: 'sticky-note', position: { x: 10, y: 20 }, props: { width: 300, height: 200 } },
      { id: 'w2', type: 'sticky-note', position: { x: 100, y: 200 }, props: {} },
    ]
    const result = getWidgetBounds(widgets, [], fallbackSizes)
    expect(result).toEqual([
      { id: 'w1', x: 10, y: 20, width: 300, height: 200 },
      { id: 'w2', x: 100, y: 200, width: 270, height: 170 },
    ])
  })

  it('returns bounds for component entries', () => {
    const entries = [
      { exportName: 'MyComp', sourceData: { position: { x: 5, y: 10 }, width: 400, height: 300 } },
    ]
    const result = getWidgetBounds([], entries, fallbackSizes)
    expect(result).toEqual([
      { id: 'jsx-MyComp', x: 5, y: 10, width: 400, height: 300 },
    ])
  })

  it('handles null/missing widget data gracefully', () => {
    const widgets = [
      { id: 'w1', type: 'unknown' },
    ]
    const result = getWidgetBounds(widgets, [], fallbackSizes)
    expect(result).toEqual([
      { id: 'w1', x: 0, y: 0, width: 200, height: 150 },
    ])
  })

  it('handles null widgets array', () => {
    const result = getWidgetBounds(null, [], fallbackSizes)
    expect(result).toEqual([])
  })
})

describe('getConnectedWidgetIds', () => {
  it('walks the complete connected component from connector endpoints', () => {
    const connectors = [
      { start: { widgetId: 'a' }, end: { widgetId: 'b' } },
      { start: { widgetId: 'b' }, end: { widgetId: 'c' } },
      { start: { widgetId: 'x' }, end: { widgetId: 'y' } },
    ]
    expect(getConnectedWidgetIds(connectors, new Set(['a']))).toEqual(new Set(['a', 'b', 'c']))
  })
})
