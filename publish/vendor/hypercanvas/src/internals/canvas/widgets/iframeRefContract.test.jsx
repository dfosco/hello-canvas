import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { init } from '../../../core/index.js'
import { getWidgetRef, setWidgetRef } from '../canvasApi.js'
import PrototypeEmbed from './PrototypeEmbed.jsx'
import StoryWidget from './StoryWidget.jsx'
import StorySetWidget from './StorySetWidget.jsx'
import FigmaEmbed from './FigmaEmbed.jsx'
import CodePenEmbed from './CodePenEmbed.jsx'

const originalFetch = globalThis.fetch

const storyIndex = {
  DemoStory: {
    _route: '/components/DemoStory',
    _storyModule: '/src/components/Demo/Demo.story.jsx',
  },
}

function seedDataIndex() {
  init({
    flows: {},
    objects: {},
    records: {},
    prototypes: {},
    folders: {},
    canvases: {},
    stories: storyIndex,
  })
}

/**
 * PrototypeEmbed mounts its iframe only after the interact gate is activated
 * (dormant Frames render the persistent poster instead). Click the gate when
 * present so ref-contract assertions observe the admitted iframe.
 */
function activateInteractGate(container) {
  const gate = container.querySelector('[aria-label="Click to interact with prototype"]')
  if (gate) fireEvent.click(gate)
}

function expectIframeWindow(Component, props) {
  const ref = createRef()
  const { container } = render(<Component id="widget-id" props={props} ref={ref} />)
  activateInteractGate(container)
  const iframe = container.querySelector('iframe')

  expect(iframe).toBeTruthy()
  expect(ref.current?.getIframeWindow()).toBe(iframe.contentWindow)
}

describe('iframe widget ref contract', () => {
  beforeEach(() => {
    seedDataIndex()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false })
  })

  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
  })

  it.each([
    ['PrototypeEmbed', PrototypeEmbed, { src: '/Demo', width: 320, height: 240, zoom: 100 }],
    ['StoryWidget', StoryWidget, { storyId: 'DemoStory', exportName: 'Default', width: 320, height: 240 }],
    ['StorySetWidget', StorySetWidget, { storyId: 'DemoStory', width: 320, height: 240 }],
    ['FigmaEmbed', FigmaEmbed, { url: 'https://www.figma.com/design/ABC123/Demo-File', width: 320, height: 240 }],
    ['CodePenEmbed', CodePenEmbed, { url: 'https://codepen.io/demo/pen/ABC123', width: 320, height: 240 }],
  ])('%s exposes its iframe contentWindow', (_name, Component, props) => {
    expectIframeWindow(Component, props)
  })

  it('returns null when no iframe is mounted', () => {
    const ref = createRef()
    expect(ref.current).toBeNull()

    render(<PrototypeEmbed id="prototype-empty" props={{ src: '' }} ref={ref} />)

    expect(ref.current?.getIframeWindow()).toBeNull()
  })

  it('returns null when contentWindow access throws', () => {
    const ref = createRef()
    const { container } = render(
      <PrototypeEmbed
        id="prototype-denied"
        props={{ src: '/Demo', width: 320, height: 240, zoom: 100 }}
        ref={ref}
      />,
    )
    activateInteractGate(container)
    const iframe = container.querySelector('iframe')

    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get() {
        throw new Error('contentWindow denied')
      },
    })

    expect(ref.current?.getIframeWindow()).toBeNull()
  })

  it('reloads local canvas embeds when their Site starts', () => {
    const { container } = render(<PrototypeEmbed id="site-embed" props={{ src: 'http://localhost:4311/' }} />)
    activateInteractGate(container)
    const originalFrame = container.querySelector('iframe')

    act(() => {
      document.dispatchEvent(new CustomEvent('storyboard:site-started', {
        detail: { siteId: 'local-site', developmentBaseUrl: 'http://localhost:4311/' },
      }))
    })

    expect(container.querySelector('iframe')).not.toBe(originalFrame)
  })

  it('does not reload a local canvas embed for a different Site origin', () => {
    const { container } = render(<PrototypeEmbed id="other-site-embed" props={{ src: 'http://localhost:4311/' }} />)
    activateInteractGate(container)
    const originalFrame = container.querySelector('iframe')

    act(() => {
      document.dispatchEvent(new CustomEvent('storyboard:site-started', {
        detail: { siteId: 'another-site', developmentBaseUrl: 'http://localhost:4321/' },
      }))
    })

    expect(container.querySelector('iframe')).toBe(originalFrame)
  })

  it('exposes registered widget instances through canvasApi.getWidgetRef', () => {
    const handle = { getIframeWindow: vi.fn() }

    setWidgetRef('target-widget', handle)
    expect(getWidgetRef('target-widget')).toBe(handle)

    setWidgetRef('target-widget', null)
    expect(getWidgetRef('target-widget')).toBeNull()
  })
})
