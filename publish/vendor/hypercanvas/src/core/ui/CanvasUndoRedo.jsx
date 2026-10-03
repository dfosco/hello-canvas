/**
 * CanvasUndoRedo — grouped undo/redo button bar.
 */
import { useState, useEffect } from 'react'
import './CanvasUndoRedo.css'
import * as Tooltip from '../lib/components/ui/tooltip/index.js'

export default function CanvasUndoRedo({ config = {}, data, tabindex = -1 }) {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  useEffect(() => {
    function handleUndoRedoState(e) {
      setCanUndo(!!e.detail?.canUndo)
      setCanRedo(!!e.detail?.canRedo)
    }
    document.addEventListener('storyboard:canvas:undo-redo-state', handleUndoRedoState)
    return () => {
      document.removeEventListener('storyboard:canvas:undo-redo-state', handleUndoRedoState)
    }
  }, [])

  if (!data) return null

  return (
    <div className="canvas-undo-bar" role="group" aria-label={config.ariaLabel || 'Undo and redo'}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            className="canvas-undo-btn"
            onClick={() => data.undo()}
            disabled={!canUndo}
            aria-label="Undo"
            tabIndex={tabindex}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.75.75 0 1 1-1.06 1.06L1.47 7.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" />
            </svg>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Undo (⌘Z)</Tooltip.Content>
      </Tooltip.Root>
      <span className="canvas-undo-separator"></span>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <button
            className="canvas-undo-btn"
            onClick={() => data.redo()}
            disabled={!canRedo}
            aria-label="Redo"
            tabIndex={-1}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M9.22 1.97a.75.75 0 0 0 0 1.06L12.19 6H5.75A4.75 4.75 0 0 0 1 10.75v2.5a.75.75 0 0 0 1.5 0v-2.5a3.25 3.25 0 0 1 3.25-3.25h6.44l-2.97 2.97a.75.75 0 1 0 1.06 1.06l4.25-4.25a.75.75 0 0 0 0-1.06l-4.25-4.25a.75.75 0 0 0-1.06 0Z" />
            </svg>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content side="top">Redo (⌘⇧Z)</Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}
