/**
 * FilePicker — modal for browsing and selecting a repo file.
 *
 * Loads the file tree from `/_storyboard/file/tree`, shows it as an
 * expandable nested tree, and supports a filter input that flattens the
 * tree to matching paths.
 *
 * @param {object} props
 * @param {boolean}  props.isOpen        — whether the modal is visible
 * @param {string}   [props.initialFilter] — pre-filled filter text
 * @param {function} props.onSelect      — called with the chosen path string
 * @param {function} props.onCancel      — called when the modal is dismissed
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import Dialog from '../../../Dialog.jsx'
import Icon from '../../../Icon.jsx'
import styles from './FilePicker.module.css'

function getApiBase() {
  return (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
}

/** Flatten a tree (array of nodes OR a single node) into file-only paths. */
function flattenTree(node, acc = []) {
  if (!node) return acc
  if (Array.isArray(node)) {
    for (const child of node) flattenTree(child, acc)
    return acc
  }
  if (node.kind === 'file') {
    acc.push(node.path)
  } else if (node.children) {
    for (const child of node.children) {
      flattenTree(child, acc)
    }
  }
  return acc
}

/** A single row in the tree view. */
function TreeNode({ node, depth, selected, onSelect, expandedDirs, onToggleDir }) {
  const isDir = node.kind === 'dir'
  const isExpanded = expandedDirs.has(node.path)
  const isSelected = !isDir && selected === node.path

  function handleClick() {
    if (isDir) {
      onToggleDir(node.path)
    } else {
      onSelect(node.path)
    }
  }

  return (
    <>
      <div
        role={isDir ? 'button' : 'option'}
        aria-selected={isSelected}
        tabIndex={-1}
        className={`${styles.treeRow} ${isSelected ? styles.treeRowSelected : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleClick}
        data-path={node.path}
      >
        <span className={styles.treeRowIcon}>
          {isDir ? (
            <Icon name={isExpanded ? 'primer/file-directory-open-fill' : 'primer/file-directory-fill'} size={14} />
          ) : (
            <Icon name="primer/file" size={14} />
          )}
        </span>
        <span className={styles.treeRowName}>{node.name}</span>
        {isDir && (
          <span className={styles.treeRowChevron}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}
              aria-hidden="true"
            >
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </span>
        )}
      </div>
      {isDir && isExpanded && node.children && node.children.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
        />
      ))}
    </>
  )
}

/** Collect all visible (rendered) file paths in order, for keyboard nav. */
function collectVisibleFiles(node, expandedDirs, acc = []) {
  if (!node) return acc
  if (node.kind === 'file') {
    acc.push(node.path)
  } else if (node.children) {
    if (expandedDirs.has(node.path)) {
      for (const child of node.children) {
        collectVisibleFiles(child, expandedDirs, acc)
      }
    }
  }
  return acc
}

export default function FilePicker({ isOpen, initialFilter = '', onSelect, onCancel, onImport }) {
  const [tree, setTree] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [importError, setImportError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState(initialFilter)
  const [selected, setSelected] = useState(null)
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const filterRef = useRef(null)
  const treeRef = useRef(null)

  const loadTree = useCallback(() => {
    setLoading(true)
    setError(null)
    const url = `${getApiBase()}/_storyboard/file/tree`
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json()
      })
      .then((data) => {
        // Server responds { tree: [rootChild1, rootChild2, ...] }
        // (an array of repo root's top-level entries). Normalize to that
        // array so the renderer can iterate uniformly.
        const list = Array.isArray(data?.tree)
          ? data.tree
          : (data?.tree ? [data.tree] : [])
        setTree(list)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load file tree')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (isOpen) {
      setFilter(initialFilter)
      setSelected(null)
      setImportError(null)
      loadTree()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isOpen && filterRef.current) {
      filterRef.current.focus()
    }
  }, [isOpen])

  function handleToggleDir(path) {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function handleSelect() {
    if (selected) {
      onSelect(selected)
    }
  }

  async function handleImport() {
    if (!onImport || importing) return
    setImportError(null)
    setImporting(true)
    try {
      const importedPath = await onImport()
      if (importedPath) onSelect(importedPath)
    } catch (failure) {
      setImportError(failure?.message || 'Could not import the selected file.')
    } finally {
      setImporting(false)
    }
  }

  // Flat list of matching paths for filtered view
  const allFiles = tree ? flattenTree(tree) : []
  const filteredFiles = filter.trim()
    ? allFiles.filter((p) => p.toLowerCase().includes(filter.trim().toLowerCase()))
    : null

  // Keyboard navigation
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      onCancel()
      return
    }
    if (e.key === 'Enter' && selected) {
      handleSelect()
      return
    }

    const isUp = e.key === 'ArrowUp'
    const isDown = e.key === 'ArrowDown'
    if (!isUp && !isDown) return

    e.preventDefault()
    const visibleFiles = filteredFiles || (Array.isArray(tree)
      ? tree.reduce((acc, child) => collectVisibleFiles(child, expandedDirs, acc), [])
      : [])

    if (!visibleFiles.length) return
    const currentIdx = selected ? visibleFiles.indexOf(selected) : -1
    let nextIdx = isDown ? currentIdx + 1 : currentIdx - 1
    nextIdx = Math.max(0, Math.min(visibleFiles.length - 1, nextIdx))
    setSelected(visibleFiles[nextIdx])

    // Scroll into view
    if (treeRef.current) {
      const el = treeRef.current.querySelector(`[data-path="${CSS.escape(visibleFiles[nextIdx])}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }

  if (!isOpen) return null

  return (
    <Dialog title="Pick a file" onClose={onCancel} width="medium">
      <div className={styles.pickerBody} onKeyDown={handleKeyDown}>
        <input
          ref={filterRef}
          type="text"
          className={styles.filterInput}
          placeholder="Filter files…"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelected(null) }}
          aria-label="Filter files"
        />

        <div ref={treeRef} className={styles.treeContainer} role="listbox" aria-label="File tree">
          {loading && (
            <div className={styles.stateMessage}>Loading…</div>
          )}

          {error && !loading && (
            <div className={styles.errorState}>
              <span className={styles.errorText}>{error}</span>
              <button type="button" className={styles.retryBtn} onClick={loadTree}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && tree && filteredFiles !== null && (
            filteredFiles.length === 0 ? (
              <div className={styles.stateMessage}>No files match &quot;{filter}&quot;</div>
            ) : (
              filteredFiles.map((path) => (
                <div
                  key={path}
                  role="option"
                  aria-selected={selected === path}
                  tabIndex={-1}
                  className={`${styles.treeRow} ${selected === path ? styles.treeRowSelected : ''}`}
                  onClick={() => setSelected(path)}
                  data-path={path}
                >
                  <span className={styles.treeRowIcon}>
                    <Icon name="primer/file" size={14} />
                  </span>
                  <span className={styles.treeRowName}>{path}</span>
                </div>
              ))
            )
          )}

          {!loading && !error && tree && filteredFiles === null && (
            (Array.isArray(tree) ? tree : [tree]).map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={0}
                selected={selected}
                onSelect={setSelected}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
              />
            ))
          )}
        </div>

        {importError && <div className={styles.importError} role="alert">{importError}</div>}
        <div className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.importBtn} onClick={handleImport} disabled={!onImport || importing}>
            {importing ? 'Importing…' : 'Import from computer…'}
          </button>
          <button
            type="button"
            className={styles.selectBtn}
            onClick={handleSelect}
            disabled={!selected}
          >
            Select
          </button>
        </div>
      </div>
    </Dialog>
  )
}
