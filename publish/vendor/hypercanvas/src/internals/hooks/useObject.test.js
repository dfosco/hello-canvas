import { renderHook, act } from '@testing-library/react'
import { seedTestData, TEST_OBJECTS } from '../../test-utils.js'
import { activateHideMode, setShadow } from '../../core/index.js'
import { useObject } from './useObject.js'

beforeEach(() => {
  seedTestData()
  window.location.hash = ''
})

describe('useObject', () => {
  it('loads an object by name', () => {
    const { result } = renderHook(() => useObject('jane-doe'))
    expect(result.current).toEqual(TEST_OBJECTS['jane-doe'])
  })

  it('returns undefined for missing object', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useObject('nonexistent'))
    expect(result.current).toBeUndefined()
    console.error.mockRestore()
  })

  it('resolves dot-notation path', () => {
    const { result } = renderHook(() => useObject('jane-doe', 'name'))
    expect(result.current).toBe('Jane Doe')
  })

  it('returns undefined for missing path', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useObject('jane-doe', 'missing.path'))
    expect(result.current).toBeUndefined()
    console.warn.mockRestore()
  })

  it('applies hash overrides to full object', () => {
    window.location.hash = 'object.jane-doe.name=Alice'
    const { result } = renderHook(() => useObject('jane-doe'))
    expect(result.current.name).toBe('Alice')
    expect(result.current.role).toBe('admin')
  })

  it('applies hash overrides when accessing by path', () => {
    window.location.hash = 'object.jane-doe.name=Alice'
    const { result } = renderHook(() => useObject('jane-doe', 'name'))
    expect(result.current).toBe('Alice')
  })

  it('returns deep clone (mutations do not affect source data)', () => {
    const { result: r1 } = renderHook(() => useObject('jane-doe'))
    r1.current.name = 'Mutated'
    // A fresh hook call should return original data, not the mutated reference
    const { result: r2 } = renderHook(() => useObject('jane-doe'))
    expect(r2.current.name).toBe('Jane Doe')
  })
})

describe('useObject (hide mode)', () => {
  beforeEach(() => {
    act(() => { activateHideMode() })
  })

  it('reads overrides from localStorage shadow in hide mode', () => {
    act(() => { setShadow('object.jane-doe.name', 'Shadow Jane') })
    const { result } = renderHook(() => useObject('jane-doe'))
    expect(result.current.name).toBe('Shadow Jane')
  })

  it('reads path-specific overrides from shadow in hide mode', () => {
    act(() => { setShadow('object.jane-doe.role', 'superadmin') })
    const { result } = renderHook(() => useObject('jane-doe', 'role'))
    expect(result.current).toBe('superadmin')
  })
})
