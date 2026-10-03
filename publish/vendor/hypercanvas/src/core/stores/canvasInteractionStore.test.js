import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  initCanvasInteraction,
  setCanvasInteraction,
  getCanvasInteraction,
  subscribeToCanvasInteraction,
  getCanvasInteractionSnapshot,
  _resetCanvasInteraction,
} from './canvasInteractionStore.js'

describe('canvasInteractionStore', () => {
  beforeEach(() => {
    _resetCanvasInteraction()
  })

  it('starts with defaults: scrollAxis=both, zoomGestures=true, zoomOrigin=center, surface=auto/auto', () => {
    expect(getCanvasInteraction()).toEqual({
      scrollAxis: 'both',
      zoomGestures: true,
      zoomOrigin: 'center',
      surface: { width: 'auto', height: 'auto' },
    })
  })

  it('initCanvasInteraction seeds from config', () => {
    initCanvasInteraction({
      scrollAxis: 'vertical',
      zoomGestures: false,
      zoomOrigin: 'top-left',
      surface: { width: 'viewport', height: 'viewport' },
    })
    expect(getCanvasInteraction()).toEqual({
      scrollAxis: 'vertical',
      zoomGestures: false,
      zoomOrigin: 'top-left',
      surface: { width: 'viewport', height: 'viewport' },
    })
  })

  it('initCanvasInteraction with no args / empty / invalid resets to defaults', () => {
    initCanvasInteraction({
      scrollAxis: 'vertical',
      zoomGestures: false,
      zoomOrigin: 'top-left',
      surface: { width: 'viewport', height: 'viewport' },
    })
    initCanvasInteraction()
    expect(getCanvasInteraction()).toEqual({
      scrollAxis: 'both',
      zoomGestures: true,
      zoomOrigin: 'center',
      surface: { width: 'auto', height: 'auto' },
    })

    initCanvasInteraction({
      scrollAxis: 'vertical',
      zoomGestures: false,
      zoomOrigin: 'top-left',
      surface: { width: 'viewport', height: 'viewport' },
    })
    initCanvasInteraction({})
    expect(getCanvasInteraction()).toEqual({
      scrollAxis: 'both',
      zoomGestures: true,
      zoomOrigin: 'center',
      surface: { width: 'auto', height: 'auto' },
    })
  })

  it('initCanvasInteraction ignores invalid scrollAxis values', () => {
    initCanvasInteraction({ scrollAxis: 'sideways' })
    expect(getCanvasInteraction().scrollAxis).toBe('both')

    initCanvasInteraction({ scrollAxis: null })
    expect(getCanvasInteraction().scrollAxis).toBe('both')

    initCanvasInteraction({ scrollAxis: 42 })
    expect(getCanvasInteraction().scrollAxis).toBe('both')
  })

  it('initCanvasInteraction ignores non-boolean zoomGestures', () => {
    initCanvasInteraction({ zoomGestures: 'yes' })
    expect(getCanvasInteraction().zoomGestures).toBe(true)

    initCanvasInteraction({ zoomGestures: 1 })
    expect(getCanvasInteraction().zoomGestures).toBe(true)
  })

  it('initCanvasInteraction ignores invalid zoomOrigin values', () => {
    initCanvasInteraction({ zoomOrigin: 'bottom-right' })
    expect(getCanvasInteraction().zoomOrigin).toBe('center')

    initCanvasInteraction({ zoomOrigin: null })
    expect(getCanvasInteraction().zoomOrigin).toBe('center')

    initCanvasInteraction({ zoomOrigin: 42 })
    expect(getCanvasInteraction().zoomOrigin).toBe('center')
  })

  it('accepts both valid zoomOrigin values', () => {
    for (const origin of ['center', 'top-left']) {
      initCanvasInteraction({ zoomOrigin: origin })
      expect(getCanvasInteraction().zoomOrigin).toBe(origin)
    }
  })

  it('accepts all four valid axis values', () => {
    for (const axis of ['both', 'vertical', 'horizontal', 'none']) {
      initCanvasInteraction({ scrollAxis: axis })
      expect(getCanvasInteraction().scrollAxis).toBe(axis)
    }
  })

  it('initCanvasInteraction accepts surface.{width,height} independently', () => {
    initCanvasInteraction({ surface: { width: 'viewport' } })
    expect(getCanvasInteraction().surface).toEqual({ width: 'viewport', height: 'auto' })

    initCanvasInteraction({ surface: { height: 'viewport' } })
    expect(getCanvasInteraction().surface).toEqual({ width: 'auto', height: 'viewport' })

    initCanvasInteraction({ surface: { width: 'viewport', height: 'viewport' } })
    expect(getCanvasInteraction().surface).toEqual({ width: 'viewport', height: 'viewport' })
  })

  it('initCanvasInteraction ignores invalid surface values', () => {
    initCanvasInteraction({ surface: { width: 'fluid' } })
    expect(getCanvasInteraction().surface).toEqual({ width: 'auto', height: 'auto' })

    initCanvasInteraction({ surface: { width: 42 } })
    expect(getCanvasInteraction().surface).toEqual({ width: 'auto', height: 'auto' })

    initCanvasInteraction({ surface: null })
    expect(getCanvasInteraction().surface).toEqual({ width: 'auto', height: 'auto' })

    initCanvasInteraction({ surface: 'viewport' })
    expect(getCanvasInteraction().surface).toEqual({ width: 'auto', height: 'auto' })
  })

  it('initCanvasInteraction writes data-canvas-surface-* attrs on <html>', () => {
    const root = document.documentElement
    initCanvasInteraction({ surface: { width: 'viewport' } })
    expect(root.dataset.canvasSurfaceWidth).toBe('viewport')
    expect(root.dataset.canvasSurfaceHeight).toBeUndefined()

    initCanvasInteraction({ surface: { width: 'viewport', height: 'viewport' } })
    expect(root.dataset.canvasSurfaceWidth).toBe('viewport')
    expect(root.dataset.canvasSurfaceHeight).toBe('viewport')

    initCanvasInteraction()  // resets to default
    expect(root.dataset.canvasSurfaceWidth).toBeUndefined()
    expect(root.dataset.canvasSurfaceHeight).toBeUndefined()
  })

  it('setCanvasInteraction patches partial state without resetting other keys', () => {
    initCanvasInteraction({
      scrollAxis: 'vertical',
      zoomGestures: false,
      zoomOrigin: 'top-left',
      surface: { width: 'viewport' },
    })

    setCanvasInteraction({ zoomGestures: true })
    expect(getCanvasInteraction()).toEqual({
      scrollAxis: 'vertical',
      zoomGestures: true,
      zoomOrigin: 'top-left',
      surface: { width: 'viewport', height: 'auto' },
    })

    setCanvasInteraction({ scrollAxis: 'horizontal' })
    expect(getCanvasInteraction().scrollAxis).toBe('horizontal')

    setCanvasInteraction({ surface: { height: 'viewport' } })
    expect(getCanvasInteraction().surface).toEqual({ width: 'viewport', height: 'viewport' })

    setCanvasInteraction({ zoomOrigin: 'center' })
    expect(getCanvasInteraction().zoomOrigin).toBe('center')
  })

  it('setCanvasInteraction with no-op patch does not notify subscribers', () => {
    const cb = vi.fn()
    subscribeToCanvasInteraction(cb)
    cb.mockClear()

    setCanvasInteraction({}) // no keys
    setCanvasInteraction({ scrollAxis: 'invalid' }) // ignored
    setCanvasInteraction({ scrollAxis: 'both' }) // same as default
    setCanvasInteraction({ zoomGestures: true }) // same as default
    setCanvasInteraction({ zoomOrigin: 'center' }) // same as default
    setCanvasInteraction({ zoomOrigin: 'invalid' }) // ignored
    setCanvasInteraction({ surface: { width: 'auto' } }) // same as default
    setCanvasInteraction({ surface: { width: 'fluid' } }) // ignored
    expect(cb).not.toHaveBeenCalled()

    setCanvasInteraction({ zoomGestures: false }) // real change
    expect(cb).toHaveBeenCalledTimes(1)

    setCanvasInteraction({ zoomOrigin: 'top-left' }) // real change
    expect(cb).toHaveBeenCalledTimes(2)

    setCanvasInteraction({ surface: { width: 'viewport' } }) // real change
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('subscribers are notified on init and meaningful set; unsubscribe stops further notifications', () => {
    const cb = vi.fn()
    const unsub = subscribeToCanvasInteraction(cb)

    initCanvasInteraction({ scrollAxis: 'vertical' })
    setCanvasInteraction({ zoomGestures: false })

    expect(cb).toHaveBeenCalledTimes(2)
    unsub()

    setCanvasInteraction({ scrollAxis: 'horizontal' })
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('snapshot version changes on every meaningful mutation', () => {
    const v0 = getCanvasInteractionSnapshot()
    initCanvasInteraction({ scrollAxis: 'vertical' })
    const v1 = getCanvasInteractionSnapshot()
    expect(v1).not.toBe(v0)

    setCanvasInteraction({ zoomGestures: false })
    const v2 = getCanvasInteractionSnapshot()
    expect(v2).not.toBe(v1)
  })

  it('subscriber errors are isolated', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const goodCb = vi.fn()

    subscribeToCanvasInteraction(() => { throw new Error('boom') })
    subscribeToCanvasInteraction(goodCb)

    setCanvasInteraction({ zoomGestures: false })

    expect(goodCb).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
