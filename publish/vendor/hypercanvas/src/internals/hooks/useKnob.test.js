import { createElement } from 'react'
import { renderHook } from '@testing-library/react'
import { StoryboardContext } from '../StoryboardContext.js'
import { initKnobs } from '../../core/knobs/index.js'
import { detectKnobRoute, useKnob } from './useKnob.js'

function wrapper(prototypeName = 'Signup') {
  return function Wrapper({ children }) {
    return createElement(
      StoryboardContext.Provider,
      { value: { data: {}, error: null, loading: false, prototypeName } },
      children,
    )
  }
}

beforeEach(() => {
  initKnobs()
  window.history.pushState(null, '', '/')
})

describe('detectKnobRoute', () => {
  it('detects prototype and route from normal and branch-prefixed paths', () => {
    expect(detectKnobRoute('/Signup/Branding')).toEqual({
      prototypeName: 'Signup',
      route: '/Branding',
    })
    expect(detectKnobRoute('/branch--knobs-system/Signup/Branding')).toEqual({
      prototypeName: 'Signup',
      route: '/Branding',
    })
  })

  it('strips the /prototypes.html iframe-isolation prefix', () => {
    expect(detectKnobRoute('/prototypes.html/Signup')).toEqual({
      prototypeName: 'Signup',
      route: undefined,
    })
    expect(detectKnobRoute('/prototypes.html/Signup/Branding')).toEqual({
      prototypeName: 'Signup',
      route: '/Branding',
    })
  })
})

describe('useKnob', () => {
  it('returns a prototype-wide default when no hash value is present', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: [{ id: 'showAvatar', type: 'boolean', default: true }],
      },
    })
    window.history.pushState(null, '', '/Signup')

    const { result } = renderHook(() => useKnob('showAvatar'), {
      wrapper: wrapper('Signup'),
    })

    expect(result.current).toBe(true)
  })

  it('coerces prototype-wide hash values', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: [{ id: 'showAvatar', type: 'boolean', default: true }],
      },
    })
    window.history.pushState(null, '', '/Signup#knobShowAvatar=false')

    const { result } = renderHook(() => useKnob('showAvatar'), {
      wrapper: wrapper('Signup'),
    })

    expect(result.current).toBe(false)
  })

  it('auto-detects route-scoped knob values', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: [{
          id: 'variant',
          type: 'select',
          scope: '/Branding',
          options: ['small', 'large'],
          default: 'small',
        }],
      },
    })
    window.history.pushState(null, '', '/Signup/Branding#knobBrandingVariant=large')

    const { result } = renderHook(() => useKnob('variant'), {
      wrapper: wrapper('Signup'),
    })

    expect(result.current).toBe('large')
  })

  it('treats scope as a route alias', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: [{
          id: 'variant',
          type: 'select',
          scope: '/Branding',
          options: ['small', 'large'],
          default: 'small',
        }],
      },
    })
    window.history.pushState(null, '', '/Signup#knobBrandingVariant=large')

    const { result } = renderHook(() => useKnob('variant', { scope: '/Branding' }), {
      wrapper: wrapper('Signup'),
    })

    expect(result.current).toBe('large')
  })

  it('falls back to defaults for malformed hash values', () => {
    initKnobs({
      prototypeKnobs: {
        Signup: [{ id: 'showAvatar', type: 'boolean', default: true }],
      },
    })
    window.history.pushState(null, '', '/Signup#knobShowAvatar=nope')

    const { result } = renderHook(() => useKnob('showAvatar'), {
      wrapper: wrapper('Signup'),
    })

    expect(result.current).toBe(true)
  })
})
