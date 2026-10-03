import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initKnobs } from '../../../core/index.js'
import { _resetWidgetRegistry } from '../../../core/stores/widgetRegistry.js'
import { setWidgetRef } from '../canvasApi.js'
import KnobsWidget from './KnobsWidget.jsx'

const KNOBS_ID = 'knobs-1'

const componentKnobs = {
  Alpha: [{ id: 'title', type: 'text', label: 'Alpha title', default: 'Alpha default' }],
  Beta: [{ id: 'mode', type: 'select', label: 'Beta mode', default: 'light', options: ['light', 'dark'] }],
}

function connector(id, start, end) {
  return {
    id,
    type: 'connector',
    start: { widgetId: start, anchor: 'right' },
    end: { widgetId: end, anchor: 'left' },
  }
}

function storyWidget(id, storyId, alias) {
  return {
    id,
    type: 'story',
    position: { x: 0, y: 0 },
    props: { storyId, alias, width: 400, height: 300 },
  }
}

function setBridge(widgets, connectors) {
  window.__storyboardCanvasBridgeState = {
    canvasId: 'test-canvas',
    widgets,
    connectors,
  }
}

function dispatchBridgeUpdate() {
  document.dispatchEvent(new CustomEvent('storyboard:canvas:bridge-updated'))
}

