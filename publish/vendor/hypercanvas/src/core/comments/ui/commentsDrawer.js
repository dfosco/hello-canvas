/**
 * Comments drawer — React right-side panel listing all comments across all routes.
 *
 * Opened from the DevTools "See all comments" menu item.
 * Clicking a comment navigates to its route and opens it.
 * Styled with Tachyons + sb-* custom classes for light/dark mode support.
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import CommentsDrawerComponent from './CommentsDrawer.jsx'
import { isAuthenticated } from '../auth.js'
import { setCommentMode } from '../commentMode.js'
import './comment-layout.css'
import './comments.css'
import { sbNavigate } from '../../navigation/sbNavigate.js'

let activeDrawer = null

/**
 * Open the comments drawer, listing all comments across all routes.
 */
export async function openCommentsDrawer() {
  if (!isAuthenticated()) return
  if (activeDrawer) { closeCommentsDrawer(); return }

  const backdrop = document.createElement('div')
  backdrop.className = 'sb-comments-drawer-backdrop fixed top-0 right-0 bottom-0 left-0'
  backdrop.addEventListener('click', closeCommentsDrawer)

  const drawer = document.createElement('div')
  drawer.className = 'sb-comments-drawer sb-drawer-animate fixed top-0 right-0 bottom-0 flex flex-column sb-bg bl sb-b-default sb-shadow sans-serif'

  document.body.appendChild(backdrop)
  document.body.appendChild(drawer)

  let root = null

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeCommentsDrawer()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }
  window.addEventListener('keydown', onKeyDown, true)

  root = createRoot(drawer)
  root.render(createElement(CommentsDrawerComponent, {
    onClose: closeCommentsDrawer,
    onNavigate: (route, commentId) => {
      closeCommentsDrawer()
      if (window.location.pathname !== route) {
        const navUrl = new URL(window.location.href)
        navUrl.pathname = route
        navUrl.searchParams.set('comment', commentId)
        sbNavigate(navUrl.toString())
      } else {
        const navUrl = new URL(window.location.href)
        navUrl.searchParams.set('comment', commentId)
        window.history.replaceState(null, '', navUrl.toString())
        setCommentMode(true)
      }
    },
  }))

  activeDrawer = { backdrop, drawer, root, onKeyDown }
}

/**
 * Close the comments drawer if open.
 */
export function closeCommentsDrawer() {
  if (!activeDrawer) return
  if (activeDrawer.onKeyDown) {
    window.removeEventListener('keydown', activeDrawer.onKeyDown, true)
  }
  if (activeDrawer.root) {
    activeDrawer.root.unmount()
  }
  activeDrawer.backdrop.remove()
  activeDrawer.drawer.remove()
  activeDrawer = null
}
