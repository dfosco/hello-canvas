import { renderHook, act } from '@testing-library/react'
import { useOverride } from './useOverride.js'
import { seedTestData, createWrapper, TEST_SCENES } from '../test-utils.js'

const sceneData = TEST_SCENES.default

beforeEach(() => {
  seedTestData()
})

describe('useOverride', () => {
  it('returns [value, setValue, clearValue] tuple', () => {
    const { result } = renderHook(() => useOverride('settings.theme'), {
      wrapper: createWrapper(sceneData),
    })
    expect(result.current).toHaveLength(3)
    expect(typeof result.current[1]).toBe('function')
    expect(typeof result.current[2]).toBe('function')
  })

  it('value falls back to scene default when no hash override', () => {
    const { result } = renderHook(() => useOverride('settings.theme'), {
      wrapper: createWrapper(sceneData),
    })
    expect(result.current[0]).toBe('dark')
  })

  it('value reads from hash override when present', () => {
    window.location.hash = '#settings.theme=light'
    const { result } = renderHook(() => useOverride('settings.theme'), {
      wrapper: createWrapper(sceneData),
    })
    expect(result.current[0]).toBe('light')
  })

  it('setValue writes to hash', () => {
    const { result } = renderHook(() => useOverride('settings.theme'), {
      wrapper: createWrapper(sceneData),
    })

    act(() => {
      result.current[1]('blue')
    })

    expect(window.location.hash).toContain('settings.theme=blue')
  })

  it('clearValue removes hash param', () => {
    window.location.hash = '#settings.theme=red'
    const { result } = renderHook(() => useOverride('settings.theme'), {
      wrapper: createWrapper(sceneData),
    })

    act(() => {
      result.current[2]()
    })

    expect(window.location.hash).not.toContain('settings.theme')
  })

  it('works without StoryboardProvider for object overrides', () => {
    window.location.hash = '#object.jane-doe.name=Alice'
    const { result } = renderHook(() => useOverride('object.jane-doe.name'))
    expect(result.current[0]).toBe('Alice')
  })

  it('returns undefined without provider when no override exists', () => {
    const { result } = renderHook(() => useOverride('object.jane-doe.name'))
    expect(result.current[0]).toBeUndefined()
  })
})
