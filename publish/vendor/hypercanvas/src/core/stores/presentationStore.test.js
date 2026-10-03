import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  initPresentation,
  setPresentation,
  getPresentation,
  subscribeToPresentation,
  getPresentationSnapshot,
  _resetPresentation,
} from './presentationStore.js'

describe('presentationStore', () => {
  beforeEach(() => {
    _resetPresentation()
  })

  it('returns null when no override is registered', () => {
    expect(getPresentation('tool:command-palette')).toBeNull()
  })

  it('seeds overrides from initPresentation', () => {
    initPresentation({
      'tool:command-palette': { hidden: true },
      'canvas:title': { className: 'landing-title' },
    })
    expect(getPresentation('tool:command-palette')).toEqual({ hidden: true })
    expect(getPresentation('canvas:title')).toEqual({ className: 'landing-title' })
    expect(getPresentation('nope:nothing')).toBeNull()
  })

  it('ignores non-object values in initPresentation', () => {
    initPresentation({
      'tool:a': null,
      'tool:b': 'invalid',
      'tool:c': 42,
      'tool:d': { hidden: true },
    })
    expect(getPresentation('tool:a')).toBeNull()
    expect(getPresentation('tool:b')).toBeNull()
    expect(getPresentation('tool:c')).toBeNull()
    expect(getPresentation('tool:d')).toEqual({ hidden: true })
  })

  it('replaces previous overrides on subsequent initPresentation calls', () => {
    initPresentation({ 'tool:a': { hidden: true } })
    initPresentation({ 'tool:b': { hidden: true } })
    expect(getPresentation('tool:a')).toBeNull()
    expect(getPresentation('tool:b')).toEqual({ hidden: true })
  })

  it('initPresentation() with no arg clears all overrides', () => {
    initPresentation({ 'tool:a': { hidden: true } })
    initPresentation()
    expect(getPresentation('tool:a')).toBeNull()
  })

  it('setPresentation adds and updates individual overrides', () => {
    setPresentation('tool:a', { className: 'foo' })
    expect(getPresentation('tool:a')).toEqual({ className: 'foo' })

    setPresentation('tool:a', { className: 'bar' })
    expect(getPresentation('tool:a')).toEqual({ className: 'bar' })
  })

  it('setPresentation with null/undefined deletes the override', () => {
    setPresentation('tool:a', { hidden: true })
    setPresentation('tool:a', null)
    expect(getPresentation('tool:a')).toBeNull()

    setPresentation('tool:b', { hidden: true })
    setPresentation('tool:b', undefined)
    expect(getPresentation('tool:b')).toBeNull()
  })

  it('subscribers are notified on init, set, and clear', () => {
    const cb = vi.fn()
    const unsub = subscribeToPresentation(cb)

    initPresentation({ 'tool:a': { hidden: true } })
    setPresentation('tool:b', { className: 'x' })
    setPresentation('tool:a', null)

    expect(cb).toHaveBeenCalledTimes(3)
    unsub()

    setPresentation('tool:c', { hidden: true })
    expect(cb).toHaveBeenCalledTimes(3) // not called after unsubscribe
  })

  it('snapshot version changes on every mutation', () => {
    const v0 = getPresentationSnapshot()
    setPresentation('tool:a', { hidden: true })
    const v1 = getPresentationSnapshot()
    expect(v1).not.toBe(v0)

    setPresentation('tool:b', { hidden: true })
    const v2 = getPresentationSnapshot()
    expect(v2).not.toBe(v1)
  })

  it('subscriber errors are isolated', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const goodCb = vi.fn()

    subscribeToPresentation(() => { throw new Error('boom') })
    subscribeToPresentation(goodCb)

    setPresentation('tool:a', { hidden: true })

    expect(goodCb).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
