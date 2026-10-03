import { afterEach, describe, expect, it, vi } from 'vitest'
import { showToast } from './showToast.js'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('showToast', () => {
  it('renders a stacked toast that removes itself after the duration', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = showToast('first failure')
    showToast('second failure')

    expect(first?.getAttribute('data-storyboard-toast')).toBe('')
    const toasts = document.querySelectorAll('[data-storyboard-toast]')
    expect(toasts.length).toBe(2)
    // Newest toast appends last but sits higher on screen via its bottom offset.
    expect(toasts[0].textContent).toBe('first failure')
    expect(toasts[1].textContent).toBe('second failure')

    vi.advanceTimersByTime(3300)
    vi.advanceTimersByTime(300)
    expect(document.querySelectorAll('[data-storyboard-toast]').length).toBe(0)
  })
})
