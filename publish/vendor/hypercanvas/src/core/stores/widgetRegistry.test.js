import { describe, it, expect, beforeEach } from 'vitest'
import {
  initWidgetRegistry,
  registerWidget,
  unregisterWidget,
  getWidgetDefinition,
  getAllWidgetDefinitions,
  subscribeToWidgetRegistry,
  getWidgetRegistrySnapshot,
  _resetWidgetRegistry,
} from './widgetRegistry.js'

describe('widgetRegistry', () => {
  beforeEach(() => {
    _resetWidgetRegistry()
  })

  it('starts empty', () => {
    expect(getAllWidgetDefinitions()).toEqual({})
    expect(getWidgetDefinition('anything')).toBeNull()
  })

  it('initWidgetRegistry seeds the store with valid entries', () => {
    const Component = () => null
    initWidgetRegistry({
      'my-thing': { component: Component, label: 'My Thing' },
      'other': { label: 'Other' },
    })
    expect(getWidgetDefinition('my-thing')).toEqual({ component: Component, label: 'My Thing' })
    expect(getWidgetDefinition('other')).toEqual({ label: 'Other' })
    expect(Object.keys(getAllWidgetDefinitions()).sort()).toEqual(['my-thing', 'other'])
  })

  it('initWidgetRegistry replaces previous entries', () => {
    initWidgetRegistry({ a: { label: 'A' } })
    initWidgetRegistry({ b: { label: 'B' } })
    expect(getWidgetDefinition('a')).toBeNull()
    expect(getWidgetDefinition('b')).toEqual({ label: 'B' })
  })

  it('initWidgetRegistry ignores null/undefined and non-object entries', () => {
    initWidgetRegistry({
      ok: { label: 'OK' },
      nullish: null,
      undef: undefined,
      notObj: 'string',
    })
    expect(Object.keys(getAllWidgetDefinitions())).toEqual(['ok'])
  })

  it('initWidgetRegistry with null/undefined clears the store', () => {
    initWidgetRegistry({ a: { label: 'A' } })
    initWidgetRegistry(null)
    expect(getAllWidgetDefinitions()).toEqual({})
  })

  it('registerWidget adds a single entry', () => {
    registerWidget('foo', { label: 'Foo' })
    expect(getWidgetDefinition('foo')).toEqual({ label: 'Foo' })
  })

  it('registerWidget replaces an existing entry', () => {
    registerWidget('foo', { label: 'Foo' })
    registerWidget('foo', { label: 'Foo2' })
    expect(getWidgetDefinition('foo')).toEqual({ label: 'Foo2' })
  })

  it('registerWidget throws on invalid type', () => {
    expect(() => registerWidget('', { label: 'X' })).toThrow(/non-empty string/)
    expect(() => registerWidget(null, { label: 'X' })).toThrow(/non-empty string/)
  })

  it('registerWidget throws on invalid definition', () => {
    expect(() => registerWidget('foo', null)).toThrow(/must be an object/)
    expect(() => registerWidget('foo', 'string')).toThrow(/must be an object/)
  })

  it('unregisterWidget removes an entry', () => {
    registerWidget('foo', { label: 'Foo' })
    unregisterWidget('foo')
    expect(getWidgetDefinition('foo')).toBeNull()
  })

  it('unregisterWidget on missing entry is a no-op', () => {
    expect(() => unregisterWidget('nope')).not.toThrow()
  })

  it('subscribeToWidgetRegistry fires on init/register/unregister', () => {
    let calls = 0
    const unsubscribe = subscribeToWidgetRegistry(() => { calls++ })
    initWidgetRegistry({ a: { label: 'A' } })
    expect(calls).toBe(1)
    registerWidget('b', { label: 'B' })
    expect(calls).toBe(2)
    unregisterWidget('a')
    expect(calls).toBe(3)
    unsubscribe()
    registerWidget('c', { label: 'C' })
    expect(calls).toBe(3)
  })

  it('getWidgetRegistrySnapshot returns a stable string per state', () => {
    const a = getWidgetRegistrySnapshot()
    expect(a).toBe(getWidgetRegistrySnapshot())
    registerWidget('foo', { label: 'Foo' })
    const b = getWidgetRegistrySnapshot()
    expect(b).not.toBe(a)
  })
})
