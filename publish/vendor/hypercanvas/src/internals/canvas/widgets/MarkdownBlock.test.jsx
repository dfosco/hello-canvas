import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MarkdownBlock from './MarkdownBlock.jsx'

describe('MarkdownBlock', () => {
  it('does not enter edit mode when onUpdate is unavailable (read-only/prod)', () => {
    const { container } = render(<MarkdownBlock props={{ content: 'Hello', width: 420 }} />)

    fireEvent.doubleClick(screen.getByText('Hello'))

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(container.querySelector('[data-canvas-allow-text-selection]')).not.toBeNull()
  })

  it('enters edit mode when onUpdate is available', () => {
    const onUpdate = vi.fn()
    render(<MarkdownBlock props={{ content: 'Hello', width: 420 }} onUpdate={onUpdate} />)

    fireEvent.doubleClick(screen.getByText('Hello'))

    expect(screen.queryByRole('textbox')).not.toBeNull()
  })

  it('shows a non-editable empty-state message in read-only mode', () => {
    render(<MarkdownBlock props={{ content: '', width: 420 }} />)

    expect(screen.getByText('No content')).toBeTruthy()
    expect(screen.queryByText('Double-click to edit…')).toBeNull()
  })

  it('stops click propagation in read-only mode', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <MarkdownBlock props={{ content: 'Hello', width: 420 }} />
      </div>
    )

    fireEvent.click(screen.getByText('Hello'))

    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('copies markdown source in read-only mode', () => {
    render(<MarkdownBlock props={{ content: '**Hello**\n- item', width: 420 }} />)

    const preview = screen.getByText('Hello').closest('[data-canvas-allow-text-selection]')
    const setData = vi.fn()
    fireEvent.copy(preview, { clipboardData: { setData } })

    expect(setData).toHaveBeenCalledWith('text/plain', '**Hello**\n- item')
  })

  describe('GitHub Flavored Markdown', () => {
    it('renders tables', () => {
      const markdown = `| Name | Age |
| --- | --- |
| Alice | 30 |`
      const { container } = render(<MarkdownBlock props={{ content: markdown, width: 420 }} />)

      expect(container.querySelector('table')).not.toBeNull()
      expect(container.querySelector('th')).not.toBeNull()
      expect(screen.getByText('Alice')).toBeTruthy()
    })

    it('renders task lists', () => {
      const markdown = `- [x] Done
- [ ] Todo`
      const { container } = render(<MarkdownBlock props={{ content: markdown, width: 420 }} />)

      const checkboxes = container.querySelectorAll('input[type="checkbox"]')
      expect(checkboxes).toHaveLength(2)
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(false)
    })

    it('renders strikethrough', () => {
      const { container } = render(<MarkdownBlock props={{ content: '~~deleted~~', width: 420 }} />)

      expect(container.querySelector('del')).not.toBeNull()
      expect(screen.getByText('deleted')).toBeTruthy()
    })

    it('renders autolinks', () => {
      const { container } = render(<MarkdownBlock props={{ content: 'https://github.com', width: 420 }} />)

      const link = container.querySelector('a')
      expect(link).not.toBeNull()
      expect(link.href).toBe('https://github.com/')
    })
  })
})
