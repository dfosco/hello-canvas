import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Dialog from '../Dialog.jsx'
import Icon from '../Icon.jsx'
import SiteForm from '../SiteForm/SiteForm.jsx'
import { storyboardWs } from '../storyboard-ws.js'
import { sitePreviewPath } from '../../core/site/contract.js'
import { notifySiteStarted } from '../../core/site/siteEvents.js'
import { formatSiteTerminalOutput } from '../../core/site/terminal-output.js'
import { observeSiteFrameRoute, siteViewerPath } from '../siteFrameRouteBridge.js'
import css from './SitePage.module.css'

const MIN_TERMINAL_OUTPUT_HEIGHT = 96
const DEFAULT_TERMINAL_OUTPUT_HEIGHT = 220
const AUTO_START_TIMEOUT_MS = 30000
const MAX_STARTING_POLLS = 40
const STARTING_POLL_MS = 1000

function getMaxTerminalOutputHeight() {
  const viewportHeight = typeof window === 'undefined' ? 1200 : window.innerHeight
  return Math.max(MIN_TERMINAL_OUTPUT_HEIGHT, Math.floor(viewportHeight * 0.6))
}

function clampTerminalOutputHeight(height) {
  return Math.min(getMaxTerminalOutputHeight(), Math.max(MIN_TERMINAL_OUTPUT_HEIGHT, height))
}

