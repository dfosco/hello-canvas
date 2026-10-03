import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PageSelector from './PageSelector.jsx'

const PAGES = [
  { name: 'research/interviews', route: '/canvas/research/interviews', title: 'Interviews' },
  { name: 'research/surveys', route: '/canvas/research/surveys', title: 'Surveys' },
  { name: 'research/analysis', route: '/canvas/research/analysis', title: 'Analysis' },
]

describe('PageSelector', () => {
  beforeEach(() => {
    // Reset location mock — use a setter spy so we can track assignments
    delete window.location
    const loc = { _href: '' }
    Object.defineProperty(loc, 'href', {
      get() { return loc._href },
      set(v) { loc._href = v },
      configurable: true,
    })
    window.location = loc
  })

  it('renders nothing when fewer than 2 pages', () => {
    const { container } = render(<PageSelector currentName="solo" pages={[{ name: 'solo', route: '/canvas/solo', title: 'Solo' }]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when pages is empty', () => {
    const { container } = render(<PageSelector currentName="foo" pages={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows current page label and page count', () => {
    render(<PageSelector currentName="research/interviews" pages={PAGES} />)
    expect(screen.getByText('Interviews')).toBeTruthy()
    expect(screen.getByText('1/3')).toBeTruthy()
  })

  it('shows correct index for non-first page', () => {
    render(<PageSelector currentName="research/surveys" pages={PAGES} />)
    expect(screen.getByText('Surveys')).toBeTruthy()
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('opens dropdown on click and shows all pages', () => {
    render(<PageSelector currentName="research/interviews" pages={PAGES} />)
    const trigger = screen.getByTitle('Switch canvas page')
    fireEvent.click(trigger)

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0].textContent).toBe('Interviews')
    expect(options[1].textContent).toBe('Surveys')
    expect(options[2].textContent).toBe('Analysis')
  })

  it('marks the current page as active', () => {
    render(<PageSelector currentName="research/surveys" pages={PAGES} />)
    fireEvent.click(screen.getByTitle('Switch canvas page'))

    const options = screen.getAllByRole('option')
    expect(options[1].getAttribute('aria-selected')).toBe('true')
    expect(options[0].getAttribute('aria-selected')).toBe('false')
  })

  it('navigates to selected page', async () => {
    render(<PageSelector currentName="research/interviews" pages={PAGES} />)
    fireEvent.click(screen.getByTitle('Switch canvas page'))
    // Click the option in the menu (not the trigger label)
    const options = screen.getAllByRole('option')
    const link = options[1].querySelector('a')
    fireEvent.click(link) // Surveys

    // Navigation uses a 300ms setTimeout for mouse clicks
    await waitFor(() => {
      expect(window.location.href).toContain('/canvas/research/surveys')
    })
  })

  it('closes dropdown on Escape', () => {
    render(<PageSelector currentName="research/interviews" pages={PAGES} />)
    fireEvent.click(screen.getByTitle('Switch canvas page'))
    expect(screen.queryByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes dropdown on outside click', () => {
    render(
      <div>
        <PageSelector currentName="research/interviews" pages={PAGES} />
        <span data-testid="outside">Outside</span>
      </div>
    )
    fireEvent.click(screen.getByTitle('Switch canvas page'))
    expect(screen.queryByRole('listbox')).toBeTruthy()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not navigate when selecting the current page', () => {
    render(<PageSelector currentName="research/interviews" pages={PAGES} />)
    fireEvent.click(screen.getByTitle('Switch canvas page'))
    // Click the current page option
    const options = screen.getAllByRole('option')
    fireEvent.click(options[0]) // Interviews (current)

    // location.href was set to '' initially, should remain unchanged
    expect(window.location.href).toBe('')
  })
})
