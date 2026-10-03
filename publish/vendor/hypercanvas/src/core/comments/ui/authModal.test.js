/**
 * Tests for authModal.js — PAT entry modal lifecycle.
 *
 * Tests the modal's resolve/reject/close behavior via the imperative API.
 * Runs under the React vitest config since authModal.js imports a React component.
 */

import { vi } from 'vitest'

describe('authModal.js', () => {
  let openAuthModal, signOut

  beforeEach(async () => {
    document.body.innerHTML = ''
    localStorage.clear()

    vi.resetModules()

    const mod = await import('./authModal.js')
    openAuthModal = mod.openAuthModal
    signOut = mod.signOut
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a backdrop element in the DOM', () => {
    openAuthModal()

    const backdrop = document.getElementById('sb-auth-modal')
    expect(backdrop).not.toBeNull()
    expect(backdrop.classList.contains('sb-auth-backdrop')).toBe(true)
  })

  it('removes old modal before creating a new one', () => {
    openAuthModal()
    openAuthModal()

    const modals = document.querySelectorAll('#sb-auth-modal')
    expect(modals.length).toBe(1)
  })

  it('resolves null when Escape is pressed', async () => {
    const promise = openAuthModal()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    const result = await promise
    expect(result).toBeNull()
    expect(document.getElementById('sb-auth-modal')).toBeNull()
  })

  it('resolves null when backdrop is clicked', async () => {
    const promise = openAuthModal()

    const backdrop = document.getElementById('sb-auth-modal')
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const result = await promise
    expect(result).toBeNull()
    expect(document.getElementById('sb-auth-modal')).toBeNull()
  })

  describe('signOut', () => {
    it('clears the stored token', () => {
      localStorage.setItem('sb-comments-token', 'ghp_test')
      localStorage.setItem('sb-comments-user', JSON.stringify({ login: 'test' }))

      signOut()

      expect(localStorage.getItem('sb-comments-token')).toBeNull()
      expect(localStorage.getItem('sb-comments-user')).toBeNull()
    })
  })
})
