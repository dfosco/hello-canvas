/**
 * Auth modal — delegates to the React PATDialog via a custom event.
 *
 * The AuthModal is no longer mounted directly. Instead, we dispatch
 * a 'storyboard:open-auth-modal' event that the React ViewfinderNew listens for.
 */

import { getCachedUser, clearToken } from '../auth.js'

/**
 * Open the auth modal. Dispatches a custom event to trigger the React PATDialog.
 * @param {{ initialError?: string|null }} [options]
 * @returns {Promise<{ login: string, avatarUrl: string }|null>}
 */
export function openAuthModal(options = {}) {
  document.dispatchEvent(new CustomEvent('storyboard:open-auth-modal', {
    detail: options,
  }))

  // Return a promise that resolves when token appears in localStorage
  return new Promise((resolve) => {
    function onStorage() {
      try {
        const token = localStorage.getItem('sb-comments-token')
        if (token) {
          window.removeEventListener('storage', onStorage)
          clearInterval(pollId)
          const user = getCachedUser()
          resolve(user || { login: 'user', avatarUrl: '' })
        }
      } catch { /* ignore */ }
    }

    // Poll localStorage for token changes (same-window writes don't fire 'storage')
    const initialToken = (() => { try { return localStorage.getItem('sb-comments-token') } catch { return null } })()
    const pollId = setInterval(() => {
      try {
        const token = localStorage.getItem('sb-comments-token')
        if (token && token !== initialToken) {
          clearInterval(pollId)
          window.removeEventListener('storage', onStorage)
          const user = getCachedUser()
          resolve(user || { login: 'user', avatarUrl: '' })
        }
      } catch { /* ignore */ }
    }, 500)

    window.addEventListener('storage', onStorage)

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(pollId)
      window.removeEventListener('storage', onStorage)
      resolve(null)
    }, 5 * 60 * 1000)
  })
}

/**
 * Open a sign-out confirmation. Clears token immediately.
 */
export function signOut() {
  const user = getCachedUser()
  clearToken()
  console.log(`[storyboard] Signed out${user ? ` (was ${user.login})` : ''}`)
}