/** App-owned shell around a managed Site; the external document stays in its iframe. */
export default function SitePage({ basePath = '/' }) {
  const [params, setParams] = useSearchParams()
  const { siteId, '*': siteRoute } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = siteId || params.get('id') || ''
  const terminalQuery = params.get('terminal') === 'true'
  const terminalPreferenceKey = `${id}:${params.get('terminal') || ''}`
  const routeParams = new URLSearchParams(location.search)
  routeParams.delete('edit')
  routeParams.delete('rebind')
  routeParams.delete('terminal')
  const route = siteId ? `${siteRoute || ''}${routeParams.size ? `?${routeParams}` : ''}${location.hash}` : ''
  const [site, setSite] = useState(null)
  const [error, setError] = useState('')
  const editing = params.get('edit') === 'true' ? 'edit' : params.get('rebind') === 'true' ? 'rebind' : null
  const [reloadToken, setReloadToken] = useState(0)
  const [autoStarting, setAutoStarting] = useState(false)
  const autoStartAttempted = useRef(null)
  const [terminalOutput, setTerminalOutput] = useState([])
  const [terminalPreference, setTerminalPreference] = useState(() => ({ key: terminalPreferenceKey, open: terminalQuery }))
  const showTerminalOutput = terminalPreference.key === terminalPreferenceKey ? terminalPreference.open : terminalQuery
  const [terminalOutputHeight, setTerminalOutputHeight] = useState(() => clampTerminalOutputHeight(DEFAULT_TERMINAL_OUTPUT_HEIGHT))
  const terminalResizeStart = useRef(null)
  const frameRef = useRef(null)
  const frameRouteCleanup = useRef(null)
  const base = basePath.replace(/\/+$/, '')
  const current = site?.id === id ? site : null

  useEffect(() => {
    const clampToViewport = () => setTerminalOutputHeight(height => clampTerminalOutputHeight(height))
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    const response = await fetch(`${base}/_storyboard/site/${encodeURIComponent(id)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || 'Could not load Site')
    setSite(data.site)
    setError('')
  }, [base, id])

  useEffect(() => {
    let active = true
    if (!id) return undefined
    fetch(`${base}/_storyboard/site/${encodeURIComponent(id)}`)
      .then(response => response.json().then(data => { if (!response.ok) throw new Error(data?.error || 'Could not load Site'); return data.site }))
      .then(value => { if (active) setSite(value) })
      .catch(cause => { if (active) setError(cause?.message || 'Could not load Site') })
    return () => { active = false }
  }, [base, id])

  const startableBinding = current?.binding?.source === 'managed'
    && Boolean(current?.binding?.startCommand)
    && !current?.missing

  // Opening a Site from the workspace starts its server; one attempt per
  // binding revision, retried only when the Site is opened again.
  useEffect(() => {
    if (!startableBinding || !['stopped', 'error'].includes(current.binding.status)) return undefined
    const attemptKey = `${id}:${current.binding.revision ?? ''}`
    if (autoStartAttempted.current === attemptKey) return undefined
    autoStartAttempted.current = attemptKey
    let active = true
    setAutoStarting(true)
    void (async () => {
      let failure = null
      try {
        const response = await fetch(`${base}/_storyboard/site/${encodeURIComponent(id)}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true, timeoutMs: AUTO_START_TIMEOUT_MS }),
        })
        const data = await response.json()
        if (!response.ok) failure = data?.code === 'SITE_START_CANCELLED' ? null : (data?.error || 'Could not start Site')
        else notifySiteStarted(id, data?.binding?.developmentBaseUrl)
      } catch (cause) {
        failure = cause?.message || 'Could not start Site'
      } finally {
        if (active) {
          setAutoStarting(false)
          // Refresh first: load() clears the error state, and the start
          // failure has to outlive it.
          try { await load() } catch { /* keep the start failure visible */ }
          if (failure) {
            setTerminalPreference({ key: terminalPreferenceKey, open: true })
            setError(failure)
          }
        }
      }
    })()
    return () => { active = false }
  }, [base, current, id, load, startableBinding, terminalPreferenceKey])

  // A start already in flight (another tab, or a reload mid-start) still has
  // to land on the running preview, so poll until it resolves.
  useEffect(() => {
    if (current?.binding?.status !== 'starting') return undefined
    let cancelled = false
    let timer = null
    let polls = 0
    const tick = async () => {
      polls += 1
      if (cancelled || polls > MAX_STARTING_POLLS) return
      try {
        const response = await fetch(`${base}/_storyboard/site/${encodeURIComponent(id)}`)
        const data = await response.json()
        if (!cancelled && response.ok && data?.site) setSite(data.site)
      } catch { /* retry on the next poll */ }
      if (!cancelled) timer = setTimeout(tick, STARTING_POLL_MS)
    }
    timer = setTimeout(tick, STARTING_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [base, current?.binding?.status, id])

  useEffect(() => {
    const refresh = () => { load().catch(cause => setError(cause?.message || 'Could not refresh Site')) }
    const started = event => {
      if (event.detail?.siteId !== id) return
      load()
        .then(() => setReloadToken(token => token + 1))
        .catch(cause => setError(cause?.message || 'Could not refresh Site'))
    }
    document.addEventListener('storyboard:sites-changed', refresh)
    document.addEventListener('storyboard:site-started', started)
    return () => {
      document.removeEventListener('storyboard:sites-changed', refresh)
      document.removeEventListener('storyboard:site-started', started)
    }
  }, [id, load])

  useEffect(() => {
    const toggleTerminal = event => {
      if (event.detail?.siteId !== id) return
      setTerminalPreference({ key: terminalPreferenceKey, open: !showTerminalOutput })
    }
    document.addEventListener('storyboard:site-terminal-toggle', toggleTerminal)
    return () => document.removeEventListener('storyboard:site-terminal-toggle', toggleTerminal)
  }, [id, showTerminalOutput, terminalPreferenceKey])

  useEffect(() => {
    if (!id) return
    document.dispatchEvent(new CustomEvent('storyboard:site-terminal-state', {
      detail: { siteId: id, open: showTerminalOutput },
    }))
  }, [id, location.pathname, location.search, location.hash, showTerminalOutput])

  useEffect(() => {
    const removed = event => {
      if (event.detail?.siteId !== id) return
      const base = basePath.replace(/\/+$/, '')
      navigate(`${base}/workspace?section=sites`)
    }
    document.addEventListener('storyboard:site-removed', removed)
    return () => document.removeEventListener('storyboard:site-removed', removed)
  }, [basePath, id, navigate])

  useEffect(() => {
    const failed = data => {
      if (data?.siteId !== id) return
      setTerminalPreference({ key: terminalPreferenceKey, open: true })
      setError('Site process failed; see terminal output.')
    }
    storyboardWs.on('storyboard:site-failed', failed)
    return () => storyboardWs.off('storyboard:site-failed', failed)
  }, [id, terminalPreferenceKey])

  useEffect(() => {
    if (!id || !showTerminalOutput) return undefined
    let active = true
    const refreshLogs = async () => {
      try {
        const response = await fetch(`${base}/_storyboard/site/${encodeURIComponent(id)}/logs`)
        const data = await response.json()
        if (active && response.ok) setTerminalOutput(Array.isArray(data?.logs) ? data.logs : [])
      } catch { /* retry on the next poll */ }
    }
    void refreshLogs()
    const timer = setInterval(refreshLogs, 500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [base, id, showTerminalOutput])

  const runningUrl = current?.binding?.status === 'running' && current.binding?.developmentBaseUrl
    ? sitePreviewPath(basePath, id, route)
    : null

  const handleFrameLoad = useCallback(() => {
    frameRouteCleanup.current?.()
    frameRouteCleanup.current = observeSiteFrameRoute(frameRef.current, {
      siteId: id,
      basePath,
      onRouteChange: (nextRoute, { replace } = {}) => {
        if (nextRoute === route) return
        navigate(siteViewerPath(basePath, id, nextRoute), { replace })
      },
    })
  }, [basePath, id, navigate, route])

  useEffect(() => () => frameRouteCleanup.current?.(), [])
  function closeEditor() {
    const next = new URLSearchParams(params)
    next.delete('edit')
    next.delete('rebind')
    setParams(next, { replace: true })
  }

  function startTerminalOutputResize(event) {
    event.preventDefault()
    terminalResizeStart.current = { clientY: event.clientY, height: terminalOutputHeight }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function moveTerminalOutputResize(event) {
    const start = terminalResizeStart.current
    if (!start) return
    setTerminalOutputHeight(clampTerminalOutputHeight(start.height + start.clientY - event.clientY))
  }

  function finishTerminalOutputResize() {
    terminalResizeStart.current = null
  }

  function handleTerminalOutputResizeKeyDown(event) {
    let nextHeight
    if (event.key === 'ArrowUp') nextHeight = terminalOutputHeight + 16
    else if (event.key === 'ArrowDown') nextHeight = terminalOutputHeight - 16
    else if (event.key === 'Home') nextHeight = MIN_TERMINAL_OUTPUT_HEIGHT
    else if (event.key === 'End') nextHeight = getMaxTerminalOutputHeight()
    else return
    event.preventDefault()
    setTerminalOutputHeight(clampTerminalOutputHeight(nextHeight))
  }

  const starting = autoStarting || current?.binding?.status === 'starting'

  return (
    <main className={css.page}>
      <header className={css.toolbar}>
        <div className={css.siteIdentity}>
          <Link to={basePath} className={css.homeLink} aria-label="Go to homepage">
            <Icon name="home" size={16} color="#fff" />
          </Link>
          <h1>{current?.title || id || 'Site'}</h1>
          {current && (current.missing || current.binding?.status !== 'running') && <span className={current.missing ? css.statusMissing : css.status} role="status">
            {current.missing ? 'Folder missing' : starting ? 'starting' : current.binding?.status || 'Stopped'}
          </span>}
        </div>
      </header>
      {runningUrl ? <iframe ref={frameRef} key={reloadToken} className={css.frame} title={current.title || id} src={runningUrl} onLoad={handleFrameLoad} /> : (
        <section className={css.empty}>
          <h2>{current?.missing ? 'Site folder is missing' : !current ? 'Site unavailable' : starting ? 'Site is starting' : current.binding?.status === 'error' ? 'Site failed to start' : 'Site is stopped'}</h2>
          {current?.missing && <p>Rebind this Site to its folder to restore the preview.</p>}
          {!current?.missing && current && starting && <p>Waiting for the Site preview to become ready…</p>}
          {!current?.missing && current && !starting && current.binding?.status === 'error' && <p>See the terminal output for details.</p>}
          {!current?.missing && current && !starting && current.binding?.status !== 'error' && <p>Start the Site to open its live preview.</p>}
        </section>
      )}
      {showTerminalOutput && <>
        <div
          className={css.terminalResizeHandle}
          role="separator"
          aria-label="Resize terminal output"
          aria-orientation="horizontal"
          aria-controls="site-terminal-output"
          aria-valuemin={MIN_TERMINAL_OUTPUT_HEIGHT}
          aria-valuemax={getMaxTerminalOutputHeight()}
          aria-valuenow={terminalOutputHeight}
          tabIndex={0}
          onKeyDown={handleTerminalOutputResizeKeyDown}
          onPointerDown={startTerminalOutputResize}
          onPointerMove={moveTerminalOutputResize}
          onPointerUp={finishTerminalOutputResize}
          onPointerCancel={finishTerminalOutputResize}
          onLostPointerCapture={finishTerminalOutputResize}
        />
        <section
          id="site-terminal-output"
          className={css.terminalOutput}
          style={{ height: `${terminalOutputHeight}px` }}
          aria-label="Site terminal output"
          aria-live="polite"
        >
          <pre>{formatSiteTerminalOutput(terminalOutput) || 'Waiting for terminal output…'}</pre>
        </section>
      </>}
      {editing && current && <Dialog
        title={editing === 'edit' ? 'Edit Site metadata' : 'Rebind directory'}
        subtitle={editing === 'edit' ? 'Update the Site name, URLs, run command, and description.' : 'Select the Site’s new folder and review its detected local URL and run command.'}
        onClose={closeEditor}
        width="large"
      >
        <SiteForm site={current} mode={editing} basePath={basePath} onClose={closeEditor} onSaved={next => {
          setSite({ ...next, missing: false })
          closeEditor()
        }} />
      </Dialog>}
      {error && <p className={css.error} role="alert">{error}</p>}
    </main>
  )
}
