import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import Icon from '../../../Icon.jsx'
import WidgetWrapper from '../WidgetWrapper.jsx'
import ResizeHandle from '../ResizeHandle.jsx'
import { readProp } from '../widgetProps.js'
import { schemas, getFeaturesForSurface } from '../widgetConfig.js'
import ExpandedPane from '../ExpandedPane.jsx'
import { findAllConnectedSplitTargets, getSplitPaneLabel, buildPaneForWidget, buildSplitLayout } from '../expandUtils.js'
import { useExpandOverride } from '../useExpandOverride.js'
import { MarkdownView, MarkdownTextEditor } from '../markdown/MarkdownEditor.jsx'
import { detectFlavor } from './fileFlavor.js'
import {
  subscribe,
  saveFile,
  updateContent,
  refetchFile,
  pollFile,
  renameFile,
  getFileEntry,
} from './fileContentStore.js'
import CodeEditor, { preloadCodeMirror } from './CodeEditor.jsx'
import MdxRenderer from './MdxRenderer.jsx'
import styles from './FileWidget.module.css'

const fileSchema = schemas['file']

export default forwardRef(function FileWidget({ id, props, onUpdate, resizable }, ref) {
  const path = readProp(props, 'path', fileSchema) || ''
  const width = readProp(props, 'width', fileSchema)
  const height = readProp(props, 'height', fileSchema)
  const canEdit = typeof onUpdate === 'function'

  const [entry, setEntry] = useState({ content: '', exists: undefined, loading: false, dirty: false, error: null, hasExternalChange: false })
  const [editing, setEditing] = useState(false)
  const [componentName, setComponentName] = useState(null)
  const [expandMode, setExpandMode] = useExpandOverride('file', id)
  const expanded = expandMode !== null

  const rootRef = useRef(null)
  const editorRef = useRef(null)

  const { flavor } = useMemo(() => detectFlavor(path), [path])

  // Pre-warm CodeMirror on mount so markdown widgets entering edit mode
  // (and the first MDX/code widget to mount) don't sit on an unstyled
  // placeholder for seconds while Vite discovers + bundles the editor.
  useEffect(() => {
    preloadCodeMirror()
  }, [])

  // Subscribe to file content store
  useEffect(() => {
    if (!path) return
    const unsub = subscribe(path, (e) => setEntry({ ...e }))
    return unsub
  }, [path])

  // Code flavor is always in edit mode
  const effectiveEditing = flavor === 'code' ? true : editing

  // Poll for external changes every 5s while NOT in edit mode. The store also
  // refetches on the HMR `storyboard:file-changed` WS event, but that signal
  // isn't always delivered (production embeds, cross-port workleaves, missed
  // HMR frames), so this interval is the reliable fallback. pollFile only
  // notifies on an actual content change, so idle previews don't churn. While
  // editing we skip polling so the user's buffer is never disturbed mid-edit.
  useEffect(() => {
    if (!path || effectiveEditing) return
    const POLL_MS = 5000
    const intervalId = setInterval(() => {
      pollFile(path)
    }, POLL_MS)
    return () => clearInterval(intervalId)
  }, [path, effectiveEditing])

  const handleSave = useCallback(() => {
    if (!path) return
    saveFile(path)
  }, [path])

  // cmd+S / ctrl+S binding — listen at document level (capture phase) so
  // the browser's native "Save Page" shortcut is intercepted BEFORE any
  // child editor (CodeMirror, textarea) consumes the event. Only active
  // while this widget owns focus (root contains document.activeElement).
  useEffect(() => {
    if (!path) return
    function onKeyDownCapture(e) {
      // Accept either Cmd (Mac) or Ctrl (everyone else). Don't gate on
      // platform — some keyboards/remotes report one or the other.
      const saveKey = e.metaKey || e.ctrlKey
      if (!saveKey || e.key !== 's') return
      const root = rootRef.current
      if (!root) return
      if (!root.contains(document.activeElement)) return
      e.preventDefault()
      e.stopPropagation()
      handleSave()
    }
    document.addEventListener('keydown', onKeyDownCapture, true)
    return () => document.removeEventListener('keydown', onKeyDownCapture, true)
  }, [path, handleSave])

  const handleResize = useCallback((w, h) => {
    onUpdate?.({ width: w, height: h })
  }, [onUpdate])

  const handleContentChange = useCallback((value) => {
    if (!path) return
    updateContent(path, value)
  }, [path])

  const handleBlur = useCallback(() => {
    // Read dirty flag directly from the store — entry from useState may be
    // a stale snapshot if updateContent fired in the same tick as blur.
    if (!path) return
    const live = getFileEntry(path)
    if (live.dirty) saveFile(path)
  }, [path])

  /**
   * Unified toggle for the title-bar Edit/Save button. Entering edit mode
   * just flips state; exiting persists any dirty content and flips back.
   * Code flavor is permanently in edit mode so the button is hidden.
   */
  const handleToggleEdit = useCallback(() => {
    if (flavor === 'code') return
    if (editing) {
      // Leaving edit mode — flush pending changes from the store.
      if (path) {
        const live = getFileEntry(path)
        if (live.dirty) saveFile(path)
      }
      setEditing(false)
      return
    }
    // Entering edit mode — pull the latest server state first so the editor
    // never opens on stale content the 5s poll hadn't caught yet.
    if (path) {
      const live = getFileEntry(path)
      if (!live.dirty) refetchFile(path)
    }
    setEditing(true)
  }, [flavor, path, editing])

  /**
   * Auto-save dirty content whenever the browser tab / app window loses
   * focus or becomes hidden. We intentionally do NOT exit edit mode here —
   * the user may have just Cmd-Tabbed away to look something up, and
   * coming back to find the editor closed would be jarring. Exit mode is
   * driven exclusively by the Edit/Save button, Escape, or the toolbar
   * action.
   *
   * Both `blur` (window loses focus to another app/tab) and `visibility
   * change` (tab hidden / minimized) are listened for — the former covers
   * most desktop browsers and webview wrappers like Tauri/Electron, the
   * latter covers tab-switching and OS-level hiding. Either is sufficient
   * on its own; together they cover every realistic "user just left"
   * signal across browsers, OS shells, and embedded webviews.
   */
  useEffect(() => {
    if (!path || !editing || flavor === 'code') return
    function flush() {
      const live = getFileEntry(path)
      if (live.dirty) saveFile(path)
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('blur', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [path, editing, flavor])

  const handleRenameFile = useCallback(async () => {
    if (!path) return
    const basename = path.split('/').pop() || ''
    const newBasename = window.prompt('Rename file:', basename)
    if (!newBasename || newBasename === basename) return
    const dir = path.slice(0, path.length - basename.length)
    const newPath = dir + newBasename
    try {
      await renameFile(path, newPath)
      onUpdate?.({ path: newPath })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[FileWidget] rename failed:', err)
    }
  }, [path, onUpdate])

  useImperativeHandle(ref, () => ({
    handleAction(actionId) {
      if (actionId === 'toggle-edit') {
        // Delegate to the unified toggle so the toolbar action behaves
        // identically to the title-bar Edit/Save button: entering edit
        // mode just flips state, exiting flushes any dirty content.
        if (flavor === 'code') return true // code is always editing
        handleToggleEdit()
        return true
      }
      if (actionId === 'save') {
        handleSave()
        return true
      }
      if (actionId === 'expand' || actionId === 'expand-single') {
        setExpandMode('single')
        return true
      }
      if (actionId === 'split-screen') {
        setExpandMode('split')
        return true
      }
      if (actionId === 'copy-path') {
        navigator.clipboard?.writeText(path)
        return true
      }
      if (actionId === 'rename-file') {
        handleRenameFile()
        return true
      }
      return false
    },
  }), [flavor, handleSave, handleToggleEdit, setExpandMode, path, handleRenameFile])

  // ── Empty state (no path configured)
  if (!path) {
    return (
      <WidgetWrapper>
        <div
          ref={rootRef}
          className={styles.file}
          style={{ width, height }}
        >
          <div className={styles.emptyState}>
            <p>No file selected.</p>
            <button
              className={styles.pickFileButton}
              onClick={() => {
                document.dispatchEvent(new CustomEvent('storyboard:canvas:open-file-picker', {
                  detail: { widgetId: id },
                }))
              }}
            >
              Pick a file…
            </button>
          </div>
        </div>
      </WidgetWrapper>
    )
  }

  // ── Loading state
  if (entry.loading && entry.exists === undefined) {
    return (
      <WidgetWrapper>
        <div className={styles.file} style={{ width, height, position: 'relative' }}>
          <div className={styles.loadingPlaceholder} aria-label="Loading…">
            <div className={styles.spinner} aria-hidden="true" />
          </div>
        </div>
      </WidgetWrapper>
    )
  }

  // ── File doesn't exist
  if (entry.exists === false) {
    return (
      <WidgetWrapper>
        <div className={styles.file} style={{ width, height }}>
          <div className={styles.errorCard} role="alert">
            <strong className={styles.errorTitle}>File not found</strong>
            <code className={styles.errorPath}>{path}</code>
            <p className={styles.errorMessage}>This file no longer exists.</p>
            <button
              className={styles.removeButton}
              onClick={() => {
                document.dispatchEvent(new CustomEvent('storyboard:canvas:delete-widget', {
                  detail: { widgetId: id },
                }))
              }}
            >
              Remove widget
            </button>
          </div>
        </div>
      </WidgetWrapper>
    )
  }

  const flavorIcon = flavor === 'markdown' ? 'primer/markdown'
    : flavor === 'mdx' ? 'primer/markdown'
    : 'primer/file-code'
  const basename = path.split('/').pop() || path
  const dirpath = path.slice(0, path.length - basename.length).replace(/\/$/, '')
  const titleLabel = flavor === 'mdx' && componentName ? componentName : basename

  return (
    <>
      <WidgetWrapper>
        <div
          ref={rootRef}
          className={styles.file}
          style={{ width, height }}
        >
          {/* Title bar — filename left, path + save right */}
          <header className={styles.titleBar}>
            <span className={styles.titleLeft} title={titleLabel}>
              <Icon name={flavorIcon} size={13} />
              <span className={styles.titleName}>{titleLabel}</span>
              {entry.dirty && (
                <span className={styles.dirtyDot} aria-label="Unsaved changes" title="Unsaved changes" />
              )}
            </span>
            <span className={styles.titleRight}>
              {dirpath && (
                <span className={styles.titlePath} title={path}>{dirpath}</span>
              )}
              {canEdit && flavor !== 'code' && (
                <button
                  type="button"
                  className={styles.saveButton}
                  onClick={handleToggleEdit}
                  aria-label={editing ? 'Save file and exit edit mode' : 'Edit file'}
                  aria-pressed={editing}
                  title={editing
                    ? (entry.dirty ? 'Save (⌘S) and exit edit mode' : 'Exit edit mode')
                    : 'Edit file'}
                >
                  {editing ? 'Save' : 'Edit'}
                </button>
              )}
              {canEdit && flavor === 'code' && (
                <button
                  type="button"
                  className={styles.saveButton}
                  onClick={handleSave}
                  disabled={!entry.dirty}
                  aria-label="Save file"
                  title={entry.dirty ? 'Save (⌘S)' : 'No unsaved changes'}
                >
                  Save
                </button>
              )}
            </span>
          </header>

          {/* External change banner */}
          {entry.hasExternalChange && (
            <div className={styles.banner} role="status">
              <span>File was modified on disk.</span>
              <button
                className={styles.bannerButton}
                onClick={() => refetchFile(path)}
              >
                Discard my changes &amp; reload
              </button>
            </div>
          )}

          {/* Content area */}
          <div className={styles.contentArea}>
            {flavor === 'markdown' && (
              <MarkdownContent
                content={entry.content}
                editing={effectiveEditing}
                canEdit={canEdit}
                onChange={handleContentChange}
                onEscape={handleToggleEdit}
              />
            )}
            {flavor === 'mdx' && (
              <MdxContent
                content={entry.content}
                editing={effectiveEditing}
                canEdit={canEdit}
                path={path}
                editorRef={editorRef}
                onChange={handleContentChange}
                onBlur={handleBlur}
                onComponentName={setComponentName}
              />
            )}
            {flavor === 'code' && (
              <div className={styles.editorWrap}>
                <CodeEditor
                  ref={editorRef}
                  path={path}
                  value={entry.content}
                  onChange={canEdit ? handleContentChange : undefined}
                  onBlur={handleBlur}
                  readOnly={!canEdit}
                />
              </div>
            )}
            {flavor === 'unsupported' && (
              <div className={styles.unsupportedState}>
                <span>Cannot edit this file type.</span>
                <code className={styles.unsupportedPath}>{path.split('/').pop()}</code>
              </div>
            )}
          </div>

          {resizable && (
            <ResizeHandle
              targetRef={rootRef}
              minWidth={240}
              minHeight={120}
              onResize={handleResize}
            />
          )}
        </div>
      </WidgetWrapper>

      {expanded && (
        <FileExpandPane
          widgetId={id}
          path={path}
          entry={entry}
          flavor={flavor}
          splitMode={expandMode === 'split'}
          canEdit={canEdit}
          onClose={() => setExpandMode(null)}
        />
      )}
    </>
  )
})

// ── Markdown sub-component ────────────────────────────────────────────────────

function MarkdownContent({ content, editing, canEdit, onChange, onEscape }) {
  if (editing && canEdit) {
    return (
      <div className={styles.editorWrap}>
        <MarkdownTextEditor
          className={styles.markdownEditor}
          content={content}
          onChange={onChange}
          onEscape={onEscape}
        />
      </div>
    )
  }

  // The preview is intentionally non-interactive — entering edit mode goes
  // through the title-bar Edit button (or the Edit/Save toolbar action) so
  // the trigger is a single deliberate click, not a fragile double-click.
  // `inert` makes the rendered content non-interactive (except for links /
  // imgs / videos / task-list checkboxes) so the canvas drag handler can
  // grab the widget by clicking anywhere on the preview.
  return (
    <MarkdownView
      className={styles.viewerWrap}
      content={content}
      size="small"
      inert
      emptyHtml={canEdit
        ? '<p class="placeholder">Click <strong>Edit</strong> to start writing…</p>'
        : '<p class="placeholder">No content</p>'}
    />
  )
}

// ── MDX sub-component ─────────────────────────────────────────────────────────

function MdxContent({ content, editing, canEdit, path, editorRef, onChange, onBlur, onComponentName }) {
  if (editing && canEdit) {
    return (
      <div className={styles.editorWrap}>
        <CodeEditor
          ref={editorRef}
          path={path}
          value={content}
          onChange={onChange}
          onBlur={onBlur}
        />
      </div>
    )
  }

  return (
    <div className={styles.viewerWrap}>
      <MdxRenderer
        source={content}
        onComponentName={onComponentName}
      />
    </div>
  )
}

// ── Expanded pane ─────────────────────────────────────────────────────────────

function FileExpandPane({ widgetId, path, entry, flavor, splitMode, canEdit, onClose }) {
  const [editing, setEditing] = useState(false)
  const surface = splitMode ? 'splitbar' : 'fullbar'
  const surfaceFeatures = useMemo(
    () => canEdit ? getFeaturesForSurface('file', surface) : [],
    [canEdit, surface],
  )

  // cmd+S binding for the expanded pane. The pane portals to document.body
  // (outside the canvas widget's rootRef tree) so the in-canvas listener
  // does not fire here. Bind at document capture-phase while this pane is
  // mounted and active for the underlying file path.
  useEffect(() => {
    if (!path) return
    function onKeyDownCapture(e) {
      const saveKey = e.metaKey || e.ctrlKey
      if (!saveKey || e.key !== 's') return
      e.preventDefault()
      e.stopPropagation()
      saveFile(path)
    }
    document.addEventListener('keydown', onKeyDownCapture, true)
    return () => document.removeEventListener('keydown', onKeyDownCapture, true)
  }, [path])

  // Autosave on tab/window blur while editing — mirrors the in-canvas
  // FileWidget behavior so the expanded/split view doesn't lose work when
  // the user Cmd-Tabs away.
  useEffect(() => {
    if (!path || !editing || flavor === 'code') return
    function flush() {
      const live = getFileEntry(path)
      if (live.dirty) saveFile(path)
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('blur', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [path, editing, flavor])

  const connectedWidgets = useMemo(
    () => splitMode ? findAllConnectedSplitTargets(widgetId) : [],
    [widgetId, splitMode],
  )

  const primaryWidget = useMemo(() => {
    const bridge = window.__storyboardCanvasBridgeState
    return bridge?.widgets?.find((w) => w.id === widgetId) || { id: widgetId, type: 'file', position: { x: 0, y: 0 }, props: {} }
  }, [widgetId])

  const getState = useCallback((key) => {
    if (key === 'editing') return editing
    return undefined
  }, [editing])

  const handleAction = useCallback((actionId) => {
    if (actionId === 'toggle-edit') {
      // Save-on-exit so the toolbar toggle behaves like the in-canvas
      // Edit/Save button — entering edit mode just flips state, exiting
      // flushes any dirty content first.
      setEditing((wasEditing) => {
        if (wasEditing && path) {
          const live = getFileEntry(path)
          if (live.dirty) saveFile(path)
        }
        return !wasEditing
      })
    }
    if (actionId === 'save') {
      if (path) saveFile(path)
    }
  }, [path])

  const handleContentChange = useCallback((value) => {
    updateContent(path, value)
  }, [path])

  const handleBlur = useCallback(() => {
    if (!path) return
    const live = getFileEntry(path)
    if (live.dirty) saveFile(path)
  }, [path])

  const buildPaneFn = useCallback((widget) => {
    if (widget.id === widgetId) {
      return {
        id: widgetId,
        label: getSplitPaneLabel(primaryWidget) || path.split('/').pop() || 'File',
        widgetType: 'file',
        kind: 'react',
        features: surfaceFeatures,
        getState,
        onAction: handleAction,
        render: () => (
          <ExpandedFileView
            path={path}
            entry={entry}
            flavor={flavor}
            editing={editing}
            canEdit={canEdit}
            onChange={handleContentChange}
            onBlur={handleBlur}
            onToggleEdit={() => handleAction('toggle-edit')}
          />
        ),
      }
    }
    return buildPaneForWidget(widget, surface)
  }, [widgetId, primaryWidget, path, entry, flavor, editing, canEdit, surfaceFeatures, getState, handleAction, handleContentChange, handleBlur, surface])

  const layout = useMemo(
    () => buildSplitLayout(primaryWidget, connectedWidgets, buildPaneFn),
    [primaryWidget, connectedWidgets, buildPaneFn],
  )

  return (
    <ExpandedPane
      initialLayout={layout}
      variant="full"
      onClose={onClose}
    />
  )
}

function ExpandedFileView({ path, entry, flavor, editing, canEdit, onChange, onBlur, onToggleEdit }) {
  if (flavor === 'markdown') {
    if (editing && canEdit) {
      return (
        <div className={styles.expandedEditorWrap}>
          <MarkdownTextEditor
            className={styles.expandedEditor}
            content={entry.content}
            onChange={onChange}
            onEscape={() => {
              onBlur?.()
              onToggleEdit?.()
            }}
          />
        </div>
      )
    }
    return (
      <MarkdownView
        className={styles.expandedPreview}
        content={entry.content}
        size="large"
        emptyHtml="<p>No content</p>"
      />
    )
  }

  if (flavor === 'mdx') {
    if (editing && canEdit) {
      return (
        <div className={styles.expandedEditorWrap}>
          <CodeEditor path={path} value={entry.content} onChange={onChange} onBlur={onBlur} />
        </div>
      )
    }
    return (
      <div className={styles.expandedPreview}>
        <MdxRenderer source={entry.content} size="large" />
      </div>
    )
  }

  if (flavor === 'code') {
    return (
      <div className={styles.expandedEditorWrap}>
        <CodeEditor path={path} value={entry.content} onChange={canEdit ? onChange : undefined} onBlur={onBlur} readOnly={!canEdit} />
      </div>
    )
  }

  return (
    <div className={styles.unsupportedState}>
      <span>Cannot edit this file type.</span>
    </div>
  )
}
