import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Widget from './Widget.jsx'
import {
  registerWidget,
  _resetWidgetRegistry,
} from '../../../core/stores/widgetRegistry.js'

afterEach(() => {
  _resetWidgetRegistry()
  vi.restoreAllMocks()
})

// A minimal probe widget that renders its props and exposes onUpdate so we can
// assert the standard contract the dispatcher supplies.
function ProbeWidget({ id, props, onUpdate, resizable }) {
  return (
    <div data-testid="probe" data-id={id} data-resizable={String(resizable)}>
      <span data-testid="text">{props?.text ?? ''}</span>
      <span data-testid="width">{String(props?.width ?? '')}</span>
      <button type="button" onClick={() => onUpdate({ text: 'updated' })}>
        update
      </button>
    </div>
  )
}

describe('<Widget>', () => {
  it('resolves a registered type and maps non-reserved props into the widget props object', () => {
    registerWidget('probe', { component: ProbeWidget })

    render(<Widget type="probe" text="hello" width={320} />)

    expect(screen.getByTestId('probe')).toBeInTheDocument()
    expect(screen.getByTestId('text').textContent).toBe('hello')
    expect(screen.getByTestId('width').textContent).toBe('320')
  })

  it('applies className and data-widget-type to the wrapper', () => {
    registerWidget('probe', { component: ProbeWidget })

    const { container } = render(
      <Widget type="probe" className="my-class" text="x" />,
    )

    const wrapper = container.querySelector('[data-widget-type="probe"]')
    expect(wrapper).toBeTruthy()
    expect(wrapper.className).toContain('my-class')
  })

  it('forwards the resizable prop to the widget', () => {
    registerWidget('probe', { component: ProbeWidget })

    render(<Widget type="probe" resizable text="x" />)
    expect(screen.getByTestId('probe').getAttribute('data-resizable')).toBe('true')

    _resetWidgetRegistry()
    registerWidget('probe', { component: ProbeWidget })
    render(<Widget type="probe" text="y" />)
    const probes = screen.getAllByTestId('probe')
    expect(probes[probes.length - 1].getAttribute('data-resizable')).toBe('false')
  })

  it('defaults onUpdate to internal local state (uncontrolled)', () => {
    registerWidget('probe', { component: ProbeWidget })

    render(<Widget type="probe" text="initial" />)
    expect(screen.getByTestId('text').textContent).toBe('initial')

    fireEvent.click(screen.getByText('update'))
    expect(screen.getByTestId('text').textContent).toBe('updated')
  })

  it('uses a consumer-supplied onUpdate when provided (controlled)', () => {
    registerWidget('probe', { component: ProbeWidget })
    const onUpdate = vi.fn()

    render(<Widget type="probe" text="initial" onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText('update'))

    expect(onUpdate).toHaveBeenCalledWith({ text: 'updated' })
    // Controlled: local state is not applied, text stays as the incoming prop.
    expect(screen.getByTestId('text').textContent).toBe('initial')
  })

  it('does not forward reserved props into the widget props object', () => {
    function PropsSpy({ props }) {
      return <pre data-testid="json">{JSON.stringify(props)}</pre>
    }
    registerWidget('spy', { component: PropsSpy })

    render(
      <Widget
        type="spy"
        id="fixed-id"
        className="c"
        draggable
        resizable
        text="keep"
      />,
    )

    const parsed = JSON.parse(screen.getByTestId('json').textContent)
    expect(parsed).toEqual({ text: 'keep' })
  })

  it('renders nothing and warns for an unknown type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<Widget type="does-not-exist" />)

    expect(container.firstChild).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown widget type "does-not-exist"'),
    )
  })

  it('applies a translate transform to the wrapper when draggable is set', () => {
    registerWidget('probe', { component: ProbeWidget })

    const { container } = render(<Widget type="probe" draggable text="x" />)
    const wrapper = container.querySelector('[data-widget-type="probe"]')
    expect(wrapper.style.transform).toContain('translate(')
  })

  it('renders the chrome select handle by default and selects on handle click', () => {
    registerWidget('probe', { component: ProbeWidget })

    const { container } = render(<Widget type="probe" text="x" />)
    const handle = container.querySelector('[aria-label="Select widget"]')
    expect(handle).toBeTruthy()
    expect(handle.getAttribute('aria-pressed')).toBe('false')

    // pointerDown without movement selects on pointerUp.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.pointerUp(document, { clientX: 0, clientY: 0 })

    expect(container.querySelector('[aria-pressed="true"]')).toBeTruthy()
    expect(container.querySelector('[data-widget-selected]')).toBeTruthy()
  })

  it('selects when clicking anywhere on the widget body', () => {
    registerWidget('probe', { component: ProbeWidget })

    const { container } = render(<Widget type="probe" text="x" />)
    expect(container.querySelector('[data-widget-selected]')).toBeNull()

    fireEvent.click(screen.getByTestId('probe'))
    expect(container.querySelector('[data-widget-selected]')).toBeTruthy()
  })

  it('deselects when clicking outside the widget', () => {
    registerWidget('probe', { component: ProbeWidget })

    const { container } = render(
      <div>
        <Widget type="probe" text="x" />
        <button type="button">outside</button>
      </div>,
    )

    fireEvent.click(screen.getByTestId('probe'))
    expect(container.querySelector('[data-widget-selected]')).toBeTruthy()

    fireEvent.pointerDown(screen.getByText('outside'))
    expect(container.querySelector('[data-widget-selected]')).toBeNull()
  })

  it('omits chrome (no handle, no selection) when chrome={false}', () => {
    registerWidget('probe', { component: ProbeWidget })

    const { container } = render(<Widget type="probe" chrome={false} text="x" />)
    expect(container.querySelector('[aria-label="Select widget"]')).toBeNull()
    expect(screen.getByTestId('probe')).toBeInTheDocument()
  })

  it('does not forward the chrome prop into the widget props object', () => {
    function PropsSpy({ props }) {
      return <pre data-testid="json">{JSON.stringify(props)}</pre>
    }
    registerWidget('spy', { component: PropsSpy })

    render(<Widget type="spy" chrome text="keep" />)
    const parsed = JSON.parse(screen.getByTestId('json').textContent)
    expect(parsed).toEqual({ text: 'keep' })
  })
})
