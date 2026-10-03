import { renderHook, act } from '@testing-library/react'
import { seedTestData } from '../../test-utils.js'
import { useHideMode } from './useHideMode.js'
import { STORAGE_PREFIX } from '../../core/session/localStorage.js'

beforeEach(() => {
  seedTestData()
})

describe('useHideMode', () => {
  it('returns { isHidden, hide, show }', () => {
    const { result } = renderHook(() => useHideMode())
    expect(result.current).toHaveProperty('isHidden')
    expect(typeof result.current.hide).toBe('function')
    expect(typeof result.current.show).toBe('function')
  })

  it('isHidden is false initially', () => {
    const { result } = renderHook(() => useHideMode())
    expect(result.current.isHidden).toBe(false)
  })

  it('after calling hide(), isHidden becomes true', () => {
    const { result } = renderHook(() => useHideMode())

    act(() => {
      result.current.hide()
    })

    expect(result.current.isHidden).toBe(true)
  })

  it('after calling show(), isHidden becomes false', () => {
    // Activate hide mode directly via localStorage to set known state
    localStorage.setItem(STORAGE_PREFIX + '__hide__', '1')
    const { result } = renderHook(() => useHideMode())
    expect(result.current.isHidden).toBe(true)

    act(() => {
      result.current.show()
    })
    expect(result.current.isHidden).toBe(false)
  })
})
