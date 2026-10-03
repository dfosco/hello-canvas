/**
 * Comment mode state — manages the toggle between normal and comment mode.
 *
 * When active: cursor changes to crosshair, comment pins are visible,
 * clicking places a new comment.
 */

import { isCommentsEnabled } from './config.js'
import { isAuthenticated } from './auth.js'

let _active = false
const _listeners = new Set()

/**
 * Check whether comment mode is currently active.
 */
export function isCommentModeActive() {
  return _active
}

/**
 * Toggle comment mode on/off.
 * Only activates if comments are enabled and user is authenticated.
 * @returns {boolean} The new state
 */
export function toggleCommentMode() {
  if (!isCommentsEnabled()) {
    console.warn('[storyboard] Comments not enabled — check storyboard.config.json')
    return false
  }

  if (!_active && !isAuthenticated()) {
    console.warn('[storyboard] Sign in first to use comments')
    return false
  }

  _active = !_active
  _notify()
  return _active
}

/**
 * Explicitly set comment mode.
 * @param {boolean} active
 */
export function setCommentMode(active) {
  _active = active
  _notify()
}

/**
 * Subscribe to comment mode changes.
 * @param {(active: boolean) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function subscribeToCommentMode(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

function _notify() {
  for (const cb of _listeners) cb(_active)
}
