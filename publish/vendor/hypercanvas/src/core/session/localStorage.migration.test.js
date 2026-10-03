/**
 * H7 migration test (closes server-state RCA hypothesis).
 *
 * Verifies that legacy un-namespaced `storyboard:foo` keys (written by older
 * builds before the (devDomain, branch) namespacing landed) are dropped on
 * first import of localStorage.js.
 */
import { describe, expect, it } from 'vitest'

describe('one-shot legacy migration', () => {
  it('drops bare `storyboard:foo` keys on first import', async () => {
    localStorage.clear()
    localStorage.setItem('storyboard:legacy-key', 'should-vanish')
    localStorage.setItem('other:keep', 'untouched')
    localStorage.setItem('storyboard:my-app:0.5.0:already-namespaced', 'keep')

    // Force a fresh import using a query-string cache buster.
    await import('./localStorage.js?reimport-1')

    expect(localStorage.getItem('storyboard:legacy-key')).toBeNull()
    expect(localStorage.getItem('other:keep')).toBe('untouched')
    expect(localStorage.getItem('storyboard:my-app:0.5.0:already-namespaced')).toBe('keep')
  })
})
