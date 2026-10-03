import { renderHook } from '@testing-library/react'
import { useFlow } from './useScene.js'
import { useScene } from './useScene.js'
import { seedTestData, createWrapper, TEST_FLOWS } from '../test-utils.js'

const flowData = TEST_FLOWS.default

beforeEach(() => {
  seedTestData()
})

describe('useFlow', () => {
  it('returns { flowName, switchFlow }', () => {
    const { result } = renderHook(() => useFlow(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toHaveProperty('flowName')
    expect(result.current).toHaveProperty('switchFlow')
  })

  it('flowName matches the value from context', () => {
    const { result } = renderHook(() => useFlow(), {
      wrapper: createWrapper(flowData, 'other'),
    })
    expect(result.current.flowName).toBe('other')
  })

  it('switchFlow is a function', () => {
    const { result } = renderHook(() => useFlow(), {
      wrapper: createWrapper(flowData),
    })
    expect(typeof result.current.switchFlow).toBe('function')
  })

  it('throws when used outside StoryboardProvider', () => {
    expect(() => {
      renderHook(() => useFlow())
    }).toThrow('useFlow must be used within a <StoryboardProvider>')
  })
})

// ── useScene (deprecated alias) ──

describe('useScene (deprecated alias)', () => {
  it('returns { sceneName, switchScene }', () => {
    const { result } = renderHook(() => useScene(), {
      wrapper: createWrapper(flowData),
    })
    expect(result.current).toHaveProperty('sceneName')
    expect(result.current).toHaveProperty('switchScene')
  })

  it('sceneName matches the flow name from context', () => {
    const { result } = renderHook(() => useScene(), {
      wrapper: createWrapper(flowData, 'other'),
    })
    expect(result.current.sceneName).toBe('other')
  })

  it('switchScene is a function', () => {
    const { result } = renderHook(() => useScene(), {
      wrapper: createWrapper(flowData),
    })
    expect(typeof result.current.switchScene).toBe('function')
  })
})
