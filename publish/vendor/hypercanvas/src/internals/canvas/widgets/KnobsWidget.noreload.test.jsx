import { createRef, forwardRef, useImperativeHandle, useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init, initKnobs, setKnobValue } from '../../../core/index.js'
import { _resetWidgetRegistry } from '../../../core/stores/widgetRegistry.js'
import { setWidgetRef } from '../canvasApi.js'
import KnobsWidget from './KnobsWidget.jsx'

const KNOBS_ID = 'knobs-iframe-noreload'
const PROTOTYPE_ID = 'prototype-iframe-noreload'
const PROTOTYPE_NAME = 'NoReloadPrototype'
const IFRAME_SRC = 'data:text/html,<html><body>hello</body></html>'

const prototypeKnobs = {
  [PROTOTYPE_NAME]: [
    { id: 'title', type: 'text', label: 'Title', default: 'Initial title' },
    { id: 'enabled', type: 'boolean', label: 'Enabled', default: false },
    { id: 'variant', type: 'select', label: 'Variant', default: 'small', options: ['small', 'large'] },
  ],
}

const FakePrototypeEmbed = forwardRef(function FakePrototypeEmbed(_props, ref) {
  const iframeRef = useRef(null)

  useImperativeHandle(ref, () => ({
    getIframeWindow() {
      return iframeRef.current?.contentWindow ?? null
    },
  }), [])

  return (
    <iframe
      ref={iframeRef}
      src={IFRAME_SRC}
      title="No reload prototype"
    />
  )
})

function connector(id, start, end) {
  return {
    id,
    type: 'connector',
    start: { widgetId: start, anchor: 'right' },
    end: { widgetId: end, anchor: 'left' },
  }
}

function prototypeWidget() {
  return {
    id: PROTOTYPE_ID,
    type: 'prototype',
    position: { x: 0, y: 0 },
    props: {
      src: `/${PROTOTYPE_NAME}`,
      alias: 'No reload prototype',
      width: 400,
      height: 300,
    },
  }
}

function setBridge(widgets, connectors) {
  window.__storyboardCanvasBridgeState = {
    canvasId: 'test-canvas',
    widgets,
    connectors,
  }
}

function seedDataIndex() {
  init({
    flows: {},
    objects: {},
    records: {},
    prototypes: {
      [PROTOTYPE_NAME]: {
        meta: { title: 'No Reload Prototype' },
      },
    },
    folders: {},
    canvases: {},
    stories: {},
  })
  initKnobs({ prototypeKnobs })
}

function renderWidget() {
  return render(
    <KnobsWidget
      id={KNOBS_ID}
      props={{ width: 360, height: 420 }}
      onUpdate={vi.fn()}
    />,
  )
}

async function mountIframeTarget() {
  const targetRef = createRef()
  let loadCount = 0

  const view = render(<FakePrototypeEmbed ref={targetRef} />)
  const iframe = view.container.querySelector('iframe')
  iframe.addEventListener('load', () => {
    loadCount += 1
  })

  act(() => {
    iframe.dispatchEvent(new Event('load'))
  })

  await waitFor(() => expect(loadCount).toBe(1))

  const iframeWindow = targetRef.current?.getIframeWindow()
  expect(iframe).toBeTruthy()
  expect(iframeWindow).toBe(iframe.contentWindow)

  setWidgetRef(PROTOTYPE_ID, targetRef.current)

  return {
    iframe,
    iframeWindow,
    getLoadCount: () => loadCount,
  }
}

function renderConnectedKnobsWidget() {
  setBridge(
    [prototypeWidget()],
    [connector('connector-prototype', KNOBS_ID, PROTOTYPE_ID)],
  )
  return renderWidget()
}

function hashParams(targetWindow) {
  return new URLSearchParams(targetWindow.location.hash.replace(/^#/, ''))
}

function changeSeveralKnobs(iframeWindow) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated title' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }))

  act(() => {
    setKnobValue('variant', 'large', { target: iframeWindow })
  })
}

async function flushMutationObserver() {
  await Promise.resolve()
}

describe('KnobsWidget iframe no-reload guard', () => {
  beforeEach(() => {
    seedDataIndex()
    _resetWidgetRegistry()
    window.history.replaceState(null, '', '/')
    setBridge([], [])
  })

  afterEach(() => {
    setWidgetRef(PROTOTYPE_ID, null)
    delete window.__storyboardCanvasBridgeState
    cleanup()
    initKnobs()
    _resetWidgetRegistry()
  })

  it('fires iframe load exactly once when text, boolean, and select knob values change', async () => {
    const { iframeWindow, getLoadCount } = await mountIframeTarget()
    renderConnectedKnobsWidget()

    expect(screen.getByLabelText('Title')).toHaveValue('Initial title')
    expect(getLoadCount()).toBe(1)

    changeSeveralKnobs(iframeWindow)
    await flushMutationObserver()

    const params = hashParams(iframeWindow)
    expect(params.get('knobTitle')).toBe('Updated title')
    expect(params.get('knobEnabled')).toBe('true')
    expect(params.get('knobVariant')).toBe('large')
    expect(getLoadCount()).toBe(1)
  })

  it('does not mutate the iframe src attribute in response to knob changes', async () => {
    const { iframe, iframeWindow } = await mountIframeTarget()
    renderConnectedKnobsWidget()
    const mutations = []
    const observer = new MutationObserver(records => {
      mutations.push(...records)
    })

    observer.observe(iframe, { attributes: true, attributeFilter: ['src'] })
    changeSeveralKnobs(iframeWindow)
    await flushMutationObserver()
    observer.disconnect()

    expect(mutations).toHaveLength(0)
    expect(iframe.getAttribute('src')).toBe(IFRAME_SRC)
  })

  it('mutates the iframe contentWindow location hash for direct knob writes', async () => {
    const { iframeWindow } = await mountIframeTarget()
    renderConnectedKnobsWidget()
    const beforeHash = iframeWindow.location.hash

    act(() => {
      setKnobValue('variant', 'large', { target: iframeWindow })
    })

    expect(beforeHash).not.toContain('knobVariant=large')
    expect(iframeWindow.location.hash).toContain('knobVariant=large')
    expect(hashParams(iframeWindow).get('knobVariant')).toBe('large')
  })
})
