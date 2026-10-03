/**
 * localStorage persistence for comment drafts.
 *
 * Saves in-progress comment text so it survives window close/reopen.
 * Each draft is a structured entry with a type discriminator:
 *   - { type: 'comment', text }  — top-level comment (keyed by route)
 *   - { type: 'reply',   text }  — reply to an existing thread (keyed by comment ID)
 */

const STORAGE_KEY = 'sb-comment-drafts'

/** @returns {Record<string, { type: string, text: string }>} */
function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

/** @param {Record<string, { type: string, text: string }>} drafts */
function writeDrafts(drafts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Save a draft entry.
 * @param {string} key - Storage key (use composerDraftKey / replyDraftKey)
 * @param {{ type: string, text: string }} draft
 */
export function saveDraft(key, draft) {
  const drafts = readDrafts()
  drafts[key] = draft
  writeDrafts(drafts)
}

/**
 * Get a draft entry by key. Returns null if not found.
 * @param {string} key
 * @returns {{ type: string, text: string } | null}
 */
export function getDraft(key) {
  return readDrafts()[key] ?? null
}

/**
 * Clear a draft entry.
 * @param {string} key
 */
export function clearDraft(key) {
  const drafts = readDrafts()
  delete drafts[key]
  writeDrafts(drafts)
}

/** Key for a top-level comment draft on a given route. */
export function composerDraftKey(route) {
  return `comment:${route}`
}

/** Key for a reply draft on a given comment thread. */
export function replyDraftKey(commentId) {
  return `reply:${commentId}`
}
