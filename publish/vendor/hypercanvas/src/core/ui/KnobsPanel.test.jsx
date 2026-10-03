import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { initKnobs } from '../knobs/discovery.js'
import KnobsForm from '../../internals/Knobs/KnobsForm.jsx'
import KnobsPanel from './KnobsPanel.jsx'

vi.mock('../../internals/Knobs/KnobsForm.jsx', () => ({
  default: vi.fn(({ knobs = [], route, emptyMessage, className }) => (
    <div data-testid="knobs-form" data-route={route || ''} className={className}>
      {knobs.length > 0
        ? knobs.map(def => <div key={def.id}>{def.label || def.id}</div>)
        : <p>{emptyMessage}</p>}
    </div>
  )),
}))

function setLocation(path) {
  window.history.replaceState(null, '', path)
  window.dispatchEvent(new Event('hashchange'))
}

function params() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ''))
}

beforeEach(() => {
  vi.clearAllMocks()
  initKnobs({ prototypeKnobs: {}, componentKnobs: {} })
  setLocation('/')
})

describe('KnobsPanel', () => {
  it('renders hidden when knobsPanelOpen is not 1', () => {
    render(<KnobsPanel />)

    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('hidden')
  })

  it('opens when hash is set to knobsPanelOpen=1', () => {
    render(<KnobsPanel />)

    act(() => setLocation('/Demo#knobsPanelOpen=1'))

    expect(screen.getByRole('dialog')).not.toHaveAttribute('hidden')
  })

  it('removes the open hash key from the close button', () => {
    setLocation('/Demo#knobsPanelOpen=1')
    render(<KnobsPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Close knobs panel' }))

    expect(params().has('knobsPanelOpen')).toBe(false)
  })

  it('closes with Escape', () => {
    setLocation('/Demo#knobsPanelOpen=1')
    render(<KnobsPanel />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(params().has('knobsPanelOpen')).toBe(false)
  })

  it('persists the dragged position to the hash', () => {
    setLocation('/Demo#knobsPanelOpen=1&knobsPanelX=10&knobsPanelY=20')
    render(<KnobsPanel />)

    const handle = screen.getByRole('button', { name: 'Drag knobs panel' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 130, clientY: 145, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 130, clientY: 145, pointerId: 1 })

    expect(params().get('knobsPanelX')).toBe('40')
    expect(params().get('knobsPanelY')).toBe('65')
  })

  it('reads the initial position from the hash on mount', () => {
    setLocation('/Demo#knobsPanelOpen=1&knobsPanelX=123&knobsPanelY=234')
    render(<KnobsPanel />)

    expect(screen.getByRole('dialog')).toHaveStyle({ transform: 'translate(123px, 234px)' })
  })

  it('shows an empty state when the resolved prototype has no knobs', () => {
    setLocation('/NoKnobs#knobsPanelOpen=1')
    render(<KnobsPanel />)

    expect(screen.getByText('No knobs are defined for this route yet.')).toBeInTheDocument()
  })

  it('mounts a KnobsForm with the current prototype route knobs', () => {
    initKnobs({
      prototypeKnobs: {
        Demo: [
          { id: 'variant', type: 'select', label: 'Variant', options: ['a', 'b'] },
          { id: 'routeTitle', type: 'text', label: 'Route title', scope: '/Branding' },
          { id: 'otherRoute', type: 'text', label: 'Other route', scope: '/Other' },
        ],
      },
    })
    setLocation('/Demo/Branding#knobsPanelOpen=1')

    render(<KnobsPanel />)

    expect(screen.getByTestId('knobs-form')).toHaveAttribute('data-route', '/Branding')
    expect(screen.getByText('Variant')).toBeInTheDocument()
    expect(screen.getByText('Route title')).toBeInTheDocument()
    expect(screen.queryByText('Other route')).not.toBeInTheDocument()
    expect(KnobsForm).toHaveBeenCalled()
  })

  it('switches resolved knobs after SPA navigation', () => {
    initKnobs({
      prototypeKnobs: {
        Demo: [
          { id: 'one', type: 'text', label: 'Route one', scope: '/One' },
          { id: 'two', type: 'text', label: 'Route two', scope: '/Two' },
        ],
      },
    })
    setLocation('/Demo/One#knobsPanelOpen=1')
    render(<KnobsPanel />)

    expect(screen.getByText('Route one')).toBeInTheDocument()
    expect(screen.queryByText('Route two')).not.toBeInTheDocument()

    act(() => {
      window.history.pushState(null, '', '/Demo/Two#knobsPanelOpen=1')
    })

    expect(screen.getByText('Route two')).toBeInTheDocument()
    expect(screen.queryByText('Route one')).not.toBeInTheDocument()
  })
})
