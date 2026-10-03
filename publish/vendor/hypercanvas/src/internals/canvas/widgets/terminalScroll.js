/**
 * Write PTY output without losing the user's scroll position.
 *
 * ghostty-web currently snaps to the bottom on every write. When the user is
 * reading history, compensate for newly-added scrollback lines so the same
 * content remains visible while an agent continues streaming output.
 */
export function writePreservingScroll(term, data) {
  const viewportBefore = term?.getViewportY?.() || 0
  const historyBefore = term?.getScrollbackLength?.() || 0

  term?.write?.(data)

  if (viewportBefore <= 0) return
  const historyAfter = term?.getScrollbackLength?.() || 0
  const addedHistory = Math.max(0, historyAfter - historyBefore)
  term?.scrollToLine?.(Math.min(historyAfter, viewportBefore + addedHistory))
}
