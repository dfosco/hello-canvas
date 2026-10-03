import { useState, useRef, useCallback } from 'react'
import { readProp, stickyNoteSchema } from './widgetProps.js'
import ResizeHandle from './ResizeHandle.jsx'
import { MarkdownView, MarkdownTextEditor } from './markdown/MarkdownEditor.jsx'
import styles from './StickyNote.module.css'

const COLORS = {
  yellow: { bg: '#fff8c5', border: '#d4a72c', dot: '#e8c846' },
  blue: { bg: '#ddf4ff', border: '#54aeff', dot: '#74b9ff' },
  green: { bg: '#dafbe1', border: '#4ac26b', dot: '#6dd58c' },
  pink: { bg: '#ffebe9', border: '#ff8182', dot: '#ff9a9e' },
  purple: { bg: '#fbefff', border: '#c297ff', dot: '#d4a8ff' },
  orange: { bg: '#fff1e5', border: '#d18616', dot: '#e8a844' },
}

// Base area corresponds to the default 270×170 sticky size. When
// `autoScaleText` is on we scale the text by √(area / BASE_AREA), then
// clamp to a conservative range so the text stays legible at extreme
// sizes (the cap is intentionally low — a giant sticky shouldn't have
// 80px text just because it has the room).
const BASE_AREA = 270 * 170
const MIN_SCALE = 0.8
const MAX_SCALE = 2

function computeTextScale(width, height) {
  if (typeof width !== 'number' || typeof height !== 'number') return 1
  if (width <= 0 || height <= 0) return 1
  const ratio = Math.sqrt((width * height) / BASE_AREA)
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, ratio))
}

export default function StickyNote({ props, onUpdate, resizable }) {
  const text = readProp(props, 'text', stickyNoteSchema)
  const color = readProp(props, 'color', stickyNoteSchema)
  const width = readProp(props, 'width', stickyNoteSchema)
  const height = readProp(props, 'height', stickyNoteSchema)
  const autoScaleText = !!readProp(props, 'autoScaleText', stickyNoteSchema)
  const canEdit = typeof onUpdate === 'function'
  const palette = COLORS[color] ?? COLORS.yellow
  const stickyRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const editingActive = canEdit && editing

  const handleResize = useCallback((w, h) => {
    onUpdate?.({ width: w, height: h })
  }, [onUpdate])

  const handleTextChange = useCallback((value) => {
    onUpdate?.({ text: value })
  }, [onUpdate])

  const textStyle = autoScaleText
    ? { '--sticky-text-scale': computeTextScale(width, height) }
    : undefined

  return (
    <div className={styles.container}>
      <article
        ref={stickyRef}
        className={styles.sticky}
        data-auto-scale={autoScaleText ? '' : undefined}
        style={{
          '--sticky-bg': palette.bg,
          '--sticky-border': palette.border,
          ...(typeof width === 'number' ? { width: `${width}px` } : undefined),
          ...(typeof height === 'number' ? { height: `${height}px` } : undefined),
        }}
      >
        {editingActive ? (
          <MarkdownTextEditor
            content={text}
            onChange={handleTextChange}
            onExit={() => setEditing(false)}
            className={styles.textarea}
            style={textStyle}
            placeholder="Type here…"
          />
        ) : (
          <MarkdownView
            content={text}
            canEdit={canEdit}
            onStartEditing={() => setEditing(true)}
            className={styles.text}
            style={textStyle}
            allowTextSelection={!canEdit}
            size="small"
            inert
          />
        )}
        {resizable && (
          <ResizeHandle
            targetRef={stickyRef}
            minWidth={180}
            minHeight={60}
            onResize={handleResize}
          />
        )}
      </article>
    </div>
  )
}
