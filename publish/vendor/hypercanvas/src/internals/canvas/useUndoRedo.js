import { useRef, useState, useCallback } from 'react'

const MAX_HISTORY = 100

/**
 * Per-tab undo/redo history for canvas events.
 *
 * Maintains two stacks of event IDs:
 *   undoStack — ids of user-initiated forward events, newest last.
 *   redoStack — ids of undo events (the inverse events appended by the
 *               server's POST /undo), newest last.
 *
 * Workflow:
 *   • Every user-initiated mutation that succeeds calls `track(eventId)` —
 *     pushes onto undoStack and clears redoStack.
 *   • `popUndo()` returns the next id to undo. Caller POSTs /undo and on
 *     success calls `pushRedo(inverseId)`.
 *   • `popRedo()` returns the next id to redo. Caller POSTs /redo and on
 *     success calls `pushUndo(inverseId)` (so the redo is itself undoable).
 *
 * This hook holds *no* widget data — undo state lives in the JSONL. The
 * stacks are per-tab and ephemeral; refreshing the page resets them.
 */
export default function useUndoRedo() {
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])
  const [counts, setCounts] = useState({ undo: 0, redo: 0 })

  const syncCounts = useCallback(() => {
    setCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length })
  }, [])

  const track = useCallback((eventId) => {
    if (!eventId || typeof eventId !== 'string') return
    undoStackRef.current.push(eventId)
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift()
    // New mutation invalidates the redo chain
    redoStackRef.current = []
    syncCounts()
  }, [syncCounts])

  const trackMany = useCallback((eventIds) => {
    if (!Array.isArray(eventIds)) return
    for (const id of eventIds) {
      if (id && typeof id === 'string') {
        undoStackRef.current.push(id)
        if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift()
      }
    }
    redoStackRef.current = []
    syncCounts()
  }, [syncCounts])

  const popUndo = useCallback(() => {
    const id = undoStackRef.current.pop()
    syncCounts()
    return id ?? null
  }, [syncCounts])

  const popRedo = useCallback(() => {
    const id = redoStackRef.current.pop()
    syncCounts()
    return id ?? null
  }, [syncCounts])

  const pushRedo = useCallback((eventId) => {
    if (!eventId || typeof eventId !== 'string') return
    redoStackRef.current.push(eventId)
    if (redoStackRef.current.length > MAX_HISTORY) redoStackRef.current.shift()
    syncCounts()
  }, [syncCounts])

  const pushUndo = useCallback((eventId) => {
    if (!eventId || typeof eventId !== 'string') return
    undoStackRef.current.push(eventId)
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift()
    syncCounts()
  }, [syncCounts])

  const reset = useCallback(() => {
    undoStackRef.current = []
    redoStackRef.current = []
    setCounts((prev) => {
      if (prev.undo === 0 && prev.redo === 0) return prev
      return { undo: 0, redo: 0 }
    })
  }, [])

  return {
    track,
    trackMany,
    popUndo,
    popRedo,
    pushRedo,
    pushUndo,
    reset,
    canUndo: counts.undo > 0,
    canRedo: counts.redo > 0,
  }
}

