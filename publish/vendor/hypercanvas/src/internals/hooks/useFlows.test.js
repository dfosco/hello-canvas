import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { init, getFlowsForPrototype } from '../../core/index.js'
import { useFlows } from './useFlows.js'
import { StoryboardContext } from '../StoryboardContext.js'

// Test data with prototype-scoped flows
const SCOPED_FLOWS = {
  'default': { meta: { title: 'Default' } },
  'Signup/empty-form': { meta: { title: 'Empty Form' }, _route: '/Signup' },
  'Signup/validation-errors': { meta: { title: 'Validation Errors' }, _route: '/Signup' },
  'Signup/prefilled-review': { meta: { title: 'Prefilled Review' }, _route: '/Signup' },
  'Signup/error-state': { meta: { title: 'Error State' }, _route: '/Signup' },
  'Example/basic': { meta: { title: 'Example Data Flow' }, _route: '/Example' },
}

function seedScopedData() {
  init({ flows: SCOPED_FLOWS, objects: {}, records: {} })
}

function createWrapperWithPrototype(flowName = 'default', prototypeName = null) {
  return function Wrapper({ children }) {
    return createElement(
      StoryboardContext.Provider,
      { value: { data: {}, error: null, loading: false, flowName, sceneName: flowName, prototypeName } },
      children,
    )
  }
}

beforeEach(() => {
  seedScopedData()
})

// ── Core utility: getFlowsForPrototype ──

describe('getFlowsForPrototype', () => {
  it('returns flows scoped to the given prototype', () => {
    const flows = getFlowsForPrototype('Signup')
    expect(flows).toHaveLength(4)
    expect(flows.map(f => f.name)).toEqual([
      'empty-form', 'validation-errors', 'prefilled-review', 'error-state',
    ])
  })

  it('returns the full key with prototype prefix', () => {
    const flows = getFlowsForPrototype('Signup')
    expect(flows[0].key).toBe('Signup/empty-form')
  })

  it('returns empty array for prototype with no flows', () => {
    const flows = getFlowsForPrototype('NonExistent')
    expect(flows).toEqual([])
  })

  it('returns empty array when prototypeName is null', () => {
    const flows = getFlowsForPrototype(null)
    expect(flows).toEqual([])
  })

  it('returns empty array when prototypeName is empty string', () => {
    const flows = getFlowsForPrototype('')
    expect(flows).toEqual([])
  })

  it('excludes global flows (no prototype prefix)', () => {
    const flows = getFlowsForPrototype('Signup')
    const keys = flows.map(f => f.key)
    expect(keys).not.toContain('default')
  })

  it('returns single flow for prototype with one flow', () => {
    const flows = getFlowsForPrototype('Example')
    expect(flows).toHaveLength(1)
    expect(flows[0].name).toBe('basic')
  })
})

// ── useFlows hook ──

describe('useFlows', () => {
  it('returns flows for the current prototype', () => {
    const { result } = renderHook(() => useFlows(), {
      wrapper: createWrapperWithPrototype('Signup/empty-form', 'Signup'),
    })
    expect(result.current.flows).toHaveLength(4)
    expect(result.current.flows[0].title).toBe('Empty Form')
  })

  it('returns the active flow key', () => {
    const { result } = renderHook(() => useFlows(), {
      wrapper: createWrapperWithPrototype('Signup/validation-errors', 'Signup'),
    })
    expect(result.current.activeFlow).toBe('Signup/validation-errors')
  })

  it('returns prototype name', () => {
    const { result } = renderHook(() => useFlows(), {
      wrapper: createWrapperWithPrototype('Signup/empty-form', 'Signup'),
    })
    expect(result.current.prototypeName).toBe('Signup')
  })

  it('returns empty flows when no prototype', () => {
    const { result } = renderHook(() => useFlows(), {
      wrapper: createWrapperWithPrototype('default', null),
    })
    expect(result.current.flows).toEqual([])
  })

  it('switchFlow is a function', () => {
    const { result } = renderHook(() => useFlows(), {
      wrapper: createWrapperWithPrototype('Signup/empty-form', 'Signup'),
    })
    expect(typeof result.current.switchFlow).toBe('function')
  })

  it('flow entries have title from meta', () => {
    const { result } = renderHook(() => useFlows(), {
      wrapper: createWrapperWithPrototype('Signup/empty-form', 'Signup'),
    })
    const titles = result.current.flows.map(f => f.title)
    expect(titles).toContain('Empty Form')
    expect(titles).toContain('Validation Errors')
    expect(titles).toContain('Prefilled Review')
    expect(titles).toContain('Error State')
  })

  it('throws when used outside StoryboardProvider', () => {
    expect(() => {
      renderHook(() => useFlows())
    }).toThrow('useFlows must be used within a <StoryboardProvider>')
  })
})
