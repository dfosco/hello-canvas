import { renderHook } from '@testing-library/react'
import { useFlowData, useFlowLoading, useSceneData, useSceneLoading } from './useSceneData.js'
import { seedTestData, createWrapper, TEST_FLOWS } from '../test-utils.js'

const flowData = TEST_FLOWS.default

beforeEach(() => {
  seedTestData()
})

describe('useFlowData', () => {
  it('returns entire flow object when no path given', () => {
    const { result } = renderHook(() => useFlowData(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toEqual(flowData)
  })

  it('returns nested value by dot-notation path', () => {
    const { result } = renderHook(() => useFlowData('user.name'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toBe('Jane')
  })

  it('returns deep nested value', () => {
    const { result } = renderHook(() => useFlowData('user.profile.bio'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toBe('Dev')
  })

  it('returns array by path', () => {
    const { result } = renderHook(() => useFlowData('projects'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toEqual([
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ])
  })

  it('returns array element by index path', () => {
    const { result } = renderHook(() => useFlowData('projects.0'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toEqual({ id: 1, name: 'alpha' })
  })

  it('returns empty object and warns for missing path', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useFlowData('nonexistent.path'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toEqual({})
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('nonexistent.path')
    )
    spy.mockRestore()
  })

  it('throws when used outside StoryboardProvider', () => {
    expect(() => {
      renderHook(() => useFlowData())
    }).toThrow('useFlowData must be used within a <StoryboardProvider>')
  })

  it('returns hash override value when param matches path', () => {
    window.location.hash = '#user.name=Alice'
    const { result } = renderHook(() => useFlowData('user.name'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toBe('Alice')
  })

  it('applies child overrides to arrays', () => {
    window.location.hash = '#projects.0.name=gamma'
    const { result } = renderHook(() => useFlowData('projects'), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current[0].name).toBe('gamma')
    expect(result.current[1].name).toBe('beta')
  })

  it('returns full flow with all overrides applied when no path', () => {
    window.location.hash = '#user.name=Alice'
    const { result } = renderHook(() => useFlowData(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current.user.name).toBe('Alice')
    expect(result.current.settings.theme).toBe('dark')
  })
})

describe('useFlowLoading', () => {
  it('returns false when not loading', () => {
    const { result } = renderHook(() => useFlowLoading(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toBe(false)
  })

  it('throws when used outside StoryboardProvider', () => {
    expect(() => {
      renderHook(() => useFlowLoading())
    }).toThrow('useFlowLoading must be used within a <StoryboardProvider>')
  })
})

// ── Deprecated aliases ──

describe('useSceneData (deprecated alias)', () => {
  it('is the same function as useFlowData', () => {
    expect(useSceneData).toBe(useFlowData)
  })

  it('returns flow data', () => {
    const { result } = renderHook(() => useSceneData(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toEqual(flowData)
  })
})

describe('useSceneLoading (deprecated alias)', () => {
  it('is the same function as useFlowLoading', () => {
    expect(useSceneLoading).toBe(useFlowLoading)
  })

  it('returns loading state', () => {
    const { result } = renderHook(() => useSceneLoading(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toBe(false)
  })
})
