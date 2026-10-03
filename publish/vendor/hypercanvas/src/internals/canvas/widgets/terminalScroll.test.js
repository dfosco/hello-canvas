import { describe, expect, it, vi } from 'vitest'
import { writePreservingScroll } from './terminalScroll.js'

describe('writePreservingScroll', () => {
  it('keeps following output while already at the bottom', () => {
    const term = {
      getViewportY: () => 0,
      getScrollbackLength: () => 20,
      write: vi.fn(),
      scrollToLine: vi.fn(),
    }

    writePreservingScroll(term, 'next')

    expect(term.write).toHaveBeenCalledWith('next')
    expect(term.scrollToLine).not.toHaveBeenCalled()
  })

  it('preserves the visible content while output adds history', () => {
    let history = 20
    const term = {
      getViewportY: () => 8,
      getScrollbackLength: () => history,
      write: vi.fn(() => { history = 23 }),
      scrollToLine: vi.fn(),
    }

    writePreservingScroll(term, 'next')

    expect(term.scrollToLine).toHaveBeenCalledWith(11)
  })

  it('restores the previous offset for in-place terminal redraws', () => {
    const term = {
      getViewportY: () => 8,
      getScrollbackLength: () => 20,
      write: vi.fn(),
      scrollToLine: vi.fn(),
    }

    writePreservingScroll(term, 'redraw')

    expect(term.scrollToLine).toHaveBeenCalledWith(8)
  })
})
