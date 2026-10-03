import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import WidgetChrome from './WidgetChrome.jsx'

function renderChrome(extra = {}) {
  return render(
    <WidgetChrome widgetId="w1" widgetType="sticky-note" {...extra}>
      <div data-testid="inner">inner</div>
    </WidgetChrome>
  )
}

describe('WidgetChrome chrome/interaction switches', () => {
  it('renders the full chrome shell by default', () => {
    const { container, getByTestId } = renderChrome()
    expect(getByTestId('inner')).toBeTruthy()
    expect(container.querySelector('[data-widget-id="w1"]')).toBeTruthy()
    expect(container.querySelector('[data-widget-type="sticky-note"]')).toBeTruthy()
    // Drag surface is present (allows tiny-canvas drag) and select handle exists
    expect(container.querySelector('.tc-drag-surface')).toBeTruthy()
    expect(container.querySelector('.tc-drag-handle')).toBeTruthy()
    // Not flagged as chrome-disabled
    expect(container.querySelector('[data-widget-chrome-disabled]')).toBeNull()
  })

  it('chromeEnabled=false short-circuits to a minimal shell', () => {
    const { container, getByTestId } = renderChrome({ chromeEnabled: false })
    expect(getByTestId('inner')).toBeTruthy()
    const root = container.querySelector('[data-widget-id="w1"]')
    expect(root).toBeTruthy()
    expect(root.hasAttribute('data-widget-chrome-disabled')).toBe(true)
    expect(root.getAttribute('data-widget-type')).toBe('sticky-note')
    // No toolbar, no anchors, no select handle
    expect(container.querySelector('.tc-drag-surface')).toBeNull()
    expect(container.querySelector('.tc-drag-handle')).toBeNull()
    // Inner content rendered directly
    expect(root.contains(getByTestId('inner'))).toBe(true)
  })

  it('chromeEnabled=false propagates selected state for custom widgets', () => {
    const { container } = renderChrome({ chromeEnabled: false, selected: true })
    const root = container.querySelector('[data-widget-id="w1"]')
    expect(root.getAttribute('data-widget-selected')).toBe('true')
  })

  it('movable=false omits the tc-drag-surface class from the slot', () => {
    const { container } = renderChrome({ movable: false })
    expect(container.querySelector('.tc-drag-surface')).toBeNull()
    // Select handle still renders (selectable default true) and is no longer
    // a drag handle — should NOT carry tc-drag-handle.
    const handle = container.querySelector('button[aria-label*="Select"], button[aria-label*="selected"], button[aria-pressed]')
    expect(handle).toBeTruthy()
    expect(handle.className.includes('tc-drag-handle')).toBe(false)
  })

  it('selectable=false hides the select handle', () => {
    const { container } = renderChrome({ selectable: false })
    // The select-handle button has aria-pressed; no other button in chrome
    // exposes aria-pressed by default (color picker, etc. use aria-label only)
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
  })

  it('chromeEnabled=false skips select handle even when selectable=true', () => {
    const { container } = renderChrome({ chromeEnabled: false, selectable: true })
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
  })

  it('dispatches a gate-activated event when the interact gate is clicked', () => {
    const activated = vi.fn()
    document.addEventListener('storyboard:interact-gate-activated', activated)
    const { getByRole, container } = renderChrome({ widgetType: 'site-frame', widgetId: 'frame-9', widgetProps: { siteId: 'docs' }, selected: true })
    fireEvent.click(getByRole('button', { name: 'Click to interact' }))
    expect(activated).toHaveBeenCalledTimes(1)
    expect(activated.mock.calls[0][0].detail).toEqual({ widgetId: 'frame-9', widgetType: 'site-frame' })
    expect(container.querySelector('[data-widget-interacting]')).toBeTruthy()
    document.removeEventListener('storyboard:interact-gate-activated', activated)
  })

  it('leaves the interact gate off while an empty Site Frame is choosing a Site', () => {
    const { queryByRole } = renderChrome({ widgetType: 'site-frame', widgetProps: {} })
    expect(queryByRole('button', { name: 'Click to interact' })).toBeNull()
  })
})
