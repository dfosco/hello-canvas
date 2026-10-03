import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useIframeDevLogs } from './iframeDevLogs.js'

function Probe({ widget = 'Probe', loaded = false, src = '/test' }) {
  useIframeDevLogs({ widget, loaded, src })
  return null
}

describe('useIframeDevLogs', () => {
  let logSpy

  beforeEach(() => {
    window.__SB_LOCAL_DEV__ = true
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    delete window.__SB_LOCAL_DEV__
  })

  it('logs iframe load and unload with tally', () => {
    const { rerender, unmount } = render(<Probe loaded={false} src="/alpha" />)
    rerender(<Probe loaded src="/alpha" />)
    rerender(<Probe loaded={false} src="/alpha" />)

    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      '[storyboard][iframe] loaded | count=1 | Probe',
      { event: 'loaded', count: 1, widget: 'Probe', src: '/alpha' },
    )
    expect(logSpy).toHaveBeenNthCalledWith(
      2,
      '[storyboard][iframe] unloaded | count=0 | Probe',
      { event: 'unloaded', count: 0, widget: 'Probe', src: '/alpha' },
    )

    unmount()
  })

  it('tracks tally across multiple loaded iframes', () => {
    const first = render(<Probe widget="PrototypeEmbed" loaded src="/proto" />)
    const second = render(<Probe widget="FigmaEmbed" loaded src="/figma" />)

    expect(logSpy).toHaveBeenNthCalledWith(
      1,
      '[storyboard][iframe] loaded | count=1 | PrototypeEmbed',
      { event: 'loaded', count: 1, widget: 'PrototypeEmbed', src: '/proto' },
    )
    expect(logSpy).toHaveBeenNthCalledWith(
      2,
      '[storyboard][iframe] loaded | count=2 | FigmaEmbed',
      { event: 'loaded', count: 2, widget: 'FigmaEmbed', src: '/figma' },
    )

    first.unmount()
    expect(logSpy).toHaveBeenNthCalledWith(
      3,
      '[storyboard][iframe] unloaded | count=1 | PrototypeEmbed',
      { event: 'unloaded', count: 1, widget: 'PrototypeEmbed', src: '/proto' },
    )

    second.unmount()
    expect(logSpy).toHaveBeenNthCalledWith(
      4,
      '[storyboard][iframe] unloaded | count=0 | FigmaEmbed',
      { event: 'unloaded', count: 0, widget: 'FigmaEmbed', src: '/figma' },
    )
  })

  it('does not log outside local dev runtime', () => {
    window.__SB_LOCAL_DEV__ = false
    const { rerender, unmount } = render(<Probe loaded={false} src="/off" />)
    rerender(<Probe loaded src="/off" />)
    rerender(<Probe loaded={false} src="/off" />)

    expect(logSpy).not.toHaveBeenCalled()
    unmount()
  })
})
