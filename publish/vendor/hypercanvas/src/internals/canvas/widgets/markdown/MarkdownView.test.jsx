import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownView } from './MarkdownEditor.jsx'

describe('MarkdownView typography', () => {
  it('applies a small content class by default', () => {
    const { container } = render(<MarkdownView content="# Hi" />)
    const root = container.querySelector('div')
    expect(root.className).toMatch(/contentSmall/)
    expect(container.querySelector('h1')).toBeTruthy()
  })

  it('applies large variant when size=large', () => {
    const { container } = render(<MarkdownView content="# Hi" size="large" />)
    expect(container.querySelector('div').className).toMatch(/contentLarge/)
  })

  it('composes consumer className with the shared content class', () => {
    const { container } = render(
      <MarkdownView content="x" className="my-wrap" />,
    )
    const cls = container.querySelector('div').className
    expect(cls).toMatch(/my-wrap/)
    expect(cls).toMatch(/contentSmall/)
  })

  it('adds inert class when inert=true', () => {
    const { container } = render(<MarkdownView content="x" inert />)
    const cls = container.querySelector('div').className
    expect(cls).toMatch(/inert/)
  })

  it('renders loose lists (blank lines between items) with <p>-wrapped items', () => {
    // CommonMark turns a list with blank lines between items into a
    // "loose list" — each <li> contains <p> rather than raw text. The
    // shared markdownContent.module.css resets `li > p` margin so the
    // bullet text stays aligned to its marker; without that the gap
    // between items balloons. This test pins the HTML contract so the
    // CSS reset has a stable shape to target.
    const { container } = render(
      <MarkdownView content={'- first\n\n- second\n\n- third'} />,
    )
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(3)
    for (const li of items) {
      const directParagraphs = Array.from(li.children).filter(c => c.tagName === 'P')
      expect(directParagraphs.length).toBeGreaterThanOrEqual(1)
    }
  })
})

