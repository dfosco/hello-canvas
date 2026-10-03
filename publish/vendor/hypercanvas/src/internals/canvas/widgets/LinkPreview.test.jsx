import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LinkPreview from './LinkPreview.jsx'

describe('LinkPreview', () => {
  it('renders GitHub issue card with markdown body and author byline', () => {
    const { container } = render(
      <LinkPreview
        id="link-1"
        props={{
          url: 'https://github.com/dfosco/storyboard/issues/42',
          title: '#42 Ship GitHub embeds',
          github: {
            context: 'GitHub · dfosco/storyboard · Issue #42',
            body: '## Summary\n\nThis is a **bold** point.\n\n- Item one\n- Item two',
            authors: ['dfosco'],
            createdAt: '2026-01-01T00:00:00Z',
          },
        }}
      />,
    )

    // Title split: text + muted number
    expect(screen.getByText('Ship GitHub embeds')).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()

    // Markdown body renders headings, bold, lists
    const headings = container.querySelectorAll('h2')
    expect(headings.length).toBeGreaterThanOrEqual(1)
    // Find the body heading (not the title)
    const summaryHeading = Array.from(headings).find(h => h.textContent === 'Summary')
    expect(summaryHeading).toBeTruthy()
    expect(container.querySelectorAll('li')).toHaveLength(2)

    // Author byline
    expect(screen.getByText('dfosco')).toBeInTheDocument()
  })

  it('does not render GitHub layout for non-GitHub links', () => {
    render(
      <LinkPreview
        id="link-2"
        props={{
          url: 'https://example.com/docs',
          title: 'Example docs',
        }}
      />,
    )

    expect(screen.getByText('Example docs')).toBeInTheDocument()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('renders plain link-preview without github data', () => {
    const { container } = render(
      <LinkPreview
        id="link-3"
        props={{
          url: 'https://figma.com/design/abc',
          title: 'My design',
          width: 320,
          height: 120,
        }}
      />,
    )

    expect(screen.getByText('My design')).toBeInTheDocument()
    // No issue card rendered
    expect(container.querySelector('header')).toBeNull()
  })

  it('renders OG image when present', () => {
    const { container } = render(
      <LinkPreview
        id="link-4"
        props={{
          url: 'https://example.com',
          title: 'With image',
          ogImage: 'https://example.com/og.png',
        }}
      />,
    )

    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.src).toBe('https://example.com/og.png')
  })

  it('does not render image element when ogImage is absent', () => {
    const { container } = render(
      <LinkPreview
        id="link-5"
        props={{
          url: 'https://example.com',
          title: 'No image',
        }}
      />,
    )

    expect(container.querySelector('img')).toBeNull()
  })

  it('hides broken OG image on error', () => {
    const { container } = render(
      <LinkPreview
        id="link-6"
        props={{
          url: 'https://example.com',
          title: 'Broken image',
          ogImage: 'https://example.com/broken.png',
        }}
      />,
    )

    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    fireEvent.error(img)
    expect(img.style.display).toBe('none')
  })

  it('renders description when present', () => {
    render(
      <LinkPreview
        id="link-7"
        props={{
          url: 'https://example.com',
          title: 'With desc',
          description: 'A short description of the page',
        }}
      />,
    )

    expect(screen.getByText('A short description of the page')).toBeInTheDocument()
  })

  it('enters edit mode on double-click and saves on change', () => {
    const onUpdate = vi.fn()
    render(
      <LinkPreview
        id="link-8"
        props={{
          url: 'https://example.com',
          title: 'Editable title',
        }}
        onUpdate={onUpdate}
      />,
    )

    const titleEl = screen.getByText('Editable title')
    fireEvent.doubleClick(titleEl)

    const input = document.querySelector('input[type="text"]')
    expect(input).toBeTruthy()
    expect(input.value).toBe('Editable title')

    fireEvent.change(input, { target: { value: 'New title' } })
    expect(onUpdate).toHaveBeenCalledWith({ title: 'New title' })
  })

  it('does not enter edit mode when onUpdate is missing', () => {
    render(
      <LinkPreview
        id="link-9"
        props={{
          url: 'https://example.com',
          title: 'Read-only',
        }}
      />,
    )

    const titleEl = screen.getByText('Read-only')
    fireEvent.doubleClick(titleEl)

    // Should not show an input
    expect(document.querySelector('input[type="text"]')).toBeNull()
  })

  it('shows fallback text when title is empty', () => {
    render(
      <LinkPreview
        id="link-10"
        props={{
          url: 'https://example.com/page',
        }}
        onUpdate={() => {}}
      />,
    )

    // Falls back to hostname — appears in both title and URL
    const matches = screen.getAllByText('example.com')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})
