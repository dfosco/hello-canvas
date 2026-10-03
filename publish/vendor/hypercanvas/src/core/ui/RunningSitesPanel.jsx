import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, useInRouterContext } from 'react-router-dom'
import Icon from './Icon.jsx'
import SiteEditMenu from './SiteEditMenu.jsx'
import { notifySiteFailed, notifySiteStarted } from '../site/siteEvents.js'
import { siteViewerPath } from '../../internals/siteFrameRouteBridge.js'
import { sbNavigate } from '../navigation/sbNavigate.js'
import { isLocalDev } from '../utils/prodMode.js'

function apiUrl(basePath, route) {
  const base = (basePath || '/').replace(/\/+$/, '')
  return `${base}${route}`
}

function currentSiteId(basePath = '/') {
  if (typeof window === 'undefined') return ''
  const base = (basePath || '/').replace(/\/+$/, '')
  const prefix = base ? `${base}/` : '/'
  const pathname = window.location.pathname
  const route = pathname.startsWith(prefix) ? pathname.slice(base.length) : pathname
  const match = route.match(/^\/?sites\/([^/]+)(?:\/|$)/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

function currentRouteTerminalOpen() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('terminal') === 'true'
}

function navigateDetachedRouterLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const anchor = event.target?.closest?.('a[href]')
  if (!anchor || anchor.target || anchor.hasAttribute('download')) return

  const destination = new URL(anchor.href, window.location.href)
  if (destination.origin !== window.location.origin) return
  event.preventDefault()
  window.location.assign(destination.href)
}

export default function RunningSitesPanel({ basePath = '/' }) {
  const inRouter = useInRouterContext()
  const [sites, setSites] = useState([])
  const [busy, setBusy] = useState([])
  const [error, setError] = useState('')
  const [terminalState, setTerminalState] = useState(() => ({
    siteId: currentSiteId(basePath),
    open: currentRouteTerminalOpen(),
  }))
  const localMode = isLocalDev()

  const load = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(basePath, localMode ? '/_storyboard/site/list' : '/hypercanvas.sites.json'))
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Could not load Sites')
      setSites(Array.isArray(data?.sites) ? data.sites : [])
    } catch (cause) {
      setError(cause?.message || 'Could not load Sites')
    }
  }, [basePath, localMode])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const refresh = () => { void load() }
    document.addEventListener('storyboard:sites-changed', refresh)
    return () => document.removeEventListener('storyboard:sites-changed', refresh)
  }, [load])

  useEffect(() => {
    const updateTerminalState = event => {
      const { siteId, open } = event.detail || {}
      if (typeof siteId !== 'string' || typeof open !== 'boolean') return
      setTerminalState({ siteId, open })
    }
    document.addEventListener('storyboard:site-terminal-state', updateTerminalState)
    return () => document.removeEventListener('storyboard:site-terminal-state', updateTerminalState)
  }, [])

  async function mutate(site, operation) {
    const key = `${site.id}:${operation}`
    setBusy(current => [...current, key])
    setError('')
    let logPoll = null
    if (operation === 'start' || operation === 'restart') {
      const refresh = () => { void load() }
      refresh()
      logPoll = setInterval(refresh, 500)
    }
    try {
      const response = await fetch(apiUrl(basePath, `/_storyboard/site/${encodeURIComponent(site.id)}/${operation}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: operation === 'start' || operation === 'restart' ? JSON.stringify({ confirmed: true, timeoutMs: 10000 }) : undefined,
      })
      const data = await response.json()
      if (!response.ok) {
        const cause = new Error(data?.error || `Could not ${operation} Site`)
        cause.code = data?.code
        throw cause
      }
      if (operation === 'start') notifySiteStarted(site.id, data?.binding?.developmentBaseUrl)
      await load()
      return data?.binding?.developmentBaseUrl || null
    } catch (cause) {
      if (cause?.code === 'SITE_START_CANCELLED') {
        await load()
        return null
      }
      setError(cause?.message || `Could not ${operation} Site`)
      await load()
      notifySiteFailed(site.id)
      return null
    } finally {
      if (logPoll) clearInterval(logPoll)
      setBusy(current => current.filter(item => item !== key))
    }
  }

  function toggleTerminal(site) {
    if (currentSiteId(basePath) === site.id) {
      document.dispatchEvent(new CustomEvent('storyboard:site-terminal-toggle', { detail: { siteId: site.id } }))
      return
    }
    window.open(apiUrl(basePath, `/sites/${encodeURIComponent(site.id)}/?terminal=true`), '_blank', 'noopener,noreferrer')
  }

  async function copyUrl(site) {
    const url = site.binding?.developmentBaseUrl
    if (url) await navigator.clipboard?.writeText(url)
  }

  const panel = (
    <div className="sb-sites-panel" onClickCapture={!inRouter ? navigateDetachedRouterLink : undefined}>
      {error && <div className="sb-sites-error">{error}</div>}
      {sites.length === 0 && !error && <div className="sb-sites-empty">No Sites registered.</div>}
      {sites.map(site => {
        if (!localMode) {
          return (
            <section className="sb-site-item" key={site.id}>
              <div className="sb-site-item-header">
                <Icon name="iconoir/globe" size={16} />
                <strong>{site.title || site.id}</strong>
              </div>
              {site.description && <p className="sb-site-item-id">{site.description}</p>}
              <div className="sb-site-actions">
                {site.productionUrl
                  ? <a href={site.productionUrl} target="_blank" rel="noreferrer">Open production site</a>
                  : <span className="sb-sites-empty">No production URL configured</span>}
              </div>
            </section>
          )
        }
        const running = site.binding?.status === 'running'
        const starting = site.binding?.status === 'starting'
        // Opening a Site now starts its stopped server (SitePage auto-start),
        // so Switch is enabled for startable managed Sites too.
        const openable = running || (site.binding?.source === 'managed' && Boolean(site.binding?.startCommand) && !site.missing)
        const selectedSite = currentSiteId(basePath) === site.id
        const terminalOpen = selectedSite && terminalState.siteId === site.id
          ? terminalState.open
          : selectedSite && terminalState.siteId !== site.id && currentRouteTerminalOpen()
        return (
          <section className="sb-site-item" key={site.id}>
            <div className="sb-site-item-header">
              <Icon name="iconoir/globe" size={16} />
              <strong>{site.title || site.id}</strong>
              <span className={`sb-site-status sb-site-status--${site.binding?.status || 'stopped'}`}>{site.binding?.status || 'stopped'}</span>
            </div>
            <div className="sb-site-item-id">{site.id}</div>
            <div className="sb-site-actions">
              {running || starting
                ? <button type="button" onClick={() => mutate(site, 'stop')} disabled={busy.includes(`${site.id}:stop`)}>Stop</button>
                : <button type="button" onClick={() => mutate(site, 'start')} disabled={busy.includes(`${site.id}:start`)}>Start</button>}
              {selectedSite
                ? <button type="button" disabled>Active</button>
                : <button type="button" onClick={() => sbNavigate(siteViewerPath(basePath, site.id))} disabled={!openable}>Switch</button>}
              <button type="button" onClick={() => copyUrl(site)} disabled={!site.binding?.developmentBaseUrl}>Copy URL</button>
              <button type="button" onClick={() => toggleTerminal(site)} aria-pressed={terminalOpen}>
                {terminalOpen ? 'Close terminal' : 'Open terminal'}
              </button>
              <SiteEditMenu site={site} basePath={basePath} onRemoved={load} onError={setError} />
            </div>
          </section>
        )
      })}
    </div>
  )

  return inRouter ? panel : <BrowserRouter>{panel}</BrowserRouter>
}
