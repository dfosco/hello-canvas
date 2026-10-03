import { vi } from 'vitest'
import { interceptHideParams, installHideParamListener } from './interceptHideParams.js'

vi.mock('./hideMode.js', () => ({
  activateHideMode: vi.fn(),
  deactivateHideMode: vi.fn(),
}))

import { activateHideMode, deactivateHideMode } from './hideMode.js'

beforeEach(() => {
  vi.clearAllMocks()
  window.history.pushState(null, '', '/')
})

describe('interceptHideParams', () => {
  it('no-ops when no hide/show params are present', () => {
    interceptHideParams()

    expect(activateHideMode).not.toHaveBeenCalled()
    expect(deactivateHideMode).not.toHaveBeenCalled()
  })

  it('calls activateHideMode when ?hide is present', () => {
    window.history.pushState(null, '', '?hide')

    interceptHideParams()

    expect(activateHideMode).toHaveBeenCalledTimes(1)
    expect(deactivateHideMode).not.toHaveBeenCalled()
  })

  it('calls deactivateHideMode when ?show is present', () => {
    window.history.pushState(null, '', '?show')

    interceptHideParams()

    expect(deactivateHideMode).toHaveBeenCalledTimes(1)
    expect(activateHideMode).not.toHaveBeenCalled()
  })

  it('prefers ?hide over ?show when both are present', () => {
    window.history.pushState(null, '', '?hide&show')

    interceptHideParams()

    expect(activateHideMode).toHaveBeenCalledTimes(1)
    expect(deactivateHideMode).not.toHaveBeenCalled()
  })

  it('is idempotent — safe to call multiple times', () => {
    window.history.pushState(null, '', '?hide')

    interceptHideParams()
    interceptHideParams()
    interceptHideParams()

    expect(activateHideMode).toHaveBeenCalledTimes(3)
  })

  it('no-ops when URL has unrelated query params', () => {
    window.history.pushState(null, '', '?scene=overview&foo=bar')

    interceptHideParams()

    expect(activateHideMode).not.toHaveBeenCalled()
    expect(deactivateHideMode).not.toHaveBeenCalled()
  })
})

describe('installHideParamListener', () => {
  it('calls interceptHideParams immediately', () => {
    window.history.pushState(null, '', '?hide')
    const spy = vi.spyOn(window, 'addEventListener')

    installHideParamListener()

    expect(activateHideMode).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('adds a popstate listener', () => {
    const spy = vi.spyOn(window, 'addEventListener')

    installHideParamListener()

    expect(spy).toHaveBeenCalledWith('popstate', expect.any(Function))
    spy.mockRestore()
  })
})
