import { describe, it, expect, beforeEach } from 'vitest'
import {
  initServerWidgets,
  registerServerWidget,
  getServerWidgetDefinition,
  getAllServerWidgetDefinitions,
  _resetServerWidgets,
} from './customWidgets.js'

describe('customWidgets (server-side registry)', () => {
  beforeEach(() => {
    _resetServerWidgets()
  })

  it('falls back to built-in widgets.config.json when nothing registered', () => {
    const sticky = getServerWidgetDefinition('sticky-note')
    expect(sticky).toBeTruthy()
    expect(sticky.label).toBeTruthy()
  })

  it('returns null for unknown widget types', () => {
    expect(getServerWidgetDefinition('does-not-exist')).toBeNull()
  })

  it('registerServerWidget adds a consumer entry', () => {
    registerServerWidget('my-thing', { label: 'My Thing', props: { width: { type: 'number', default: 400 } } })
    const def = getServerWidgetDefinition('my-thing')
    expect(def?.label).toBe('My Thing')
    expect(def?.props.width.default).toBe(400)
  })

  it('consumer entry overrides built-in entry for the same type', () => {
    registerServerWidget('sticky-note', { label: 'Custom Sticky', props: { width: { default: 999 } } })
    const def = getServerWidgetDefinition('sticky-note')
    expect(def.label).toBe('Custom Sticky')
    expect(def.props.width.default).toBe(999)
  })

  it('initServerWidgets replaces all consumer entries', () => {
    registerServerWidget('a', { label: 'A' })
    initServerWidgets({ b: { label: 'B' } })
    expect(getServerWidgetDefinition('a')).not.toEqual({ label: 'A' })
    // 'a' may still resolve to a core entry if one exists; here it doesn't,
    // so it falls back to null
    expect(getServerWidgetDefinition('a')).toBeNull()
    expect(getServerWidgetDefinition('b')).toEqual({ label: 'B' })
  })

  it('initServerWidgets accepts null/undefined to clear', () => {
    registerServerWidget('a', { label: 'A' })
    initServerWidgets(null)
    expect(getServerWidgetDefinition('a')).toBeNull()
    initServerWidgets({ x: { label: 'X' } })
    initServerWidgets(undefined)
    expect(getServerWidgetDefinition('x')).toBeNull()
  })

  it('getAllServerWidgetDefinitions includes both built-ins and consumer entries', () => {
    registerServerWidget('my-thing', { label: 'My Thing' })
    const all = getAllServerWidgetDefinitions()
    expect(all['my-thing']?.label).toBe('My Thing')
    expect(all['sticky-note']).toBeTruthy() // built-in still present
  })

  it('registerServerWidget throws on invalid input', () => {
    expect(() => registerServerWidget('', {})).toThrow(/non-empty string/)
    expect(() => registerServerWidget('foo', null)).toThrow(/must be an object/)
  })
})
