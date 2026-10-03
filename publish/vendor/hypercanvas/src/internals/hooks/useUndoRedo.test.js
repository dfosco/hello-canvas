import { renderHook, act } from '@testing-library/react'
import { seedTestData } from '../../test-utils.js'
import { pushSnapshot } from '../../core/index.js'
import { useUndoRedo } from './useUndoRedo.js'

beforeEach(() => {
  seedTestData()
})

describe('useUndoRedo', () => {
  it('returns { undo, redo, canUndo, canRedo }', () => {
    const { result } = renderHook(() => useUndoRedo())
    expect(typeof result.current.undo).toBe('function')
    expect(typeof result.current.redo).toBe('function')
    expect(typeof result.current.canUndo).toBe('boolean')
    expect(typeof result.current.canRedo).toBe('boolean')
  })

  it('canUndo and canRedo are false initially', () => {
    const { result } = renderHook(() => useUndoRedo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('after pushing snapshots and undoing, canUndo/canRedo reflect state', () => {
    // Pre-populate history with 3 entries so we can undo twice
    pushSnapshot('a=1', '/')
    pushSnapshot('b=2', '/')
    pushSnapshot('c=3', '/')

    const { result, rerender } = renderHook(() => useUndoRedo())

    // At index 2 (last entry), can undo but not redo
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    act(() => {
      result.current.undo()
    })

    rerender()
    // At index 1, can undo and redo
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.undo()
    })

    rerender()
    // At index 0, cannot undo but can redo
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    act(() => {
      result.current.redo()
    })

    rerender()
    // At index 1 again, can undo and redo
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(true)
  })
})
