import { setKnobValue, clearKnobValue, serializeKnobValue } from './writer.js'

function paramsFor(location = window.location) {
  return new URLSearchParams(location.hash.replace(/^#/, ''))
}

beforeEach(() => {
  window.location.hash = ''
  document.body.innerHTML = ''
})

describe('serializeKnobValue', () => {
  it('serializes common typed knob values', () => {
    expect(serializeKnobValue(true, { type: 'boolean' })).toBe('true')
    expect(serializeKnobValue(false, { type: 'boolean' })).toBe('false')
    expect(serializeKnobValue([1, 5], { type: 'range' })).toBe('1,5')
    expect(serializeKnobValue(['a', 'b'], { type: 'string-array' })).toBe('["a","b"]')
  })
})

describe('setKnobValue', () => {
  it('sets same-window hash params and preserves existing params', () => {
    window.location.hash = 'flow=default'

    setKnobValue('variant', 'large')
    setKnobValue('showAvatar', true, { def: { type: 'boolean' } })

    const params = paramsFor()
    expect(params.get('flow')).toBe('default')
    expect(params.get('knobVariant')).toBe('large')
    expect(params.get('knobShowAvatar')).toBe('true')
  })

  it('sets route-scoped hash params', () => {
    setKnobValue('variant', 'large', { route: '/Branding' })

    expect(paramsFor().get('knobBrandingVariant')).toBe('large')
  })

  it('writes to an iframe contentWindow without mutating iframe src', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    iframe.contentWindow.location.hash = 'flow=default'
    const originalSrc = iframe.getAttribute('src')

    setKnobValue('range', [1, 10], {
      target: iframe.contentWindow,
      def: { type: 'range' },
    })

    const params = paramsFor(iframe.contentWindow.location)
    expect(params.get('flow')).toBe('default')
    expect(params.get('knobRange')).toBe('1,10')
    expect(iframe.getAttribute('src')).toBe(originalSrc)
  })
})

describe('clearKnobValue', () => {
  it('removes same-window hash params', () => {
    window.location.hash = 'knobVariant=large&flow=default'

    clearKnobValue('variant')

    const params = paramsFor()
    expect(params.get('knobVariant')).toBeNull()
    expect(params.get('flow')).toBe('default')
  })

  it('accepts an iframe element target', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    iframe.contentWindow.location.hash = 'knobBrandingVariant=large&flow=default'

    clearKnobValue('variant', { route: '/Branding', target: iframe })

    const params = paramsFor(iframe.contentWindow.location)
    expect(params.get('knobBrandingVariant')).toBeNull()
    expect(params.get('flow')).toBe('default')
  })
})

describe('hash-router coexistence', () => {
  it('preserves a hash-router path prefix when writing knob values to an iframe', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    // Simulate the prototypes-entry hash router state.
    iframe.contentWindow.location.hash = '/MyProto/SignupForm'

    setKnobValue('layoutDirection', 'vertical', { target: iframe })

    expect(iframe.contentWindow.location.hash).toBe('#/MyProto/SignupForm?knobLayoutDirection=vertical')
  })

  it('appends to existing knob params without disturbing the path', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    iframe.contentWindow.location.hash = '/MyProto/Signup?theme=dark'

    setKnobValue('layoutDirection', 'vertical', { target: iframe })

    expect(iframe.contentWindow.location.hash).toBe('#/MyProto/Signup?theme=dark&knobLayoutDirection=vertical')
  })

  it('clears a single knob without removing other params or the path', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    iframe.contentWindow.location.hash = '/MyProto/Signup?theme=dark&knobFoo=bar'

    clearKnobValue('foo', { target: iframe })

    expect(iframe.contentWindow.location.hash).toBe('#/MyProto/Signup?theme=dark')
  })
})
