import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  trackRecent,
  getRecent,
  clearRecent,
  subscribeToRecent,
  getRecentSnapshot,
} from './recentArtifacts.js'

describe('recentArtifacts', () => {
  beforeEach(() => {
    clearRecent()
  })

  it('returns empty array when nothing tracked', () => {
    expect(getRecent()).toEqual([])
  })

  it('tracks a single entry', () => {
    trackRecent('prototype', 'my-proto', 'My Proto')
    const items = getRecent()
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ type: 'prototype', key: 'my-proto', label: 'My Proto' })
  })

  it('puts newest entry first', () => {
    trackRecent('prototype', 'a', 'A')
    trackRecent('prototype', 'b', 'B')
    const items = getRecent()
    expect(items[0].key).toBe('b')
    expect(items[1].key).toBe('a')
  })

  it('deduplicates by type+key and moves to top', () => {
    trackRecent('prototype', 'a', 'A')
    trackRecent('prototype', 'b', 'B')
    trackRecent('prototype', 'a', 'A updated')
    const items = getRecent()
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ type: 'prototype', key: 'a', label: 'A updated' })
    expect(items[1].key).toBe('b')
  })

  it('allows same key with different types', () => {
    trackRecent('prototype', 'foo', 'Foo Proto')
    trackRecent('canvas', 'foo', 'Foo Canvas')
    const items = getRecent()
    expect(items).toHaveLength(2)
  })

  it('caps stored entries at 30', () => {
    for (let i = 0; i < 35; i++) {
      trackRecent('prototype', `p${i}`, `Proto ${i}`)
    }
    expect(getRecent()).toHaveLength(30)
    // newest should be first
    expect(getRecent()[0].key).toBe('p34')
  })

  it('clears all entries', () => {
    trackRecent('prototype', 'a', 'A')
    trackRecent('canvas', 'b', 'B')
    clearRecent()
    expect(getRecent()).toEqual([])
  })

  it('ignores entries with missing type or key', () => {
    trackRecent('', 'a', 'A')
    trackRecent('prototype', '', 'B')
    expect(getRecent()).toEqual([])
  })

  it('falls back to key as label if label is empty', () => {
    trackRecent('prototype', 'my-proto', '')
    expect(getRecent()[0].label).toBe('my-proto')
  })

  describe('subscribeToRecent + getRecentSnapshot', () => {
    it('snapshot reflects the current store as JSON', () => {
      expect(getRecentSnapshot()).toBe('[]')
      trackRecent('canvas', 'foo', 'Foo')
      const snap = getRecentSnapshot()
      expect(snap).toBe(JSON.stringify([{ type: 'canvas', key: 'foo', label: 'Foo' }]))
    })

    it('notifies subscribers on intra-tab writes', () => {
      const cb = vi.fn()
      const unsubscribe = subscribeToRecent(cb)
      trackRecent('canvas', 'foo', 'Foo')
      expect(cb).toHaveBeenCalledTimes(1)
      trackRecent('prototype', 'bar', 'Bar')
      expect(cb).toHaveBeenCalledTimes(2)
      unsubscribe()
    })

    it('notifies subscribers on clearRecent', () => {
      trackRecent('canvas', 'foo', 'Foo')
      const cb = vi.fn()
      const unsubscribe = subscribeToRecent(cb)
      clearRecent()
      expect(cb).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    it('unsubscribe stops notifications', () => {
      const cb = vi.fn()
      const unsubscribe = subscribeToRecent(cb)
      unsubscribe()
      trackRecent('canvas', 'foo', 'Foo')
      expect(cb).not.toHaveBeenCalled()
    })

    it('reacts to cross-tab storage events for the recent key', () => {
      const cb = vi.fn()
      const unsubscribe = subscribeToRecent(cb)
      window.dispatchEvent(new StorageEvent('storage', { key: 'storyboard:recent-artifacts' }))
      expect(cb).toHaveBeenCalledTimes(1)
      // Unrelated storage keys should not trigger
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
      expect(cb).toHaveBeenCalledTimes(1)
      unsubscribe()
    })
  })
})
