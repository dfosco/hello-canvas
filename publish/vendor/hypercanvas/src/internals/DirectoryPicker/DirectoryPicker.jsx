import { useState } from 'react'
import { coreRequestJson, selectNotebookDirectory } from '../../core/notebook/browserBridge.js'
import css from './DirectoryPicker.module.css'

export function directoryName(directory) {
  return String(directory || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
}

export async function validateDirectory(directory, { excludeSiteId } = {}) {
  const [notebookData, siteData] = await Promise.all([
    coreRequestJson('/_storyboard/notebook-runtime/recent'),
    coreRequestJson('/_storyboard/site/list'),
  ])
  const normalize = path => String(path || '').replace(/[\\/]+$/, '').toLowerCase()
  if (notebookData?.notebooks?.some(item => item.available !== false && normalize(item.root) === normalize(directory))) {
    throw new Error('This folder is already registered as a Notebook.')
  }
  if (siteData?.sites?.some(site => site.id !== excludeSiteId && normalize(site.binding?.root) === normalize(directory))) {
    throw new Error('This folder is already registered as a Site.')
  }
}

/** Select a native directory and check registrations before exposing its path. */
export default function DirectoryPicker({ value, onChange, onError, label = 'Select folder', excludeSiteId, grantPurpose = 'notebook' }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function select() {
    setError('')
    setBusy(true)
    try {
      const directory = await selectNotebookDirectory({ purpose: grantPurpose })
      if (!directory) return
      await validateDirectory(directory, { excludeSiteId })
      onChange(directory)
    } catch (cause) {
      const message = cause?.message || String(cause)
      setError(message)
      onError?.(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.picker}>
      <button type="button" onClick={select} disabled={busy}>{busy ? 'Selecting…' : label}</button>
      {value && <span title={value}>{directoryName(value)}</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
