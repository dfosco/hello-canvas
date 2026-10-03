import { renderHook, act } from '@testing-library/react'
import { seedTestData, createWrapper, TEST_SCENES } from '../../test-utils.js'
import { useLocalStorage } from './useLocalStorage.js'
import { STORAGE_PREFIX } from '../../core/session/localStorage.js'

beforeEach(() => {
  seedTestData()
})

const wrapper = createWrapper(TEST_SCENES.default)

describe('useLocalStorage', () => {
  it('returns [value, setValue, clearValue]', () => {
    const { result } = renderHook(() => useLocalStorage('settings.theme'), {
      wrapper,
    })
    expect(result.current).toHaveLength(3)
    expect(typeof result.current[1]).toBe('function')
    expect(typeof result.current[2]).toBe('function')
  })

  it('falls back to scene default when no override exists', () => {
    const { result } = renderHook(() => useLocalStorage('settings.theme'), {
      wrapper,
    })
    expect(result.current[0]).toBe('dark_dimmed')
  })

  it('reads from localStorage when present', () => {
    localStorage.setItem(STORAGE_PREFIX + 'settings.theme', 'light')
    const { result } = renderHook(() => useLocalStorage('settings.theme'), {
      wrapper,
    })
    expect(result.current[0]).toBe('light')
  })

  it('hash override takes priority over localStorage', () => {
    localStorage.setItem(STORAGE_PREFIX + 'settings.theme', 'light')
    window.location.hash = 'settings.theme=high-contrast'
    const { result } = renderHook(() => useLocalStorage('settings.theme'), {
      wrapper,
    })
    expect(result.current[0]).toBe('high-contrast')
  })

  it('setValue writes to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('settings.theme'), {
      wrapper,
    })

    act(() => {
      result.current[1]('light')
    })

    expect(localStorage.getItem(STORAGE_PREFIX + 'settings.theme')).toBe('light')
  })

  it('clearValue removes from localStorage', () => {
    localStorage.setItem(STORAGE_PREFIX + 'settings.theme', 'light')
    const { result } = renderHook(() => useLocalStorage('settings.theme'), {
      wrapper,
    })

    act(() => {
      result.current[2]()
    })

    expect(localStorage.getItem(STORAGE_PREFIX + 'settings.theme')).toBeNull()
  })

  it('throws when used outside StoryboardProvider', () => {
    expect(() => {
      renderHook(() => useLocalStorage('settings.theme'))
    }).toThrow('useLocalStorage must be used within a <StoryboardProvider>')
  })
})
