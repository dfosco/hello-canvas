/**
 * CropOverlay — interactive crop selection over an image.
 *
 * Renders:
 * - A crop region with drag handles (corners + edges)
 * - Dark overlay on excluded area (via box-shadow)
 * - Rule-of-thirds grid
 *
 * The confirmation bar (CropBar) is rendered separately by ImageWidget,
 * outside the WidgetWrapper, to avoid overflow clipping.
 *
 * Props:
 *   containerWidth / containerHeight — pixel dimensions of the image container
 *   cropRect — current crop rectangle { x, y, width, height } in display pixels
 *   onCropRectChange(rect) — called when the user drags the crop region
 *   onCancel() — exit crop mode without saving
 */
import { useRef, useCallback, useEffect } from 'react'
import styles from './CropOverlay.module.css'

const MIN_CROP = 20

function clamp(v, min, max) { return Math.min(Math.max(v, min), max) }

const HANDLES = ['NW', 'NE', 'SW', 'SE', 'N', 'S', 'W', 'E']

/* SVG micro-icons */
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  )
}

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.22 6.28a.749.749 0 0 1 0-1.06l3.5-3.5a.749.749 0 1 1 1.06 1.06L3.56 5h7.19a5.25 5.25 0 0 1 0 10.5H9.25a.75.75 0 0 1 0-1.5h1.5a3.75 3.75 0 0 0 0-7.5H3.56l2.22 2.22a.749.749 0 1 1-1.06 1.06Z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  )
}

export default function CropOverlay({
  containerWidth,
  containerHeight,
  cropRect,
  onCropRectChange,
  onCancel,
}) {
  const cw = containerWidth || 400
  const ch = containerHeight || 300

  const dragging = useRef(null)

  // Escape key cancels crop
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  const startDrag = useCallback((handleId, e) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = {
      handle: handleId,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...cropRect },
    }

    const onMove = (me) => {
      if (!dragging.current) return
      const { handle, startX, startY, startCrop } = dragging.current
      const dx = me.clientX - startX
      const dy = me.clientY - startY

      let { x, y, width, height } = startCrop

      if (handle === 'move') {
        x = clamp(startCrop.x + dx, 0, cw - width)
        y = clamp(startCrop.y + dy, 0, ch - height)
      } else {
        if (handle.includes('W') || handle === 'W') {
          const newX = clamp(startCrop.x + dx, 0, startCrop.x + startCrop.width - MIN_CROP)
          width = startCrop.width - (newX - startCrop.x)
          x = newX
        }
        if (handle.includes('E') || handle === 'E') {
          width = clamp(startCrop.width + dx, MIN_CROP, cw - startCrop.x)
        }
        if (handle.includes('N') || handle === 'N') {
          const newY = clamp(startCrop.y + dy, 0, startCrop.y + startCrop.height - MIN_CROP)
          height = startCrop.height - (newY - startCrop.y)
          y = newY
        }
        if (handle.includes('S') || handle === 'S') {
          height = clamp(startCrop.height + dy, MIN_CROP, ch - startCrop.y)
        }
      }

      onCropRectChange({ x, y, width, height })
    }

    const onUp = () => {
      dragging.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [cropRect, cw, ch, onCropRectChange])

  return (
    <div
      className={styles.overlay}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={styles.cropRegion}
        style={{
          left: cropRect.x,
          top: cropRect.y,
          width: cropRect.width,
          height: cropRect.height,
        }}
        onPointerDown={(e) => startDrag('move', e)}
      >
        {HANDLES.map((h) => (
          <div
            key={h}
            className={`${styles.handle} ${styles[`handle${h}`]}`}
            onPointerDown={(e) => startDrag(h, e)}
          />
        ))}
      </div>

    </div>
  )
}

/**
 * CropBar — crop confirmation toolbar rendered outside the image widget.
 * Positioned by the parent (ImageWidget) in place of the WidgetChrome toolbar.
 */
export function CropBar({ cropW, cropH, onSave, onUndo, onCancel, canUndo }) {
  return (
    <div
      className={styles.cropBar}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className={styles.dimensions}>{cropW} × {cropH}</span>
      <span className={styles.separator} />
      <button className={`${styles.cropBarBtn} ${styles.cropBarBtnSave}`} onClick={onSave}>
        <CheckIcon /> Save
      </button>
      {canUndo && (
        <button className={styles.cropBarBtn} onClick={onUndo}>
          <UndoIcon /> Undo
        </button>
      )}
      <button className={`${styles.cropBarBtn} ${styles.cropBarBtnCancel}`} onClick={onCancel}>
        <XIcon />
      </button>
    </div>
  )
}
