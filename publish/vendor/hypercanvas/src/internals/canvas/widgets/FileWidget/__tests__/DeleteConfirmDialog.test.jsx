import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import DeleteConfirmDialog from '../DeleteConfirmDialog.jsx'

describe('DeleteConfirmDialog', () => {
  it('renders the title, message, and both buttons', () => {
    render(
      <DeleteConfirmDialog
        title="Delete file widget?"
        message="The file stays on disk."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Delete file widget?')).toBeTruthy()
    expect(screen.getByText('The file stays on disk.')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('uses custom confirm/cancel labels', () => {
    render(
      <DeleteConfirmDialog
        confirmLabel="Yes, remove"
        cancelLabel="Keep widget"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Yes, remove')).toBeTruthy()
    expect(screen.getByText('Keep widget')).toBeTruthy()
  })

  it('fires onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<DeleteConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('fires onCancel when the cancel button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<DeleteConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
