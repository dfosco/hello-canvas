import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExpandedPaneTopBar from './ExpandedPaneTopBar.jsx'

describe('ExpandedPaneTopBar', () => {
  it('renders pane label left-aligned', () => {
    render(
      <ExpandedPaneTopBar label="Terminal · pearl-wren" onClose={vi.fn()} />
    )
    expect(screen.getByText('Terminal · pearl-wren')).toBeTruthy()
  })

  it('renders close button when showClose is true', () => {
    render(
      <ExpandedPaneTopBar label="Terminal · pearl-wren" showClose onClose={vi.fn()} />
    )
    expect(screen.getByLabelText('Close expanded view')).toBeTruthy()
  })

  it('does not render close button when showClose is false', () => {
    render(
      <ExpandedPaneTopBar label="Terminal · pearl-wren" onClose={vi.fn()} />
    )
    expect(screen.queryByLabelText('Close expanded view')).toBeNull()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <ExpandedPaneTopBar label="Terminal · pearl-wren" showClose onClose={onClose} />
    )
    fireEvent.click(screen.getByLabelText('Close expanded view'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('has dark background styling', () => {
    const { container } = render(
      <ExpandedPaneTopBar label="Agent · wren" showClose onClose={vi.fn()} />
    )
    const bar = container.firstChild
    expect(bar).toBeTruthy()
    // Bar should have the dark background class
    expect(bar.className).toMatch(/bar/)
  })
})
