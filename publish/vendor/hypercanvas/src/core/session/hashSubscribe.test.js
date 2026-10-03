import { subscribeToHash, getHashSnapshot } from './hashSubscribe.js'

describe('subscribeToHash', () => {
  it('returns an unsubscribe function', () => {
    const unsub = subscribeToHash(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('callback fires on hashchange event', () => {
    const cb = vi.fn()
    const unsub = subscribeToHash(cb)

    window.dispatchEvent(new Event('hashchange'))
    expect(cb).toHaveBeenCalledTimes(1)

    unsub()
  })

  it('callback does NOT fire after unsubscribe', () => {
    const cb = vi.fn()
    const unsub = subscribeToHash(cb)
    unsub()

    window.dispatchEvent(new Event('hashchange'))
    expect(cb).not.toHaveBeenCalled()
  })

  it('multiple subscribers all fire', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const unsub1 = subscribeToHash(cb1)
    const unsub2 = subscribeToHash(cb2)

    window.dispatchEvent(new Event('hashchange'))
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)

    unsub1()
    unsub2()
  })
})

describe('getHashSnapshot', () => {
  it('returns current hash string', () => {
    window.location.hash = '#foo=bar'
    expect(getHashSnapshot()).toBe('#foo=bar')
  })

  it('returns empty string when no hash', () => {
    window.location.hash = ''
    expect(getHashSnapshot()).toBe('')
  })

  it('reflects hash changes immediately', () => {
    expect(getHashSnapshot()).toBe('')
    window.location.hash = '#a=1'
    expect(getHashSnapshot()).toBe('#a=1')
    window.location.hash = '#b=2'
    expect(getHashSnapshot()).toBe('#b=2')
  })
})
