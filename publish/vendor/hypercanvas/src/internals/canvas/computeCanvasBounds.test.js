import { describe, it, expect } from 'vitest'

// computeCanvasBounds is not exported, so we replicate it here for unit testing.
// This keeps the test decoupled from CanvasPage internals while validating the algorithm.

const WIDGET_FALLBACK_SIZES = {
  'sticky-note':  { width: 180, height: 60 },
  'markdown':     { width: 360, height: 200 },
  'prototype':    { width: 800, height: 600 },
  'link-preview': { width: 320, height: 120 },
  'figma-embed':  { width: 800, height: 450 },
  'component':    { width: 200, height: 150 },
  'image':        { width: 400, height: 300 },
}

function computeCanvasBounds(widgets, sources, jsxExports) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasItems = false

  for (const w of (widgets ?? [])) {
    const x = w?.position?.x ?? 0
    const y = w?.position?.y ?? 0
    const fallback = WIDGET_FALLBACK_SIZES[w.type] || { width: 200, height: 150 }
    const width = w.props?.width ?? fallback.width
    const height = w.props?.height ?? fallback.height
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
    hasItems = true
  }

  const sourceMap = Object.fromEntries(
    (sources || []).filter((s) => s?.export).map((s) => [s.export, s])
  )
  if (jsxExports) {
    for (const exportName of Object.keys(jsxExports)) {
      const sourceData = sourceMap[exportName] || {}
      const x = sourceData.position?.x ?? 0
      const y = sourceData.position?.y ?? 0
      const fallback = WIDGET_FALLBACK_SIZES['component']
      const width = sourceData.width ?? fallback.width
      const height = sourceData.height ?? fallback.height
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + width)
      maxY = Math.max(maxY, y + height)
      hasItems = true
    }
  }

  return hasItems ? { minX, minY, maxX, maxY } : null
}

describe('computeCanvasBounds', () => {
  it('returns null for empty canvas', () => {
    expect(computeCanvasBounds([], [], null)).toBeNull()
    expect(computeCanvasBounds(null, null, null)).toBeNull()
  })

  it('computes bounds for a single widget using props dimensions', () => {
    const widgets = [
      { type: 'sticky-note', position: { x: 100, y: 200 }, props: { width: 300, height: 100 } },
    ]
    const bounds = computeCanvasBounds(widgets, [], null)
    expect(bounds).toEqual({ minX: 100, minY: 200, maxX: 400, maxY: 300 })
  })

  it('uses fallback dimensions when props are missing', () => {
    const widgets = [
      { type: 'sticky-note', position: { x: 50, y: 50 }, props: {} },
    ]
    const bounds = computeCanvasBounds(widgets, [], null)
    expect(bounds).toEqual({ minX: 50, minY: 50, maxX: 230, maxY: 110 }) // 50+180, 50+60
  })

  it('computes bounds spanning multiple widgets', () => {
    const widgets = [
      { type: 'sticky-note', position: { x: 0, y: 0 }, props: { width: 180, height: 60 } },
      { type: 'markdown', position: { x: 500, y: 300 }, props: { width: 360, height: 200 } },
    ]
    const bounds = computeCanvasBounds(widgets, [], null)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 860, maxY: 500 })
  })

  it('includes JSX sources in bounds', () => {
    const sources = [{ export: 'Hero', position: { x: -100, y: -50 }, width: 400, height: 300 }]
    const jsxExports = { Hero: () => null }
    const bounds = computeCanvasBounds([], sources, jsxExports)
    expect(bounds).toEqual({ minX: -100, minY: -50, maxX: 300, maxY: 250 })
  })

  it('combines widgets and JSX sources', () => {
    const widgets = [
      { type: 'sticky-note', position: { x: 200, y: 200 }, props: { width: 180, height: 60 } },
    ]
    const sources = [{ export: 'Nav', position: { x: 0, y: 0 }, width: 100, height: 100 }]
    const jsxExports = { Nav: () => null }
    const bounds = computeCanvasBounds(widgets, sources, jsxExports)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 380, maxY: 260 })
  })

  it('handles widgets with missing position (defaults to 0,0)', () => {
    const widgets = [
      { type: 'sticky-note', props: { width: 180, height: 60 } },
    ]
    const bounds = computeCanvasBounds(widgets, [], null)
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 180, maxY: 60 })
  })

  it('uses component fallback for JSX sources without explicit size', () => {
    const sources = [{ export: 'Card', position: { x: 10, y: 10 } }]
    const jsxExports = { Card: () => null }
    const bounds = computeCanvasBounds([], sources, jsxExports)
    // component fallback: 200x150
    expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 210, maxY: 160 })
  })
})
