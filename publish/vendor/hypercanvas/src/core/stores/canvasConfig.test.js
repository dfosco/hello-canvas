import { describe, it, expect, beforeEach } from 'vitest'
import { initCanvasConfig, getPasteRules, isTerminalResizable, getTerminalDimensions, getCanvasProduction, isCanvasProductionEnabled, _resetCanvasConfig } from './canvasConfig.js'

describe('canvasConfig', () => {
  beforeEach(() => {
    _resetCanvasConfig()
  })

  it('returns empty array by default', () => {
    expect(getPasteRules()).toEqual([])
  })

  it('stores paste rules from config', () => {
    const rules = [
      { pattern: 'youtube\\.com', type: 'link-preview', props: { url: '$url' } },
    ]
    initCanvasConfig({ pasteRules: rules })
    expect(getPasteRules()).toEqual(rules)
  })

  it('handles missing pasteRules gracefully', () => {
    initCanvasConfig({})
    expect(getPasteRules()).toEqual([])
  })

  it('handles undefined config', () => {
    initCanvasConfig()
    expect(getPasteRules()).toEqual([])
  })

  it('handles non-array pasteRules', () => {
    initCanvasConfig({ pasteRules: 'not-an-array' })
    expect(getPasteRules()).toEqual([])
  })

  it('resets on _resetCanvasConfig', () => {
    initCanvasConfig({ pasteRules: [{ pattern: '.', type: 'test' }] })
    expect(getPasteRules()).toHaveLength(1)
    _resetCanvasConfig()
    expect(getPasteRules()).toEqual([])
  })
})

describe('isTerminalResizable', () => {
  beforeEach(() => {
    _resetCanvasConfig()
  })

  it('returns false by default', () => {
    expect(isTerminalResizable()).toBe(false)
  })

  it('returns terminal.resizable when set', () => {
    initCanvasConfig({ terminal: { resizable: true } })
    expect(isTerminalResizable()).toBe(true)
  })

  it('agent overrides terminal resizable', () => {
    initCanvasConfig({
      terminal: { resizable: false },
      agents: { myAgent: { resizable: true } },
    })
    expect(isTerminalResizable('myAgent')).toBe(true)
    expect(isTerminalResizable()).toBe(false)
  })

  it('agent can disable resizable even when terminal enables it', () => {
    initCanvasConfig({
      terminal: { resizable: true },
      agents: { fixedAgent: { resizable: false } },
    })
    expect(isTerminalResizable('fixedAgent')).toBe(false)
    expect(isTerminalResizable()).toBe(true)
  })

  it('falls back to terminal config for unknown agent', () => {
    initCanvasConfig({ terminal: { resizable: true } })
    expect(isTerminalResizable('nonexistent')).toBe(true)
  })
})

describe('getTerminalDimensions', () => {
  beforeEach(() => {
    _resetCanvasConfig()
  })

  it('returns fallback defaults when no config', () => {
    expect(getTerminalDimensions()).toEqual({ width: 800, height: 450 })
  })

  it('returns terminal config dimensions', () => {
    initCanvasConfig({ terminal: { defaultWidth: 1000, defaultHeight: 600 } })
    expect(getTerminalDimensions()).toEqual({ width: 1000, height: 600 })
  })

  it('agent overrides terminal dimensions', () => {
    initCanvasConfig({
      terminal: { defaultWidth: 1000, defaultHeight: 600 },
      agents: { bigAgent: { defaultWidth: 1400, defaultHeight: 800 } },
    })
    expect(getTerminalDimensions('bigAgent')).toEqual({ width: 1400, height: 800 })
  })

  it('agent partial override inherits from terminal for unset dimensions', () => {
    initCanvasConfig({
      terminal: { defaultWidth: 1000, defaultHeight: 600 },
      agents: { wideAgent: { defaultWidth: 1400 } },
    })
    expect(getTerminalDimensions('wideAgent')).toEqual({ width: 1400, height: 600 })
  })

  it('falls back to terminal config for unknown agent', () => {
    initCanvasConfig({ terminal: { defaultWidth: 900, defaultHeight: 500 } })
    expect(getTerminalDimensions('nonexistent')).toEqual({ width: 900, height: 500 })
  })

  it('uses custom fallback when provided', () => {
    expect(getTerminalDimensions(null, { width: 1200, height: 450 })).toEqual({ width: 1200, height: 450 })
  })
})

describe('getCanvasProduction / isCanvasProductionEnabled', () => {
  beforeEach(() => {
    _resetCanvasConfig()
  })

  it('defaults every production flag to false', () => {
    expect(getCanvasProduction()).toEqual({
      move: false,
      resize: false,
      editMarkdown: false,
      editSticky: false,
    })
    expect(isCanvasProductionEnabled('move')).toBe(false)
    expect(isCanvasProductionEnabled('resize')).toBe(false)
    expect(isCanvasProductionEnabled('editMarkdown')).toBe(false)
    expect(isCanvasProductionEnabled('editSticky')).toBe(false)
  })

  it('seeds production flags from config', () => {
    initCanvasConfig({
      production: { move: true, resize: true, editMarkdown: true, editSticky: false },
    })
    expect(isCanvasProductionEnabled('move')).toBe(true)
    expect(isCanvasProductionEnabled('resize')).toBe(true)
    expect(isCanvasProductionEnabled('editMarkdown')).toBe(true)
    expect(isCanvasProductionEnabled('editSticky')).toBe(false)
  })

  it('coerces truthy non-boolean values to false (strict booleans only)', () => {
    initCanvasConfig({ production: { move: 1, resize: 'yes' } })
    expect(isCanvasProductionEnabled('move')).toBe(false)
    expect(isCanvasProductionEnabled('resize')).toBe(false)
  })

  it('ignores non-object production values', () => {
    initCanvasConfig({ production: null })
    expect(getCanvasProduction()).toEqual({
      move: false, resize: false, editMarkdown: false, editSticky: false,
    })
  })

  it('resets to defaults on _resetCanvasConfig', () => {
    initCanvasConfig({ production: { move: true } })
    expect(isCanvasProductionEnabled('move')).toBe(true)
    _resetCanvasConfig()
    expect(isCanvasProductionEnabled('move')).toBe(false)
  })
})