function paramsFor(targetWindow = window) {
  return new URLSearchParams(targetWindow.location.hash.replace(/^#/, ''))
}

function registerIframeWindow(widgetId) {
  const iframe = document.createElement('iframe')
  document.body.appendChild(iframe)
  setWidgetRef(widgetId, { getIframeWindow: () => iframe.contentWindow })
  return iframe.contentWindow
}

function renderWidget({ props = {}, onUpdate = vi.fn(), resizable = false } = {}) {
  return {
    onUpdate,
    ...render(
      <KnobsWidget
        id={KNOBS_ID}
        props={{ width: 360, height: 420, ...props }}
        onUpdate={onUpdate}
        resizable={resizable}
      />
    ),
  }
}

describe('KnobsWidget', () => {
  beforeEach(() => {
    initKnobs({ componentKnobs })
    _resetWidgetRegistry()
    window.history.replaceState(null, '', '/')
    setBridge([], [])
  })

  afterEach(() => {
    setWidgetRef('story-alpha', null)
    setWidgetRef('story-beta', null)
    delete window.__storyboardCanvasBridgeState
    cleanup()
    initKnobs()
    _resetWidgetRegistry()
  })

  it('renders an empty state when there are no connected targets', () => {
    renderWidget()

    expect(screen.getByText('Connect this widget to a prototype, component, or canvas widget to expose its knobs.')).toBeInTheDocument()
  })

  it('renders KnobsForm with a single connected target schema', () => {
    registerIframeWindow('story-alpha')
    setBridge(
      [storyWidget('story-alpha', 'Alpha', 'Alpha target')],
      [connector('connector-alpha', KNOBS_ID, 'story-alpha')],
    )

    renderWidget()

    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByLabelText('Alpha title')).toHaveValue('Alpha default')
  })

  it('renders tabs for multiple connected targets and swaps the active form on click', () => {
    registerIframeWindow('story-alpha')
    registerIframeWindow('story-beta')
    setBridge(
      [
        storyWidget('story-alpha', 'Alpha', 'Alpha target'),
        storyWidget('story-beta', 'Beta', 'Beta target'),
      ],
      [
        connector('connector-alpha', KNOBS_ID, 'story-alpha'),
        connector('connector-beta', KNOBS_ID, 'story-beta'),
      ],
    )

    renderWidget()

    expect(screen.getByRole('tab', { name: 'Alpha target' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Alpha title')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Beta target' }))

    expect(screen.getByRole('tab', { name: 'Beta target' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Beta mode')).toBeInTheDocument()
    expect(screen.queryByLabelText('Alpha title')).toBeNull()
  })

  it('uses activeTarget props and persists tab selection through onUpdate', () => {
    registerIframeWindow('story-alpha')
    registerIframeWindow('story-beta')
    setBridge(
      [
        storyWidget('story-alpha', 'Alpha', 'Alpha target'),
        storyWidget('story-beta', 'Beta', 'Beta target'),
      ],
      [
        connector('connector-alpha', KNOBS_ID, 'story-alpha'),
        connector('connector-beta', KNOBS_ID, 'story-beta'),
      ],
    )
    const onUpdate = vi.fn()

    renderWidget({ props: { activeTarget: 'story-beta' }, onUpdate })

    expect(screen.getByRole('tab', { name: 'Beta target' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'Alpha target' }))

    expect(onUpdate).toHaveBeenCalledWith({ activeTarget: 'story-alpha' })
    expect(screen.getByRole('tab', { name: 'Alpha target' })).toHaveAttribute('aria-selected', 'true')
  })

  it('falls back to the first remaining target when the active target disconnects', () => {
    registerIframeWindow('story-alpha')
    registerIframeWindow('story-beta')
    setBridge(
      [
        storyWidget('story-alpha', 'Alpha', 'Alpha target'),
        storyWidget('story-beta', 'Beta', 'Beta target'),
      ],
      [
        connector('connector-alpha', KNOBS_ID, 'story-alpha'),
        connector('connector-beta', KNOBS_ID, 'story-beta'),
      ],
    )
    const onUpdate = vi.fn()

    renderWidget({ props: { activeTarget: 'story-beta' }, onUpdate })
    expect(screen.getByText('Beta mode')).toBeInTheDocument()

    act(() => {
      setBridge(
        [storyWidget('story-alpha', 'Alpha', 'Alpha target')],
        [connector('connector-alpha', KNOBS_ID, 'story-alpha')],
      )
      dispatchBridgeUpdate()
    })

    expect(screen.getByLabelText('Alpha title')).toBeInTheDocument()
    expect(screen.queryByText('Beta mode')).toBeNull()
    expect(onUpdate).toHaveBeenCalledWith({ activeTarget: 'story-alpha' })
  })

  it('waits for iframe-backed targets instead of falling back to canvas hash writes', () => {
    setBridge(
      [storyWidget('story-alpha', 'Alpha', 'Alpha target')],
      [connector('connector-alpha', KNOBS_ID, 'story-alpha')],
    )

    renderWidget()

    expect(screen.getByText('Waiting for Alpha target to finish loading before writing knobs.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Alpha title')).toBeNull()
  })

  it('routes iframe writes to the target contentWindow hash, not the canvas hash', () => {
    const targetWindow = registerIframeWindow('story-alpha')
    setBridge(
      [storyWidget('story-alpha', 'Alpha', 'Alpha target')],
      [connector('connector-alpha', KNOBS_ID, 'story-alpha')],
    )

    renderWidget()

    fireEvent.change(screen.getByLabelText('Alpha title'), { target: { value: 'Iframe value' } })

    expect(paramsFor(targetWindow).get('knobTitle')).toBe('Iframe value')
    expect(paramsFor(window).get('knobTitle')).toBeNull()
  })

  it('preserves resize behavior by applying dimensions and persisting updates', () => {
    const onUpdate = vi.fn()
    const { container } = renderWidget({
      props: { width: 300, height: 240 },
      onUpdate,
      resizable: true,
    })
    const card = container.querySelector('[data-knobs-widget]')
    const handle = screen.getByRole('separator', { name: 'Resize' })

    expect(card.style.width).toBe('300px')
    expect(card.style.height).toBe('240px')

    Object.defineProperty(card, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(card, 'offsetHeight', { value: 240, configurable: true })

    fireEvent.mouseDown(handle, { clientX: 300, clientY: 240 })
    fireEvent.mouseMove(document, { clientX: 340, clientY: 280 })
    fireEvent.mouseUp(document)

    expect(onUpdate).toHaveBeenCalledWith({ width: 340, height: 280 })
  })
})
