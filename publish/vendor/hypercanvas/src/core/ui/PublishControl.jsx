import { useCallback, useEffect, useState } from 'react'
import { Button } from '../lib/components/ui/button/index.js'
import { TriggerButton } from '../lib/components/ui/trigger-button/index.js'
import Icon from './Icon.jsx'
import css from './PublishControl.module.css'
import { sidePanelState, togglePanel } from '../stores/sidePanelStore.js'
import { formatSiteTerminalOutput } from '../site/terminal-output.js'

const STATUS_POLL_MS = 1200

async function request(path, { body, method = 'POST' } = {}) {
  const response = await fetch(`${import.meta.env.BASE_URL}_storyboard/publishing${path}`, {
    method,
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) } : {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = data.error || {}
    throw Object.assign(new Error(error.message || 'Publishing request failed'), error)
  }
  return data
}

function OperationSummary({ operation, onRetry }) {
  if (!operation) return null
  const succeeded = operation.status === 'succeeded'
  const active = operation.status === 'running'
  const paused = operation.status === 'awaiting_retry'
  return (
    <section className={css.operation} aria-live="polite">
      <div className={css.operationHeading}>
        <strong>{active ? 'Publishing…' : succeeded ? 'Publish pushed' : paused ? 'Action needed' : 'Publish failed'}</strong>
        <span className={css.operationState}>{operation.status}</span>
      </div>
      <ol className={css.steps}>
        {(operation.steps || []).map((step, index) => (
          <li key={`${step.name}-${index}`} data-status={step.status}>
            <span aria-hidden="true">{step.status === 'succeeded' ? '✓' : step.status === 'failed' ? '!' : '·'}</span>
            {step.name.replaceAll('-', ' ')}
          </li>
        ))}
      </ol>
      {operation.error && (
        <div className={css.error} role="alert">
          <strong>{operation.error.message}</strong>
          {operation.error.hint && <p>{operation.error.hint}</p>}
        </div>
      )}
      <section className={css.terminal} aria-label="Publish terminal output" aria-live="polite">
        <div className={css.terminalTitle}>Terminal · Publish recovery</div>
        <pre>{formatSiteTerminalOutput((operation.output || []).map(message => ({ message }))) || (active ? 'Waiting for terminal output…' : 'No Git output was recorded.')}</pre>
      </section>
      {operation.result?.warnings?.length > 0 && (
        <div className={css.warning} role="status">
          <strong>Published with notes</strong>
          <ul>{operation.result.warnings.map((warning, index) => <li key={`${warning.widgetId || 'frame'}-${index}`}>{warning.message}</li>)}</ul>
        </div>
      )}
      {succeeded && operation.result && (
        <div className={css.result}>
          <p>Push confirmed to {operation.result.repository?.owner}/{operation.result.repository?.name}.</p>
          <div className={css.links}>
            {operation.result.repoUrl && <a href={operation.result.repoUrl} target="_blank" rel="noreferrer">Repository</a>}
            {operation.result.pagesUrl && <a href={operation.result.pagesUrl} target="_blank" rel="noreferrer">Pages site</a>}
            {operation.result.runUrl && <a href={operation.result.runUrl} target="_blank" rel="noreferrer">Actions run</a>}
          </div>
        </div>
      )}
      {!active && !succeeded && operation.id && (
        <Button type="button" onClick={() => onRetry(operation.id)}>Retry publish</Button>
      )}
    </section>
  )
}

/** Publish action rendered by the command toolbar and its mirrored surfaces. */
export default function PublishControl({ config = {}, tabIndex }) {
  const [panel, setPanel] = useState({ open: false, activeTab: 'inspector' })
  const open = panel.open && panel.activeTab === 'publish'

  useEffect(() => sidePanelState.subscribe(setPanel), [])

  return (
    <TriggerButton
      active={open}
      size={config.size || 'icon-xl'}
      aria-label={config.ariaLabel || 'Publish'}
      aria-expanded={open}
      tabIndex={tabIndex}
      onClick={() => togglePanel('publish')}
    >
      <Icon name="iconoir/upload-square" size={20} {...(config.meta || {})} />
    </TriggerButton>
  )
}

/** Publish settings and operation recovery content hosted by the shared SidePanel. */
export function PublishPanel() {
  const [mode, setMode] = useState('default')
  const [destination, setDestination] = useState('')
  const [repositoryMode, setRepositoryMode] = useState('create')
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState('public')
  const [branch, setBranch] = useState('main')
  const [auth, setAuth] = useState(null)
  const [operation, setOperation] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const status = await request('/status', { method: 'GET' })
      setAuth(status.auth || null)
      const latest = (status.operations || []).find((item) => item.kind === 'publish')
      if (latest) setOperation((current) => !current || latest.startedAt >= current.startedAt ? latest : current)
    } catch (failure) {
      setError(failure.message)
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    const timer = window.setInterval(refreshStatus, STATUS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refreshStatus])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setOperation(null)
    try {
      const result = await request('/publish', {
        body: {
          mode,
          ...(mode === 'external' ? { destination: destination.trim() } : {}),
          repositoryMode,
          owner: owner.trim(),
          name: name.trim(),
          visibility,
          branch: branch.trim() || 'main',
        },
      })
      setOperation(result)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
      refreshStatus()
    }
  }

  async function retry(operationId) {
    setBusy(true)
    setError(null)
    try {
      setOperation(await request('/retry', { body: { operationId } }))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
      refreshStatus()
    }
  }

  return (
    <div className={css.publishPanel}>
      <p className={css.description}>Publish a portable, self-contained site to GitHub Pages. The site is built locally; Actions deploys the committed build.</p>
      {auth && (
        <p className={auth.authenticated ? css.authOk : css.authWarning}>
          {auth.authenticated ? `GitHub: ${auth.account}` : auth.hint || 'GitHub CLI authentication required.'}
        </p>
      )}
      <form className={css.form} onSubmit={submit}>
        <label>Publish
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="external">Published folder (static site)</option>
            <option value="default">Notebook folder (also includes source files)</option>
          </select>
        </label>
        {mode === 'external' && (
          <label>Published folder location
            <input required value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="/Users/me/notebook-site" />
          </label>
        )}
        <div className={css.tabs} role="group" aria-label="Repository operation">
          <button type="button" className={repositoryMode === 'create' ? css.active : ''} onClick={() => setRepositoryMode('create')}>Create repository</button>
          <button type="button" className={repositoryMode === 'connect' ? css.active : ''} onClick={() => setRepositoryMode('connect')}>Connect existing</button>
        </div>
        <label>GitHub owner<input required value={owner} onChange={(event) => setOwner(event.target.value)} placeholder={auth?.account || 'username or organization'} /></label>
        <label>Repository name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="my-notebook-site" /></label>
        {repositoryMode === 'create' && (
          <label>Repository visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="public">Public (required for public Pages)</option><option value="private">Private source repository</option></select></label>
        )}
        <label>Branch<input required value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !auth?.authenticated}>
          {busy ? 'Publishing…' : repositoryMode === 'create' ? 'Create and publish' : 'Connect and publish'}
        </Button>
      </form>
      {error && <output className={css.error} role="alert">{error}</output>}
      <OperationSummary operation={operation} onRetry={retry} />
    </div>
  )
}
