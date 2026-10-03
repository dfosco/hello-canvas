/**
 * Comment window — React popup that shows a comment thread with replies and reactions.
 *
 * Opens when clicking a comment pin. Shows comment body, author, replies,
 * reply input, reactions, and supports drag-to-move.
 * Styled with Tachyons + sb-* custom classes for light/dark mode support.
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import CommentWindowComponent from './CommentWindow.jsx'
import { getCachedUser } from '../auth.js'
import { saveDraft, replyDraftKey } from '../commentDrafts.js'
import './comment-layout.css'

// Track the currently open window so only one is open at a time
let activeWindow = null

/**
 * Show a comment window for a given comment.
 * @param {HTMLElement} container - The positioned container element (overlay)
 * @param {object} comment - The parsed comment object (with meta, text, replies, reactionGroups, author, etc.)
 * @param {object} discussion - The discussion object (id needed for replies)
 * @param {object} [callbacks] - Optional callbacks
 * @param {(xPct: number, yPct: number) => { left: string, top: string }} [callbacks.getAnchorPosition] - Resolve coordinates to overlay position
 * @param {() => void} [callbacks.onClose] - Called when window is closed
 * @param {() => void} [callbacks.onMove] - Called after comment is moved (for re-rendering pins)
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function showCommentWindow(container, comment, discussion, callbacks = {}) {
  if (activeWindow) {
    activeWindow.destroy()
    activeWindow = null
  }

  const user = getCachedUser()
  const win = document.createElement('div')
  const anchor = callbacks.getAnchorPosition
    ? callbacks.getAnchorPosition(comment.meta?.x ?? 0, comment.meta?.y ?? 0)
    : { left: `${comment.meta?.x ?? 0}%`, top: `${comment.meta?.y ?? 0}%` }
  win.className = 'sb-comment-window absolute'
  win.style.cssText = `z-index:100001;width:360px;max-height:480px;left:${anchor.left};top:${anchor.top};transform:translate(12px,-50%)`

  // Stop click from propagating to overlay
  win.addEventListener('click', (e) => e.stopPropagation())

  // Set URL param for deep linking
  const url = new URL(window.location.href)
  url.searchParams.set('comment', comment.id)
  window.history.replaceState(null, '', url.toString())

  container.appendChild(win)

  let root = null

  function destroy() {
    // Save reply draft from DOM before React unmounts
    const textarea = win.querySelector('textarea[placeholder="Reply…"]')
    const val = textarea?.value?.trim()
    if (val) {
      saveDraft(replyDraftKey(comment.id), { type: 'reply', text: textarea.value })
    }

    if (root) { root.unmount(); root = null }
    win.remove()
    if (activeWindow?.el === win) activeWindow = null
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.delete('comment')
    window.history.replaceState(null, '', currentUrl.toString())
    callbacks.onClose?.()
  }

  root = createRoot(win)
  root.render(createElement(CommentWindowComponent, {
    comment,
    discussion,
    user,
    winEl: win,
    onClose: destroy,
    onMove: () => callbacks.onMove?.(),
  }))

  // Adjust position to keep window within viewport
  requestAnimationFrame(() => {
    const rect = win.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 8

    let tx = 12
    let ty = -(rect.height / 2)

    if (rect.left + rect.width > vw - pad) {
      tx = -(rect.width + 12)
    }

    const anchorY = rect.top + rect.height / 2
    const finalBottom = anchorY + ty + rect.height
    if (finalBottom > vh - pad) {
      ty -= (finalBottom - vh + pad)
    }
    if (anchorY + ty < pad) {
      ty = pad - anchorY
    }

    win.style.transform = `translate(${tx}px, ${ty}px)`
  })

  activeWindow = { el: win, destroy }
  return { el: win, destroy }
}

/**
 * Close the currently open comment window, if any.
 */
export function closeCommentWindow() {
  if (activeWindow) {
    activeWindow.destroy()
    activeWindow = null
  }
}
