import { useCallback, useEffect, useRef, useState } from 'react'
import { FileDirectoryIcon, XIcon } from '@primer/octicons-react'
import DropZone from '../DropZone/DropZone.jsx'
import DirectoryPicker, { validateDirectory } from '../DirectoryPicker/DirectoryPicker.jsx'
import { openNotebookPath, selectNotebookDirectory } from '../../core/notebook/browserBridge.js'
import css from './NotebookDialog.module.css'

function devlog(message, details = {}) {
  console.debug('[devlog][NotebookDialog]', message, details)
}

function errorMessage(failure, fallback) {
  if (typeof failure === 'string') return failure
  if (!failure || typeof failure !== 'object') return fallback
  const parts = [failure.name, failure.code, failure.message].filter(Boolean)
  if (failure.cause) parts.push(`cause: ${typeof failure.cause === 'string' ? failure.cause : JSON.stringify(failure.cause)}`)
  if (failure.stack) parts.push(failure.stack)
  return parts.join('\n') || JSON.stringify(failure) || fallback
}

function selectionFromFiles(fileList) {
  const files = Array.from(fileList || [])
  const paths = files.map(file => file.webkitRelativePath || file.name)
  const firstPath = paths[0] || ''
  const name = firstPath.includes('/') ? firstPath.split('/')[0] : firstPath || 'Selected folder'
  const manifestPath = paths.find(filePath => filePath === 'hypercanvas.notebook.json' || filePath.endsWith('/hypercanvas.notebook.json'))

  return {
    name,
    fileCount: files.length,
    hasManifest: Boolean(manifestPath),
    files,
    path: null,
  }
}

function selectionFromPath(folderPath) {
  const path = String(folderPath || '')
  const name = path.split(/[\\/]/).filter(Boolean).pop() || 'Selected folder'
  return { name, fileCount: null, hasManifest: null, files: [], path }
}

