import { useCallback } from 'react'
import styles from './ResizeHandle.module.css'

/**
 * Shared resize handle for canvas widgets.
 *
 * Renders a small drag handle in the bottom-right corner of the parent.
 * On drag, calls `onResize(width, height)` with new dimensions.
 *
 * The parent must have `position: relative` for correct positioning.
 *
 * @param {Object} props
 * @param {React.RefObject} props.targetRef - ref to the element being resized (reads offsetWidth/Height)
 * @param {number} [props.minWidth=180]  - minimum allowed width
 * @param {number} [props.minHeight=60]  - minimum allowed height
 * @param {'both'|'vertical'|'horizontal'} [props.axis='both'] - constrain resize to a single axis
 * @param {Function} props.onResize - callback: (width, height) => void
 * @param {Function} [props.onResizeStart] - called when drag begins
 * @param {Function} [props.onResizeEnd] - called with final (width, height) on drag end
 */
export default function ResizeHandle({ targetRef, minWidth = 180, minHeight = 60, axis = 'both', onResize, onResizeStart, onResizeEnd }) {
  const handleMouseDown = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()

    const el = targetRef?.current
    if (!el) return

    const startX = e.clientX
    const startY = e.clientY
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    let lastW = startW
    let lastH = startH

    onResizeStart?.()

    // Capture zoom at drag start so resizing stays consistent mid-drag.
    // Derive scale from the element's rendered size vs offsetWidth, which
    // accounts for the canvas's CSS transform regardless of zoom plumbing.
    const rect = el.getBoundingClientRect()
    const scale = startW > 0 && rect.width > 0 ? rect.width / startW : 1

    function onMove(ev) {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      lastW = axis === 'vertical' ? startW : Math.max(minWidth, startW + dx)
      lastH = axis === 'horizontal' ? startH : Math.max(minHeight, startH + dy)
      onResize?.(lastW, lastH)
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      onResizeEnd?.(lastW, lastH)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [targetRef, minWidth, minHeight, axis, onResize, onResizeStart, onResizeEnd])

  const cursor = axis === 'vertical' ? 'ns-resize' : axis === 'horizontal' ? 'ew-resize' : 'nwse-resize'

  return (
    <div
      className={styles.handle}
      style={axis !== 'both' ? { cursor } : undefined}
      onMouseDown={handleMouseDown}
      onPointerDown={(e) => e.stopPropagation()}
      role="separator"
      aria-orientation={axis === 'vertical' ? 'vertical' : 'horizontal'}
      aria-label="Resize"
    />
  )
}
