import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import WidgetWrapper from './WidgetWrapper.jsx'
import ResizeHandle from './ResizeHandle.jsx'
import { readProp } from './widgetProps.js'
import { schemas, getFeaturesForSurface } from './widgetConfig.js'
import ExpandedPane from './ExpandedPane.jsx'
import { findAllConnectedSplitTargets, getSplitPaneLabel, buildPaneForWidget, buildSplitLayout } from './expandUtils.js'
import { useExpandOverride } from './useExpandOverride.js'
import { MarkdownView, MarkdownTextEditor } from './markdown/MarkdownEditor.jsx'
import styles from './MarkdownBlock.module.css'

const markdownSchema = schemas['markdown']

export default forwardRef(function MarkdownBlock({ id, props, onUpdate, resizable }, ref) {
  const content = readProp(props, 'content', markdownSchema)
  const width = readProp(props, 'width', markdownSchema)
  const height = props?.height
  const collapsed = !!props?.collapsed
  const canEdit = typeof onUpdate === 'function'
  const [editing, setEditing] = useState(false)
  const [expandMode, setExpandMode] = useExpandOverride('markdown', id)
  const expanded = expandMode !== null
  const editingActive = canEdit && editing
  const collapsedActive = collapsed && !editingActive
  const blockRef = useRef(null)
  const [editHeight, setEditHeight] = useState(null)

  useImperativeHandle(ref, () => ({
    handleAction(actionId) {
      if (actionId === 'expand' || actionId === 'expand-single') { setExpandMode('single'); return true }
      if (actionId === 'split-screen') { setExpandMode('split'); return true }
      return false
    },
  }), [])

  const handleResize = useCallback((w, h) => {
    onUpdate?.({ width: w, height: h })
  }, [onUpdate])

  const handleContentChange = useCallback((value) => {
    onUpdate?.({ content: value })
  }, [onUpdate])

  const handleReadOnlyCopy = useCallback((e) => {
    if (canEdit) return
    e.preventDefault()
    e.stopPropagation()
    if (e.clipboardData?.setData) {
      e.clipboardData.setData('text/plain', content || '')
    }
  }, [canEdit, content])

  const startEditing = useCallback(() => {
    // Capture the preview height BEFORE React swaps to the textarea so the
    // widget doesn't collapse to its min-height during the transition.
    if (blockRef.current) {
      setEditHeight(blockRef.current.offsetHeight)
      blockRef.current.dataset.scrollTop = blockRef.current.scrollTop
    }
    setEditing(true)
  }, [])

  useEffect(() => {
    if (editingActive) {
      // Restore the block's scroll position (captured before React swapped the
      // DOM) on the next frame, after the textarea has been laid out.
      if (blockRef.current) {
        blockRef.current.scrollTop = blockRef.current.dataset.scrollTop || 0
      }
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditHeight(null)
    }
  }, [editingActive])

  return (
    <>
    <WidgetWrapper>
      <div
        ref={blockRef}
        className={`${styles.block}${collapsedActive ? ` ${styles.blockCollapsed}` : ''}`}
        style={{
          width,
          ...(height ? {
            height,
            // Collapsed keeps its fade + clipped overflow, but an explicit
            // height (from vertical resize) must beat the default 360px
            // collapse cap so the widget stays vertically resizable.
            overflow: collapsedActive ? 'hidden' : 'auto',
            ...(collapsedActive ? { maxHeight: 'none' } : {}),
          } : {}),
          ...(editHeight ? { height: editHeight, display: 'flex', flexDirection: 'column' } : {}),
        }}
      >
        {editingActive ? (
          <MarkdownTextEditor
            className={styles.editor}
            style={{ flex: 1 }}
            content={content}
            onChange={handleContentChange}
            onExit={() => setEditing(false)}
          />
        ) : (
          <MarkdownView
            className={styles.preview}
            style={!canEdit ? { cursor: 'default' } : undefined}
            content={content}
            canEdit={canEdit}
            onStartEditing={startEditing}
            onCopy={!canEdit ? handleReadOnlyCopy : undefined}
            allowTextSelection={!canEdit}
            size="small"
            inert
            emptyHtml={canEdit
              ? '<p class="placeholder">Double-click to edit…</p>'
              : '<p class="placeholder">No content</p>'}
          />
        )}
        {resizable && (
          <ResizeHandle
            targetRef={blockRef}
            minWidth={200}
            minHeight={60}
            onResize={handleResize}
          />
        )}
      </div>
    </WidgetWrapper>
    {expanded && (
      <MarkdownExpandPane
        widgetId={id}
        content={content}
        splitMode={expandMode === 'split'}
        onClose={() => setExpandMode(null)}
        onUpdate={onUpdate}
      />
    )}
    </>
  )
})