/** Modal entry point for opening a user-owned, content-only Notebook folder. */
export default function NotebookDialog({ open, onOpenChange }) {
  const closeRef = useRef(null)
  const [selection, setSelection] = useState(null)
  const [error, setError] = useState(null)
  const [opening, setOpening] = useState(false)
  const closeDialog = useCallback(() => {
    setSelection(null)
    setError(null)
    setOpening(false)
    onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    const handleKeyDown = event => {
      if (event.key === 'Escape') closeDialog()
    }
    const handleOpened = () => closeDialog()
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('storyboard:notebook-opened', handleOpened)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('storyboard:notebook-opened', handleOpened)
    }
  }, [open, closeDialog])

  if (!open) return null

  function acceptSelection(next) {
    setError(null)
    setSelection(next)
  }

  async function selectFolder() {
    setError(null)
    try {
      const folderPath = await selectNotebookDirectory()
      devlog('Core directory picker returned', { hasPath: Boolean(folderPath) })
      if (folderPath) acceptSelection(selectionFromPath(folderPath))
    } catch (failure) {
      devlog('Core directory picker failed', { name: failure?.name, message: failure?.message })
      setError(errorMessage(failure, 'The folder picker could not be opened.'))
    }
  }

  function stageDroppedNotebook(folderPath) {
    devlog('drop received', { folderPath })
    acceptSelection(selectionFromPath(folderPath))
  }

  function handleDropFiles(drop) {
    devlog('drop payload', { paths: drop?.paths, fileCount: drop?.files?.length, hasEvent: Boolean(drop?.event) })
    const folderPath = drop?.paths?.[0]
    if (folderPath) {
      stageDroppedNotebook(folderPath)
      return
    }
    // Finder folder drops expose a directory entry but often omit its contents
    // from FileList. Prefer the entry so we do not report a valid Notebook
    // manifest as missing merely because the browser did not enumerate it.
    const entry = drop?.event?.dataTransfer?.items?.[0]?.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      acceptSelection({ name: entry.name, fileCount: null, hasManifest: null, files: [], path: null })
      return
    }
    const next = selectionFromFiles(drop?.event?.dataTransfer?.files || drop?.files)
    if (next.fileCount > 0) {
      acceptSelection(next)
      return
    }

    setError('Drop a Notebook folder containing hypercanvas.notebook.json.')
  }

  async function openNotebook() {
    devlog('open Notebook clicked', { selection })
    if (!selection) {
      setError('Choose or drop a Notebook folder first.')
      return
    }
    if (selection.hasManifest === false) {
      setError('This folder does not contain hypercanvas.notebook.json.')
      return
    }

    setOpening(true)
    setError(null)
    try {
      const selected = { ...selection }
      if (selected.hasManifest === false) {
        setError('This folder does not contain hypercanvas.notebook.json.')
        return
      }
      setSelection(selected)
      let notebookPath = selected.path
      if (!notebookPath) {
        notebookPath = await selectNotebookDirectory()
        if (!notebookPath) {
          setError('Select the dropped Notebook folder through Core to continue.')
          return
        }
      }
      await validateDirectory(notebookPath)
      devlog('opening selected Notebook', { hasPath: Boolean(notebookPath) })
      await openNotebookPath(notebookPath)
      closeDialog()
    } catch (failure) {
      devlog('selected Notebook open failed', { message: failure?.message, failure })
      setError(errorMessage(failure, 'The Notebook could not be opened.'))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className={css.backdrop} role="presentation" onMouseDown={event => event.target === event.currentTarget && closeDialog()}>
      <section className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="notebook-dialog-title">
        <header className={css.header}>
          <div>
            <p className={css.eyebrow}>Notebook</p>
            <h2 id="notebook-dialog-title">Add a Notebook</h2>
            <p className={css.description}>Open an existing Notebook or initialize an empty folder in place. Hypercanvas never copies its application into your Notebook.</p>
          </div>
          <button ref={closeRef} className={css.closeButton} type="button" aria-label="Close" onClick={closeDialog}>
            <XIcon size={18} />
          </button>
        </header>

        <DropZone
          as="button"
          type="button"
          className={css.dropzone}
          activeClassName={css.dropzoneActive}
          onClick={selectFolder}
          onDrop={handleDropFiles}
        >
          {({ isOver }) => (
            <>
              <span className={css.dropIcon}><FileDirectoryIcon size={24} /></span>
              <strong>{isOver ? 'Drop the Notebook here' : 'Drag and drop a Notebook folder'}</strong>
              <span>or click to choose a folder from your computer</span>
            </>
          )}
        </DropZone>
        {selection && (
          <div className={css.selection}>
            <FileDirectoryIcon size={18} />
            <div>
              <strong>{selection.name}</strong>
              <span>{selection.hasManifest === false ? 'Notebook manifest not found' : selection.fileCount === null ? 'Folder selected' : `${selection.fileCount} file${selection.fileCount === 1 ? '' : 's'} detected`}</span>
              {!selection.path && <span>Confirm its location in Core’s folder picker to open it.</span>}
            </div>
            {selection.hasManifest === true && <span className={css.valid}>Ready</span>}
          </div>
        )}

{/*
        {sites.length > 0 && (
          <section className={css.sites} aria-labelledby="notebook-sites-title">
            <div className={css.sitesHeader}>
              <strong id="notebook-sites-title">Sites</strong>
              <span>{sites.length} available</span>
            </div>
            {sites.map(site => {
              const running = site.binding?.status === 'running'
              return (
                <div className={css.siteRow} key={site.id}>
              <div><strong>{site.title || site.id}</strong><span>{running ? 'Running' : site.binding?.status || 'Stopped'}</span></div>
              <button type="button" onClick={() => updateSite(site, running ? 'stop' : 'start').catch(failure => {
                notifySiteFailed(site.id)
                setError(errorMessage(failure, `Could not ${running ? 'stop' : 'start'} site`))
              })}>{running ? 'Stop' : 'Start'}</button>
                </div>
              )
            })}
          </section>
        )}
*/}

        {error && <p className={css.error} role="alert">{error}</p>}
        <footer className={css.footer}>
          <DirectoryPicker label="Select folder" value={selection?.path} onChange={path => acceptSelection(selectionFromPath(path))} onError={setError} />
          <button className={css.primaryButton} type="button" disabled={!selection || opening} onClick={openNotebook}>
            {opening ? 'Opening…' : 'Add Notebook'}
          </button>
        </footer>
      </section>
    </div>
  )
}
