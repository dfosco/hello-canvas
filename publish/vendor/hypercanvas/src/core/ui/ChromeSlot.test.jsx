import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'

import ChromeSlot from './ChromeSlot.jsx'
import { _resetPresentation, setPresentation } from '../stores/presentationStore.js'

describe('ChromeSlot', () => {
  beforeEach(() => {
    _resetPresentation()
  })

  it('passes through and adds data-sb-chrome when no override is set', () => {
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('button', { type: 'button' }, 'click me')
      )
    )
    const btn = container.querySelector('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('data-sb-chrome')).toBe('tool:foo')
    expect(btn.textContent).toBe('click me')
  })

  it('renders null when override has hidden:true', () => {
    setPresentation('tool:foo', { hidden: true })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('button', { type: 'button' }, 'gone')
      )
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('merges style overrides onto the child', () => {
    setPresentation('tool:foo', { style: { transform: 'translateY(20px)', opacity: 0.5 } })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('div', { style: { background: 'red' } }, 'hi')
      )
    )
    const div = container.querySelector('div')
    expect(div.style.background).toBe('red')
    expect(div.style.transform).toBe('translateY(20px)')
    expect(div.style.opacity).toBe('0.5')
  })

  it('overrides win when style keys collide', () => {
    setPresentation('tool:foo', { style: { background: 'blue' } })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('div', { style: { background: 'red' } }, 'hi')
      )
    )
    expect(container.querySelector('div').style.background).toBe('blue')
  })

  it('appends className when both child and override define one', () => {
    setPresentation('tool:foo', { className: 'extra' })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('div', { className: 'base' }, 'hi')
      )
    )
    expect(container.querySelector('div').className).toBe('base extra')
  })

  it('uses override className alone when child has none', () => {
    setPresentation('tool:foo', { className: 'only' })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('div', null, 'hi')
      )
    )
    expect(container.querySelector('div').className).toBe('only')
  })

  it('spreads arbitrary props (e.g. event handlers, data-*)', () => {
    setPresentation('tool:foo', {
      props: {
        onPointerEnter: () => {},
        'data-extra': 'yes',
      },
    })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('button', { type: 'button' }, 'hi')
      )
    )
    const btn = container.querySelector('button')
    expect(btn.getAttribute('data-extra')).toBe('yes')
    expect(btn.getAttribute('data-sb-chrome')).toBe('tool:foo')
  })

  it('wraps with decorator and passes context', () => {
    const calls = []
    setPresentation('tool:foo', {
      decorator: (El, ctx) => {
        calls.push(ctx)
        return createElement('section', { 'data-decorated': 'true' }, El)
      },
    })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo', surface: 'command-toolbar', ctx: { toolKey: 'foo' } },
        createElement('button', { type: 'button' }, 'inside')
      )
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ id: 'tool:foo', surface: 'command-toolbar', toolKey: 'foo' })

    const section = container.querySelector('section[data-decorated]')
    expect(section).toBeTruthy()
    const btn = section.querySelector('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('data-sb-chrome')).toBe('tool:foo')
  })

  it('falls back to undecorated element when decorator throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setPresentation('tool:foo', {
      decorator: () => { throw new Error('boom') },
    })
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' },
        createElement('button', { type: 'button' }, 'survives')
      )
    )
    expect(container.querySelector('button')?.textContent).toBe('survives')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('renders null for non-element children', () => {
    const { container } = render(
      createElement(ChromeSlot, { id: 'tool:foo' }, null)
    )
    expect(container.firstChild).toBeNull()
  })
})
