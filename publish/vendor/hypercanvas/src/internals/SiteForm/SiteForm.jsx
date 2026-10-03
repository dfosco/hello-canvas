import { useRef, useState } from 'react'
import DirectoryPicker, { directoryName, validateDirectory } from '../DirectoryPicker/DirectoryPicker.jsx'
import css from './SiteForm.module.css'

function titleFromDirectory(directory) {
  return directoryName(directory).replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

export default function SiteForm({ basePath = '/', site = null, initialValues = {}, mode = site ? 'edit' : 'create', onClose, onSaved }) {
  const [root, setRoot] = useState('')
  const [title, setTitle] = useState(initialValues.title || site?.title || '')
  const [command, setCommand] = useState(site?.binding?.startCommand || 'npm run dev')
  const [developmentBaseUrl, setDevelopmentBaseUrl] = useState(initialValues.developmentBaseUrl || site?.binding?.developmentBaseUrl || '')
  const [productionBaseUrl, setProductionBaseUrl] = useState(site?.deployments?.production?.baseUrl || '')
  const [description, setDescription] = useState(site?.description || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const commandEdited = useRef(false)
  const localUrlEdited = useRef(false)
  const titleEdited = useRef(false)
  const selectionVersion = useRef(0)
  const base = basePath.replace(/\/+$/, '')
  const hasDirectorySource = Boolean(root)

  async function choose(directory, { validate = false } = {}) {
    const version = ++selectionVersion.current
    setError('')
    if (mode === 'create' && !titleEdited.current && !initialValues.title) setTitle(titleFromDirectory(directory))
    commandEdited.current = false
    localUrlEdited.current = false
    setCommand('npm run dev')
    if (mode !== 'create' || !initialValues.developmentBaseUrl) setDevelopmentBaseUrl('')
    setDetecting(true)
    try {
      if (validate) await validateDirectory(directory, { excludeSiteId: site?.id })
      if (version !== selectionVersion.current) return
      setRoot(directory)
      if (mode === 'create' && !titleEdited.current && !initialValues.title) setTitle(titleFromDirectory(directory))
      commandEdited.current = false
      setCommand('npm run dev')
      const response = await fetch(`${base}/_storyboard/site/detect?root=${encodeURIComponent(directory)}`)
      if (!response.ok) throw new Error((await response.json())?.error || 'Could not inspect directory')
      const data = await response.json()
      const findings = data?.detection?.findings || []
      if (version === selectionVersion.current && !commandEdited.current) setCommand(findings.find(item => item.kind === 'start-command')?.value || 'npm run dev')
      const detectedLocalUrl = findings.find(item => item.kind === 'local-url')?.value
      if (version === selectionVersion.current && !localUrlEdited.current && detectedLocalUrl) setDevelopmentBaseUrl(detectedLocalUrl)
    } catch (cause) {
      if (version === selectionVersion.current) setError(cause?.message || 'Could not inspect directory')
    } finally {
      if (version === selectionVersion.current) setDetecting(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if ((mode !== 'edit' && !hasDirectorySource) || (mode !== 'rebind' && !title.trim())) {
      setError('Site name and directory are required')
      return
    }
    setBusy(true)
    setError('')
    try {
      const values = {
        title: title.trim(),
        description,
        developmentBaseUrl,
        productionBaseUrl,
        startCommand: command.trim() || 'npm run dev',
      }
      const createBody = { root, ...values }
      const response = await fetch(`${base}/_storyboard/site/${site ? `${encodeURIComponent(site.id)}/metadata` : 'create'}`, {
        method: mode === 'edit' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'edit'
          ? { ...values, startCommand: command.trim() }
          : createBody),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not save Site')
      document.dispatchEvent(new CustomEvent('storyboard:sites-changed'))
      onSaved?.(data.site)
    } catch (cause) {
      setError(cause?.message || 'Could not save Site')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={css.form} onSubmit={submit}>
      {mode === 'edit'
        ? <div className={css.directory}><span>Directory</span><span>{site?.binding?.root || 'No directory bound'}</span></div>
        : <div className={css.directory}><span>Directory *</span><DirectoryPicker label={mode === 'create' ? 'Choose external folder' : 'Choose directory'} value={root} onChange={choose} onError={setError} excludeSiteId={site?.id} grantPurpose="site" /></div>}
      {mode !== 'rebind' && <label>Site name * <input value={title} onChange={event => { titleEdited.current = true; setTitle(event.target.value) }} required /></label>}
      <label>Local URL <input type="url" value={developmentBaseUrl} onChange={event => { localUrlEdited.current = true; setDevelopmentBaseUrl(event.target.value) }} placeholder="http://localhost:5173/" /></label>
      <label>Run command <input value={command} onChange={event => { commandEdited.current = true; setCommand(event.target.value) }} /></label>
      <label>Deploy URL <input type="url" value={productionBaseUrl} onChange={event => setProductionBaseUrl(event.target.value)} placeholder="https://example.com/" /></label>
      <label>Description <textarea rows="3" value={description} onChange={event => setDescription(event.target.value)} /></label>
      {error && <p role="alert" className={css.error}>{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || detecting || (mode !== 'edit' && !hasDirectorySource)}>{busy ? 'Saving…' : mode === 'rebind' ? 'Rebind directory' : mode === 'edit' ? 'Save Site' : 'Create Site'}</button></footer>
    </form>
  )
}
