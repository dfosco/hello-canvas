/**
 * Self-contained file-widget pane used by split-screen / expanded views
 * when the file widget is a *secondary* pane (the user split-screened
 * from another widget that's connected to a file widget).
 *
 * Subscribes to the shared fileContentStore so its content stays in sync
 * with the in-canvas widget and the cmd+S binding, debounce timers, etc.
 * Editing state is local to this pane — toggling via the title-bar
 * action notifies the surrounding ExpandedPane to re-render the
 * titlebar so the Edit ↔ Save label flips.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownView, MarkdownTextEditor } from '../markdown/MarkdownEditor.jsx'
import { detectFlavor } from './fileFlavor.js'
import {
  subscribe,
  saveFile,
  updateContent,
  getFileEntry,
} from './fileContentStore.js'
import CodeEditor from './CodeEditor.jsx'
import MdxRenderer from './MdxRenderer.jsx'
import styles from './FileWidget.module.css'

export function FileSecondaryPane({ widget, editingRef }) {
  const path = widget.props?.path || ''
  const { flavor } = (() => {
    try { return detectFlavor(path) } catch { return { flavor: 'unsupported' } }
  })()

  const [entry, setEntry] = useState({
    content: '', exists: undefined, loading: false, dirty: false, error: null, hasExternalChange: false,
  })
  const [editing, setEditing] = useState(false)

  // Keep the shared editingRef in lock-step so the outer pane title bar can
  // read the current editing state via getState('editing').
  // eslint-disable-next-line react-hooks/refs
  editingRef.current = editing
  // eslint-disable-next-line react-hooks/refs
  editingRef.setter = (next) => {
    setEditing((wasEditing) => {
      // Save-on-exit so toggling Edit/Save from the title bar mirrors the
      // in-canvas behavior.
      if (wasEditing && !next && path) {
        const live = getFileEntry(path)
        if (live.dirty) saveFile(path)
      }
      return next
    })
    document.dispatchEvent(new CustomEvent('storyboard:expanded-pane:refresh'))
  }

  useEffect(() => {
    if (!path) return undefined
    return subscribe(path, (e) => setEntry({ ...e }))
  }, [path])

  // Autosave on tab/window blur while editing — mirror the primary pane.
  useEffect(() => {
    if (!path || !editing || flavor === 'code') return undefined
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

  // cmd+S inside this pane saves the file (without exiting edit mode).
  const rootRef = useRef(null)
  useEffect(() => {
    if (!path) return undefined
    function onKeyDownCapture(e) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return
      const root = rootRef.current
      if (!root) return
      if (!root.contains(document.activeElement)) return
      e.preventDefault()
      e.stopPropagation()
      saveFile(path)
    }
    document.addEventListener('keydown', onKeyDownCapture, true)
    return () => document.removeEventListener('keydown', onKeyDownCapture, true)
  }, [path])

  const handleChange = useCallback((value) => {
    if (path) updateContent(path, value)
  }, [path])

  const handleBlur = useCallback(() => {
    if (!path) return
    const live = getFileEntry(path)
    if (live.dirty) saveFile(path)
  }, [path])

  const handleToggleEdit = useCallback(() => {
    editingRef.setter?.(!editingRef.current)
  }, [editingRef])

  let body = null
  if (entry.exists === false) {
    body = (
      <div className={styles.errorCard} role="alert">
        <strong className={styles.errorTitle}>File not found</strong>
        <code className={styles.errorPath}>{path}</code>
      </div>
    )
  } else if (flavor === 'markdown') {
    body = editing ? (
      <div className={styles.expandedEditorWrap}>
        <MarkdownTextEditor
          className={styles.expandedEditor}
          content={entry.content}
          onChange={handleChange}
          onEscape={() => { handleBlur(); handleToggleEdit() }}
        />
      </div>
    ) : (
      <MarkdownView
        className={styles.expandedPreview}
        content={entry.content}
        size="large"
        emptyHtml="<p>No content</p>"
      />
    )
  } else if (flavor === 'mdx') {
    body = editing ? (
      <div className={styles.expandedEditorWrap}>
        <CodeEditor path={path} value={entry.content} onChange={handleChange} onBlur={handleBlur} />
      </div>
    ) : (
      <div className={styles.expandedPreview}>
        <MdxRenderer source={entry.content} size="large" />
      </div>
    )
  } else if (flavor === 'code') {
    body = (
      <div className={styles.expandedEditorWrap}>
        <CodeEditor path={path} value={entry.content} onChange={handleChange} onBlur={handleBlur} />
      </div>
    )
  } else {
    body = (
      <div className={styles.unsupportedState}>
        <span>Cannot edit this file type.</span>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={styles.file}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {body}
    </div>
  )
}