/**
 * Builds pane configs and renders ExpandedPane for an expanded markdown widget.
 */
function MarkdownExpandPane({ widgetId, content, splitMode, onClose, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const canEdit = typeof onUpdate === 'function'

  const connectedWidgets = useMemo(
    () => splitMode ? findAllConnectedSplitTargets(widgetId) : [],
    [widgetId, splitMode],
  )
  const primaryWidget = useMemo(() => {
    const bridge = window.__storyboardCanvasBridgeState
    return bridge?.widgets?.find((w) => w.id === widgetId) || { id: widgetId, type: 'markdown', position: { x: 0, y: 0 }, props: {} }
  }, [widgetId])

  // Surface: fullbar for single expand, splitbar for split
  const surface = splitMode ? 'splitbar' : 'fullbar'
  const surfaceFeatures = useMemo(
    () => canEdit ? getFeaturesForSurface('markdown', surface) : [],
    [canEdit, surface],
  )

  const getState = useCallback((key) => {
    if (key === 'editing') return editing
    return undefined
  }, [editing])

  const handleAction = useCallback((actionId) => {
    if (actionId === 'toggle-edit') {
      setEditing((v) => !v)
    }
  }, [])

  const buildPaneFn = useCallback((widget) => {
    if (widget.id === widgetId) {
      return {
        id: widgetId,
        label: getSplitPaneLabel(primaryWidget) || 'Markdown',
        widgetType: 'markdown',
        kind: 'react',
        features: surfaceFeatures,
        getState,
        onAction: handleAction,
        render: () => (
          <ExpandedMarkdownEditor
            content={content}
            onUpdate={onUpdate}
            editing={editing}
            onToggleEdit={() => setEditing((v) => !v)}
          />
        ),
      }
    }
    return buildPaneForWidget(widget, surface)
  }, [widgetId, primaryWidget, content, onUpdate, editing, surfaceFeatures, getState, handleAction, surface])

  const layout = useMemo(
    () => buildSplitLayout(primaryWidget, connectedWidgets, buildPaneFn),
    [primaryWidget, connectedWidgets, buildPaneFn],
  )

  return (
    <ExpandedPane
      initialLayout={layout}
      variant={layout.flat().length <= 1 ? 'modal' : 'full'}
      onClose={onClose}
    />
  )
}

/**
 * Editable markdown view for expanded/split-screen panes.
 * Self-contained: renders markdown from raw content with syntax highlighting.
 * Editing state is controlled externally via props (toggle button lives in the title bar).
 */
export function ExpandedMarkdownEditor({ content, onUpdate, editing, onToggleEdit }) {
  const canEdit = typeof onUpdate === 'function'

  if (editing && canEdit) {
    return (
      <div className={styles.expandedEditorWrap}>
        <MarkdownTextEditor
          className={styles.expandedEditor}
          content={content}
          onChange={(value) => onUpdate({ content: value })}
          onExit={() => onToggleEdit?.()}
        />
      </div>
    )
  }

  return (
    <MarkdownView
      className={styles.expandedPreview}
      style={{ flex: 1, overflow: 'auto' }}
      content={content}
      canEdit={canEdit}
      onStartEditing={onToggleEdit}
      size="large"
      emptyHtml="<p>No content</p>"
    />
  )
}
