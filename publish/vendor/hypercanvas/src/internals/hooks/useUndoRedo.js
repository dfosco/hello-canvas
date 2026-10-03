import { useCallback, useSyncExternalStore } from 'react'
import { undo, redo, canUndo, canRedo } from '../../core/index.js'
import { subscribeToStorage, getStorageSnapshot } from '../../core/index.js'
import { subscribeToHash, getHashSnapshot } from '../../core/index.js'

/**
 * Undo/redo controls for override history.
 *
 * Every override write (via useOverride) pushes a snapshot to the history
 * stack. This hook exposes navigation through that stack.
 *
 * @returns {{ undo: function, redo: function, canUndo: boolean, canRedo: boolean }}
 */
export function useUndoRedo() {
  // Re-render on storage or hash changes
  useSyncExternalStore(subscribeToStorage, getStorageSnapshot)
  useSyncExternalStore(subscribeToHash, getHashSnapshot)

  const handleUndo = useCallback(() => undo(), [])
  const handleRedo = useCallback(() => redo(), [])

  return {
    undo: handleUndo,
    redo: handleRedo,
    canUndo: canUndo(),
    canRedo: canRedo(),
  }
}
