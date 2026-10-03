import { useEffect, useRef, useState } from 'react'
import { PlusIcon, StackIcon } from '@primer/octicons-react'
import { invoke, isTauriAvailable } from '../../core/notebook/tauri-bridge.js'
import { coreRequestJson, openNotebookPath as openNotebookViaCore } from '../../core/notebook/browserBridge.js'
import NotebookDialog from '../NotebookDialog/NotebookDialog.jsx'
import css from './NotebookGate.module.css'

const POLL_INTERVAL_MS = 2000

function folderName(root) {
  return String(root || '').split(/[\\/]/).filter(Boolean).pop() || 'Notebook'
}

/**
 * Blocking Notebook recovery and selection surface for the browser and desktop.
 *
 * When the active Notebook folder is removed, moved, or renamed — or when the
 * app starts with no Notebook pointer — this surface stays open until the user
 * selects an available Notebook or chooses a folder through Core.
 */
export default function NotebookGate() {
  const browserCoreMode = typeof window !== 'undefined' && window.__HYPERCANVAS_CORE_MODE__ === true
  const enabledRef = useRef(
    typeof window !== 'undefined'
      && (isTauriAvailable() || browserCoreMode)
      && !new URLSearchParams(window.location.search).has('_sb_embed'),
  )
  const [gate, setGate] = useState(null)
  const [notebooks, setNotebooks] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState(null)
  const [openingPath, setOpeningPath] = useState(null)

  useEffect(() => {
    if (!enabledRef.current) return undefined
    let cancelled = false
    const refresh = async () => {
      try {
        const status = await coreRequestJson('/_storyboard/notebook-runtime/status', { cache: 'no-store' })
        let saved
        if (browserCoreMode) {
          const recent = await coreRequestJson('/_storyboard/notebook-runtime/recent', { cache: 'no-store' })
          saved = (Array.isArray(recent?.notebooks) ? recent.notebooks : []).map(entry => ({
            name: entry?.title || folderName(entry?.root),
            path: entry?.root,
            available: entry?.available !== false,
          })).filter(entry => typeof entry.path === 'string')
        } else {
          saved = await invoke('list_notebooks')
        }
        if (cancelled) return
        if (Array.isArray(saved)) setNotebooks(saved)
        setError(null)
        const availability = status.availability || {}
        const next = status.active && availability.available !== false
          ? null
          : status.active
            ? {
                key: `unavailable:${availability.reason}:${availability.movedTo || ''}`,
                banner: availability.reason === 'moved' && availability.movedTo
                  ? `The notebook folder “${folderName(status.root)}” was moved or renamed. It looks like it now lives at ${availability.movedTo}.`
                  : `The notebook folder “${folderName(status.root)}” was removed or renamed.`,
                movedTo: availability.reason === 'moved' ? availability.movedTo : null,
                startedWithoutNotebook: false,
              }
            : {
                key: `no-notebook:${status.notice || ''}`,
                banner: status.notice || null,
                movedTo: null,
                startedWithoutNotebook: true,
              }
        setGate(current => (current?.key === next?.key ? current : next))
      } catch {
        if (cancelled) return
        setError('Could not connect to Hypercanvas Core. Check that the app is running, then retry.')
        setGate(current => current || {
          key: 'core-unavailable',
          banner: 'Hypercanvas Core is unavailable. Keep the app running while using this browser.',
          movedTo: null,
          startedWithoutNotebook: true,
        })
      }
    }
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [browserCoreMode])

  async function openNotebookPath(notebookPath) {
    if (!notebookPath) return
    setError(null)
    setOpeningPath(notebookPath)
    try {
      await openNotebookViaCore(notebookPath)
      setGate(null)
    } catch (failure) {
      setError(failure?.message || 'The Notebook could not be opened.')
    } finally {
      setOpeningPath(null)
    }
  }

  if (!enabledRef.current || !gate) return null

  return (
    <div className={css.backdrop} role="presentation">
      {gate.banner && (
        <div className={css.banner} role="status">{gate.banner}</div>
      )}
      <section className={css.modal} role="dialog" aria-modal="true" aria-labelledby="notebook-gate-title">
        <h2 id="notebook-gate-title">Choose a notebook</h2>
        <p className={css.text}>
          {gate.startedWithoutNotebook
            ? 'No notebook is open. Choose a notebook below or create a new one to continue.'
            : 'This view stays open until you choose another notebook or create a new one.'}
        </p>
        {gate.movedTo && (
          <button
            type="button"
            className={css.primaryAction}
            disabled={openingPath === gate.movedTo}
            onClick={() => openNotebookPath(gate.movedTo)}
          >
            {openingPath === gate.movedTo ? 'Opening…' : `Open “${folderName(gate.movedTo)}”`}
          </button>
        )}
        {notebooks.length > 0 && (
          <div className={css.list}>
            {notebooks.map(notebook => (
              <button
                key={notebook.path}
                type="button"
                className={css.row}
                disabled={openingPath === notebook.path || notebook.available === false}
                onClick={() => openNotebookPath(notebook.path)}
              >
                <StackIcon size={14} />
                <span className={css.rowLabel}>{notebook.name || notebook.path}{notebook.available === false ? ' — Folder missing' : ''}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className={css.add} onClick={() => setDialogOpen(true)}>
          <PlusIcon size={14} /> Add notebook…
        </button>
        {error && <p className={css.error} role="alert">{error}</p>}
      </section>
      <NotebookDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
