import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import KnobsForm from './KnobsForm.jsx'

vi.mock('../../core/knobs/index.js', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    setKnobValue: vi.fn(actual.setKnobValue),
    clearKnobValue: vi.fn(actual.clearKnobValue),
  }
})

function paramsFor(targetWindow = window) {
  return new URLSearchParams(targetWindow.location.hash.replace(/^#/, ''))
}

function setHash(hash, targetWindow = window) {
  if (targetWindow === window) {
    window.history.replaceState(null, '', `/${hash}`)
  } else {
    targetWindow.location.hash = hash
  }
  targetWindow.dispatchEvent(new HashChangeEvent('hashchange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
  document.body.innerHTML = ''
})

describe('KnobsForm', () => {
  it('renders the empty state when there are no knobs', () => {
    render(<KnobsForm knobs={[]} />)

    expect(screen.getByText('No knobs are available for this selection yet.')).toBeInTheDocument()
  })

  it.each([
    ['text', { id: 'title', type: 'text', label: 'Title', default: 'Hello' }, () => screen.getByLabelText('Title')],
    ['textarea', { id: 'bio', type: 'textarea', label: 'Bio', default: 'About' }, () => screen.getByLabelText('Bio')],
    ['number', { id: 'count', type: 'number', label: 'Count', default: 2, min: 0, max: 5 }, () => screen.getByLabelText('Count')],
    ['slider', { id: 'size', type: 'slider', label: 'Size', default: 5, min: 0, max: 10 }, () => screen.getByLabelText('Size')],
    ['boolean', { id: 'enabled', type: 'boolean', label: 'Enabled', default: true }, () => screen.getByRole('checkbox', { name: 'Enabled' })],
    ['select', { id: 'mode', type: 'select', label: 'Mode', default: 'light', options: ['light', 'dark'] }, () => screen.getByText('Mode')],
    ['radio', { id: 'variant', type: 'radio', label: 'Variant', default: 'small', options: [{ label: 'Small', value: 'small' }, { label: 'Large', value: 'large' }] }, () => screen.getByText('Small')],
    ['range', { id: 'bounds', type: 'range', label: 'Bounds', default: [1, 4], min: 0, max: 10 }, () => screen.getByLabelText('Bounds min')],
    ['date', { id: 'due', type: 'date', label: 'Due date', default: '2026-06-06' }, () => screen.getByLabelText('Due date')],
    ['object', { id: 'theme', type: 'object', label: 'Theme', knobs: [{ id: 'primary', type: 'text', label: 'Primary', default: 'blue' }] }, () => screen.getByRole('group', { name: 'Theme' })],
    ['string-array', { id: 'tags', type: 'string-array', label: 'Tags', default: ['alpha'] }, () => screen.getByLabelText('Tags item 1')],
  ])('renders a field for %s knobs', (_, def, findField) => {
    render(<KnobsForm knobs={[def]} />)

    expect(findField()).toBeInTheDocument()
  })

  it('editing a text field writes the knob value to the hash', () => {
    render(<KnobsForm knobs={[{ id: 'title', type: 'text', label: 'Title', default: 'Default' }]} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Custom' } })

    expect(paramsFor().get('knobTitle')).toBe('Custom')
    expect(screen.getByLabelText('Title')).toHaveValue('Custom')
  })

  it('routes writes to the target window hash when target is provided', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    setHash('#knobTitle=Inside', iframe.contentWindow)

    render(
      <KnobsForm
        knobs={[{ id: 'title', type: 'text', label: 'Title', default: 'Default' }]}
        target={iframe.contentWindow}
      />,
    )

    expect(screen.getByLabelText('Title')).toHaveValue('Inside')

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Iframe value' } })

    expect(paramsFor(iframe.contentWindow).get('knobTitle')).toBe('Iframe value')
    expect(paramsFor(window).get('knobTitle')).toBeNull()
  })

  it('round-trips boolean true and false hash strings correctly', () => {
    setHash('#knobEnabled=false')
    render(<KnobsForm knobs={[{ id: 'enabled', type: 'boolean', label: 'Enabled', default: true }]} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' })
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)

    expect(paramsFor().get('knobEnabled')).toBe('true')
    expect(checkbox).toBeChecked()
  })

  it('marks invalid raw values with inline validation', () => {
    setHash('#knobCount=20')
    render(<KnobsForm knobs={[{ id: 'count', type: 'number', label: 'Count', default: 3, min: 0, max: 10 }]} />)

    expect(screen.getByText('Must be at most 10.')).toBeInTheDocument()
    expect(screen.getByLabelText('Count')).toHaveAttribute('data-invalid', 'true')
  })
})
