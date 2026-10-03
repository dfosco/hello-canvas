import { describe, it, expect, beforeEach } from 'vitest'
import { getParam, setParam, removeParam, getAllParams } from './session.js'

beforeEach(() => {
  window.location.hash = ''
})

describe('session hash params', () => {
  it('reads and writes plain params', () => {
    setParam('foo', 'bar')
    expect(window.location.hash).toBe('#foo=bar')
    expect(getParam('foo')).toBe('bar')
  })

  it('removes a param', () => {
    setParam('foo', 'bar')
    setParam('baz', 'qux')
    removeParam('foo')
    expect(getParam('foo')).toBeNull()
    expect(getParam('baz')).toBe('qux')
  })

  it('preserves a hash-router path prefix on write', () => {
    window.location.hash = '#/MyProto/SignupForm'
    setParam('knobLayoutDirection', 'vertical')
    expect(window.location.hash).toBe('#/MyProto/SignupForm?knobLayoutDirection=vertical')
  })

  it('reads params after a hash-router path prefix', () => {
    window.location.hash = '#/MyProto/SignupForm?knobLayoutDirection=vertical&theme=dark'
    expect(getParam('knobLayoutDirection')).toBe('vertical')
    expect(getParam('theme')).toBe('dark')
  })

  it('round-trips updates without losing the hash-router path', () => {
    window.location.hash = '#/MyProto/Signup?theme=dark'
    setParam('knobFoo', 'bar')
    expect(window.location.hash).toBe('#/MyProto/Signup?theme=dark&knobFoo=bar')
    removeParam('theme')
    expect(window.location.hash).toBe('#/MyProto/Signup?knobFoo=bar')
  })

  it('getAllParams ignores the hash-router path portion', () => {
    window.location.hash = '#/route?a=1&b=2'
    expect(getAllParams()).toEqual({ a: '1', b: '2' })
  })
})
