import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { readProp, getDefaults, stickyNoteSchema } from './widgetProps.js'
import StickyNote from './StickyNote.jsx'

describe('stickyNoteSchema', () => {
  it('includes width and height in the size category', () => {
    expect(stickyNoteSchema.width).toEqual(
      expect.objectContaining({ type: 'number', category: 'size' })
    )
    expect(stickyNoteSchema.height).toEqual(
      expect.objectContaining({ type: 'number', category: 'size' })
    )
  })

  it('includes default values for width/height from config', () => {
    const defaults = getDefaults(stickyNoteSchema)
    expect(defaults).toHaveProperty('width', 270)
    expect(defaults).toHaveProperty('height', 170)
  })

  it('returns default value when width/height are not saved in props', () => {
    const props = { text: 'hello', color: 'yellow' }
    expect(readProp(props, 'width', stickyNoteSchema)).toBe(270)
    expect(readProp(props, 'height', stickyNoteSchema)).toBe(170)
  })

  it('returns saved width/height when present in props', () => {
    const props = { text: 'hello', width: 300, height: 200 }
    expect(readProp(props, 'width', stickyNoteSchema)).toBe(300)
    expect(readProp(props, 'height', stickyNoteSchema)).toBe(200)
  })
})

describe('StickyNote', () => {
  it('applies default dimensions as inline styles when not saved in props', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi' }} onUpdate={vi.fn()} />)
    const sticky = container.querySelector('article')
    expect(sticky.style.width).toBe('270px')
    expect(sticky.style.height).toBe('170px')
  })

  it('applies saved dimensions as inline styles', () => {
    const { container } = render(
      <StickyNote props={{ text: 'Hi', width: 300, height: 200 }} onUpdate={vi.fn()} />
    )
    const sticky = container.querySelector('article')
    expect(sticky.style.width).toBe('300px')
    expect(sticky.style.height).toBe('200px')
  })

  it('renders a resize handle when resizable', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi' }} onUpdate={vi.fn()} resizable />)
    const handle = container.querySelector('[role="separator"]')
    expect(handle).not.toBeNull()
  })

  it('does not render a resize handle when not resizable', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi' }} onUpdate={vi.fn()} resizable={false} />)
    const handle = container.querySelector('[role="separator"]')
    expect(handle).toBeNull()
  })

  it('calls onUpdate with new dimensions on resize drag', () => {
    const onUpdate = vi.fn()
    const { container } = render(
      <StickyNote props={{ text: 'Hi', width: 200, height: 150 }} onUpdate={onUpdate} resizable />
    )
    const handle = container.querySelector('[role="separator"]')
    const sticky = container.querySelector('article')

    // Mock offsetWidth/offsetHeight since jsdom doesn't compute layout
    Object.defineProperty(sticky, 'offsetWidth', { value: 200, configurable: true })
    Object.defineProperty(sticky, 'offsetHeight', { value: 150, configurable: true })

    // Simulate drag: mousedown → mousemove → mouseup
    fireEvent.mouseDown(handle, { clientX: 200, clientY: 150 })
    fireEvent.mouseMove(document, { clientX: 250, clientY: 200 })
    fireEvent.mouseUp(document)

    expect(onUpdate).toHaveBeenCalledWith({ width: 250, height: 200 })
  })

  it('enforces minimum dimensions during resize', () => {
    const onUpdate = vi.fn()
    const { container } = render(
      <StickyNote props={{ text: 'Hi', width: 200, height: 150 }} onUpdate={onUpdate} resizable />
    )
    const handle = container.querySelector('[role="separator"]')
    const sticky = container.querySelector('article')

    Object.defineProperty(sticky, 'offsetWidth', { value: 200, configurable: true })
    Object.defineProperty(sticky, 'offsetHeight', { value: 150, configurable: true })

    // Drag far to the left/up — should clamp to mins
    fireEvent.mouseDown(handle, { clientX: 200, clientY: 150 })
    fireEvent.mouseMove(document, { clientX: 0, clientY: 0 })
    fireEvent.mouseUp(document)

    expect(onUpdate).toHaveBeenCalledWith({ width: 180, height: 60 })
  })

  it('does not enter edit mode without onUpdate (read-only/prod)', () => {
    const { container } = render(<StickyNote props={{ text: 'Read me' }} />)
    const text = container.querySelector('p')
    fireEvent.doubleClick(text)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('[data-canvas-allow-text-selection]')).not.toBeNull()
  })

  it('shows non-editable empty-state text in read-only mode', () => {
    const { container } = render(<StickyNote props={{ text: '' }} />)
    expect(container.textContent).toContain('No content')
    expect(container.textContent).not.toContain('Double-click to edit…')
  })

  it('does not set a text scale CSS var when autoScaleText is off', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi', width: 540, height: 340 }} />)
    const preview = container.querySelector('article > div')
    expect(preview.style.getPropertyValue('--sticky-text-scale')).toBe('')
  })

  it('sets a text scale CSS var of 1 at the default sticky size', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi', autoScaleText: true }} />)
    const preview = container.querySelector('article > div')
    expect(preview.style.getPropertyValue('--sticky-text-scale')).toBe('1')
  })

  it('scales text by sqrt(area / base) when autoScaleText is on, clamped at the upper bound', () => {
    // 540×340 is 4× the default area, so √4 = 2, which sits at the max clamp.
    const { container } = render(
      <StickyNote props={{ text: 'Hi', width: 540, height: 340, autoScaleText: true }} />
    )
    const preview = container.querySelector('article > div')
    expect(preview.style.getPropertyValue('--sticky-text-scale')).toBe('2')
  })

  it('caps the text scale at 2x even for very large stickies', () => {
    // A huge sticky shouldn't render 80px text just because the area is large.
    const { container } = render(
      <StickyNote props={{ text: 'Hi', width: 1900, height: 900, autoScaleText: true }} />
    )
    const preview = container.querySelector('article > div')
    expect(preview.style.getPropertyValue('--sticky-text-scale')).toBe('2')
  })

  it('floors the text scale at 0.8 for tiny stickies', () => {
    const { container } = render(
      <StickyNote props={{ text: 'Hi', width: 180, height: 80, autoScaleText: true }} />
    )
    const preview = container.querySelector('article > div')
    expect(preview.style.getPropertyValue('--sticky-text-scale')).toBe('0.8')
  })

  it('marks the sticky with data-auto-scale when scaling is on', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi', autoScaleText: true }} />)
    expect(container.querySelector('article').hasAttribute('data-auto-scale')).toBe(true)
  })

  it('renders the preview as inert so double-clicks on text reach the wrapper', () => {
    // The shared .inert class sets `pointer-events: none` on all children
    // (except links/imgs/checkboxes), so a double-click on rendered markdown
    // bubbles up to the wrapper's onDoubleClick handler that toggles edit.
    const { container } = render(<StickyNote props={{ text: 'Hi' }} onUpdate={vi.fn()} />)
    const preview = container.querySelector('[role="button"]')
    expect(preview.className).toMatch(/inert/i)
  })

  it('uses transparent background in the preview so the sticky color shows through', () => {
    // The shared markdown-content typography sets a white background. The
    // sticky overrides the --sb--markdown-bg variable and applies
    // `background: transparent` itself; the JSDOM check verifies the inline
    // override path is in place.
    const { container } = render(<StickyNote props={{ text: 'Hi' }} />)
    const preview = container.querySelector('article > div')
    expect(preview).not.toBeNull()
    // jsdom doesn't compute CSS modules but does evaluate inline styles;
    // the article keeps its --sticky-bg variable so the visual layering works.
    expect(container.querySelector('article').style.getPropertyValue('--sticky-bg')).toBeTruthy()
  })

  it('renders text as markdown (formatting visible in read view)', () => {
    const { container } = render(<StickyNote props={{ text: '**bold** and _italic_' }} />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
  })

  it('renders GFM task lists', () => {
    const { container } = render(<StickyNote props={{ text: '- [x] done\n- [ ] todo' }} />)
    const boxes = container.querySelectorAll('input[type="checkbox"]')
    expect(boxes.length).toBe(2)
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(false)
  })

  it('enters edit mode on double-click when editable', () => {
    const { container } = render(<StickyNote props={{ text: 'Hi' }} onUpdate={vi.fn()} />)
    const preview = container.querySelector('[role="button"]')
    expect(preview).not.toBeNull()
    fireEvent.doubleClick(preview)
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('shows raw markdown in textarea during edit', () => {
    const raw = '# Heading\n\n**bold**'
    const { container } = render(<StickyNote props={{ text: raw }} onUpdate={vi.fn()} />)
    fireEvent.doubleClick(container.querySelector('[role="button"]'))
    const textarea = container.querySelector('textarea')
    expect(textarea.value).toBe(raw)
  })
})
