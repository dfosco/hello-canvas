/**
 * Comment overlay UI utilities (vanilla JS).
 *
 * Provides menu items for the DevTools integration.
 */

import { isAuthenticated } from '../auth.js'
import { toggleCommentMode } from '../commentMode.js'
import { openAuthModal, signOut } from './authModal.js'
import { openCommentsDrawer } from './commentsDrawer.js'

/**
 * Get menu items for the DevTools comments section.
 * @returns {Array<{ label: string, icon: string, onClick: () => void }>}
 */
export function getCommentsMenuItems() {
  const items = []

  if (!isAuthenticated()) {
    items.push({
      label: 'Sign in for comments',
      icon: '💬',
      onClick: () => {
        openAuthModal()
      },
    })
  } else {
    items.push({
      label: 'Toggle comments',
      icon: '💬',
      onClick: () => {
        toggleCommentMode()
      },
    })
    items.push({
      label: 'See all comments',
      icon: '📋',
      onClick: () => {
        openCommentsDrawer()
      },
    })
    items.push({
      label: 'Sign out of comments',
      icon: '🚪',
      onClick: () => {
        signOut()
      },
    })
  }

  return items
}
