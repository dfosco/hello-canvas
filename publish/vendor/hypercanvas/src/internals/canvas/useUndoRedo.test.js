import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import useUndoRedo from './useUndoRedo.js'

describe('useUndoRedo (canvas)', () => {
  it('starts with canUndo and canRedo as false', () => {
    const { result } = renderHook(() => useUndoRedo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('track pushes an event id and enables undo', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.track('evt_a'))
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('popUndo returns the most recent tracked id; pushRedo enables redo', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.track('evt_a'))
    act(() => result.current.track('evt_b'))

    let popped
    act(() => { popped = result.current.popUndo() })

    expect(popped).toBe('evt_b')
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    act(() => result.current.pushRedo('evt_b_inv'))
    expect(result.current.canRedo).toBe(true)
  })

  it('popRedo returns the most recent redo id; pushUndo restores undo availability', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.track('evt_a'))
    act(() => { result.current.popUndo() })
    act(() => result.current.pushRedo('evt_a_inv'))

    expect(result.current.canRedo).toBe(true)

    let popped
    act(() => { popped = result.current.popRedo() })
    expect(popped).toBe('evt_a_inv')
    expect(result.current.canRedo).toBe(false)

    act(() => result.current.pushUndo('evt_a_inv_inv'))
    expect(result.current.canUndo).toBe(true)
  })

  it('new track call after undo clears the redo stack', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.track('evt_a'))
    act(() => { result.current.popUndo() })
    act(() => result.current.pushRedo('evt_a_inv'))
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.track('evt_b'))
    expect(result.current.canRedo).toBe(false)
    expect(result.current.canUndo).toBe(true)
  })

  it('trackMany pushes multiple ids and clears redo', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.trackMany(['evt_a', 'evt_b', 'evt_c']))
    expect(result.current.canUndo).toBe(true)
    let popped
    act(() => { popped = result.current.popUndo() })
    expect(popped).toBe('evt_c')
  })

  it('ignores empty / non-string ids', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.track(null))
    act(() => result.current.track(undefined))
    act(() => result.current.track(''))
    act(() => result.current.track(42))
    expect(result.current.canUndo).toBe(false)
  })

  it('reset clears both stacks', () => {
    const { result } = renderHook(() => useUndoRedo())
    act(() => result.current.track('evt_a'))
    act(() => { result.current.popUndo() })
    act(() => result.current.pushRedo('evt_a_inv'))

    act(() => result.current.reset())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('popUndo on empty stack returns null', () => {
    const { result } = renderHook(() => useUndoRedo())
    let popped
    act(() => { popped = result.current.popUndo() })
    expect(popped).toBeNull()
  })
})
