import { describe, expect, it, afterEach } from 'vitest'
import { isResizable, getFeatures, getWidgetMeta, isEditableInProduction } from './widgetConfig.js'
import { initCanvasConfig, _resetCanvasConfig } from '../../../core/stores/canvasConfig.js'

describe('isResizable', () => {
  // Vitest runs in dev mode by default (import.meta.env.PROD = false)
  // In dev mode, all resize-enabled widgets are resizable
  it('returns true for resize-enabled widgets in dev mode', () => {
    expect(isResizable('sticky-note')).toBe(true)
    expect(isResizable('prototype')).toBe(true)
    expect(isResizable('figma-embed')).toBe(true)
    expect(isResizable('image')).toBe(true)
    expect(isResizable('component')).toBe(true)
  })

  it('returns false for link-preview (resize disabled)', () => {
    expect(isResizable('link-preview')).toBe(false)
  })

  it('returns true for markdown (resize enabled, dev only)', () => {
    expect(isResizable('markdown')).toBe(true)
  })

  it('returns false for unknown widget types', () => {
    expect(isResizable('nonexistent')).toBe(false)
  })
})

describe('getFeatures', () => {
  it('returns features array for known widget types', () => {
    const features = getFeatures('sticky-note')
    expect(Array.isArray(features)).toBe(true)
    expect(features.length).toBeGreaterThan(0)
  })

  it('returns empty array for unknown widget types', () => {
    expect(getFeatures('nonexistent')).toEqual([])
  })

  it('returns only prod features when isLocalDev is false', () => {
    const features = getFeatures('figma-embed', { isLocalDev: false })
    expect(features.length).toBeGreaterThan(0)
    expect(features.every(f => f.prod === true)).toBe(true)
  })

  it('returns all features when isLocalDev is true (default)', () => {
    const allFeatures = getFeatures('figma-embed')
    const prodFeatures = getFeatures('figma-embed', { isLocalDev: false })
    expect(allFeatures.length).toBeGreaterThan(prodFeatures.length)
  })

  it('includes menu-only prod features when isLocalDev is false', () => {
    const features = getFeatures('figma-embed', { isLocalDev: false })
    const menuFeature = features.find(f => f.menu)
    expect(menuFeature).toBeDefined()
    expect(menuFeature.prod).toBe(true)
  })
})

describe('getWidgetMeta', () => {
  it('returns label and icon for known types', () => {
    const meta = getWidgetMeta('sticky-note')
    expect(meta).toEqual({ label: 'Sticky Note', icon: 'sticky-note' })
  })

  it('returns null for unknown types', () => {
    expect(getWidgetMeta('nonexistent')).toBeNull()
  })
})

describe('isEditableInProduction', () => {
  afterEach(() => {
    _resetCanvasConfig()
  })

  it('returns false by default for markdown and sticky-note', () => {
    expect(isEditableInProduction('markdown')).toBe(false)
    expect(isEditableInProduction('sticky-note')).toBe(false)
  })

  it('returns false for unrelated widget types regardless of config', () => {
    initCanvasConfig({ production: { editMarkdown: true, editSticky: true } })
    expect(isEditableInProduction('prototype')).toBe(false)
    expect(isEditableInProduction('image')).toBe(false)
    expect(isEditableInProduction('unknown')).toBe(false)
  })

  it('opts markdown into production editing when editMarkdown is true', () => {
    initCanvasConfig({ production: { editMarkdown: true } })
    expect(isEditableInProduction('markdown')).toBe(true)
    expect(isEditableInProduction('sticky-note')).toBe(false)
  })

  it('opts sticky-note into production editing when editSticky is true', () => {
    initCanvasConfig({ production: { editSticky: true } })
    expect(isEditableInProduction('sticky-note')).toBe(true)
    expect(isEditableInProduction('markdown')).toBe(false)
  })
})
