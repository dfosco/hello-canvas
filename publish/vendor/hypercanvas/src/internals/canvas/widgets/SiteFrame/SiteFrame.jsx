import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { normalizeSiteRoute, sitePreviewPath } from '../../../../core/site/contract.js'
import { isLocalDev } from '../../../../core/utils/prodMode.js'
import { notifySiteStarted } from '../../../../core/site/siteEvents.js'
import { observeSiteFrameRoute, siteViewerPath } from '../../../siteFrameRouteBridge.js'
import { useFrameSnapshot } from '../useFrameSnapshot.js'
import WidgetWrapper from '../WidgetWrapper.jsx'
import ExpandedPane from '../ExpandedPane.jsx'
import { useOverride } from '../../../hooks/useOverride.js'
import { resolveBasePathAsset } from '../../../basePathAsset.js'
import { buildPaneForWidget, buildSplitLayout, findAllConnectedSplitTargets } from '../expandUtils.js'
import ResizeHandle from '../ResizeHandle.jsx'
import Icon from '../../../Icon.jsx'
import styles from './SiteFrame.module.css'

const DEFAULT_SIZE = { width: 800, height: 600 }
const START_TIMEOUT_MS = 30000

function publishedAssetUrl(file) {
  const base = import.meta.env.BASE_URL || '/'
  return (base.endsWith('/') ? base : base + '/') + String(file || '').replace(/^\/+/, '')
}

function publishedDescriptor(widgetId, siteId, route) {
  const pages = window.__HYPERCANVAS_NOTEBOOK_PUBLICATION__?.pages
  if (!Array.isArray(pages)) return null
  const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin).pathname.replace(/\/+$/, '')
  const currentPath = window.location.pathname.startsWith(base + '/')
    ? window.location.pathname.slice(base.length)
    : window.location.pathname
  const current = currentPath.replace(/\/+$/, '') || '/'
  const page = pages
    .filter(item => {
      if (!item?.route) return false
      const pageRoute = String(item.route).replace(/\/+$/, '') || '/'
      return current === pageRoute || (pageRoute !== '/' && current.startsWith(pageRoute + '/'))
    })
    .sort((left, right) => String(right.route || '').length - String(left.route || '').length)[0]
  const frames = page?.siteFrames
  if (!frames || typeof frames !== 'object') return null
  return frames[widgetId] || Object.values(frames).find(item => item?.siteId === siteId && (item?.route || '') === route) || null
}

const SiteFrame = forwardRef(function SiteFrame({ id: widgetId, props: widgetProps, selected = false, onUpdate, resizable }, ref) {
  const props = widgetProps || {}
  const siteId = typeof props.siteId === 'string' ? props.siteId : ''
  const route = typeof props.route === 'string' ? props.route : ''
  const width = positive(props.width, DEFAULT_SIZE.width)
  const height = positive(props.height, DEFAULT_SIZE.height)
  // Manual poster override (explicit snapshot prop) always wins and is never
  // overwritten by generated captures.
  const manualSnapshot = typeof props.snapshot === 'string' && props.snapshot ? props.snapshot : ''
  const manualSnapshotDark = typeof props.snapshotDark === 'string' && props.snapshotDark ? props.snapshotDark : ''
  // Published notebooks run without the local Core runtime: Site Frames are
  // permanently static poster-plus-production-link views there.
  const published = typeof window === 'undefined' || window.__SB_LOCAL_DEV__ !== true
  const exportedFrame = published ? publishedDescriptor(widgetId, siteId, route) : null
  const [error, setError] = useState('')
  const [siteList, setSiteList] = useState(null)
  // Local dev renders the external interact gate (WidgetChrome); activating it
  // admits interaction. Everywhere else there is no gate, so the frame is
  // admitted from the start (published views never reach the live viewport).
  const [admitted, setAdmitted] = useState(!isLocalDev())
  const [startingSite, setStartingSite] = useState(false)
  // Once admitted, the live document stays mounted for the session (matching
  // tiny-canvas): ending interaction only restores the guard overlay.
  // The poster stays visible until the live document has actually loaded, so
  // activation and reloads never blank the Frame.
  const [loadedSrc, setLoadedSrc] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const frameRef = useRef(null)
  const rootRef = useRef(null)
  const viewportRef = useRef(null)
  const [expandOverride, setExpandOverride, clearExpandOverride] = useOverride(`_site_expanded_${widgetId}`)
  const expandMode = ['single', 'split', 'immersive'].includes(expandOverride) ? expandOverride : null
  const frameRouteCleanup = useRef(null)
  const routeRef = useRef(route)

  const snapshotTarget = useMemo(() => (
    siteId && !published ? { kind: 'site', siteId, route, width, height } : null
  ), [height, published, route, siteId, width])
  const { snapshot: frameSnapshot, reload: reloadSnapshot } = useFrameSnapshot({
    target: snapshotTarget,
    captureTheme: 'both',
    autoCapture: !manualSnapshot,
  })
  const generatedPoster = frameSnapshot?.light?.dataUrl || frameSnapshot?.dark?.dataUrl || ''
  const generatedPosterDark = frameSnapshot?.dark?.dataUrl || ''
  const poster = published && exportedFrame?.snapshot
    ? publishedAssetUrl(exportedFrame.snapshot)
    : published
      ? resolveBasePathAsset(manualSnapshot, import.meta.env?.BASE_URL || '/')
      : (manualSnapshot || generatedPoster)
  const posterDark = published && exportedFrame?.snapshotDark
    ? publishedAssetUrl(exportedFrame.snapshotDark)
    : published
      ? resolveBasePathAsset(manualSnapshotDark, import.meta.env?.BASE_URL || '/')
      : (manualSnapshotDark || generatedPosterDark)
  const frameSrc = useMemo(() => (
    siteId && !published
      ? sitePreviewPath(import.meta.env.BASE_URL || '/', siteId, normalizeSiteRoute(route))
      : ''
  ), [published, route, siteId])
  const openUrl = published ? (exportedFrame?.openUrl || (typeof props.openUrl === 'string' ? props.openUrl : '')) : ''
  const descriptorError = frameSnapshot?.status === 'error' ? (frameSnapshot.error?.message || 'Preview unavailable') : ''
  const publishedError = exportedFrame?.available === false ? (exportedFrame.diagnostics?.[0]?.message || 'Site Frame unavailable') : ''
  const shownError = error || publishedError || descriptorError
  const pending = !poster && !shownError && !startingSite && Boolean(siteId) && frameSnapshot?.status === 'missing'
  const stalePreview = !manualSnapshot && frameSnapshot?.stale === true

  useEffect(() => {
    if (siteId || published) return undefined
    let active = true
    const loadSites = async () => {
      try {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
        const response = await fetch(`${base}/_storyboard/site/list`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || 'Could not load Sites')
        if (!active) return
        setSiteList({
          sites: Array.isArray(data?.sites) ? data.sites.filter(site => typeof site?.id === 'string' && site.id) : [],
          error: '',
        })
      } catch (cause) {
        if (active) setSiteList({ sites: [], error: cause?.message || 'Could not load Sites' })
      }
    }
    void loadSites()
    document.addEventListener('storyboard:sites-changed', loadSites)
    return () => {
      active = false
      document.removeEventListener('storyboard:sites-changed', loadSites)
    }
  }, [published, siteId])


  useEffect(() => {
    routeRef.current = route
  }, [route])

  const handleFrameLoad = useCallback(() => {
    frameRouteCleanup.current?.()
    frameRouteCleanup.current = observeSiteFrameRoute(frameRef.current, {
      siteId,
      basePath: import.meta.env.BASE_URL || '/',
      onRouteChange: nextRoute => {
        if (nextRoute === routeRef.current) return
        routeRef.current = nextRoute
        onUpdate?.({ route: nextRoute })
      },
    })
  }, [onUpdate, siteId])

  useEffect(() => () => frameRouteCleanup.current?.(), [])

  useEffect(() => {
    const started = event => {
      if (event.detail?.siteId !== siteId) return
      setError('')
      setLoadedSrc(null)
      setReloadToken(token => token + 1)
      if (!manualSnapshot && !published) void reloadSnapshot({ capture: true, force: true })
    }
    document.addEventListener('storyboard:site-started', started)
    return () => document.removeEventListener('storyboard:site-started', started)
  }, [manualSnapshot, published, reloadSnapshot, siteId])

  // Start the Site server when the user activates the interact gate and the
  // server is not running. Startability mirrors SitePage auto-start: managed
  // Sites with a start command. A `starting` Site is already launching (the
  // runtime dedupes starts), and starting a running Site would restart it.
  const ensureSiteRunning = useCallback(() => {
    if (!siteId) return
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
    void (async () => {
      try {
        const statusResponse = await fetch(`${base}/_storyboard/site/${encodeURIComponent(siteId)}/status`)
        const { binding } = await statusResponse.json().catch(() => ({}))
        const startable = binding?.source === 'managed'
          && Boolean(binding?.startCommand)
          && ['stopped', 'error'].includes(binding?.status)
        if (!startable) return
        setStartingSite(true)
        const response = await fetch(`${base}/_storyboard/site/${encodeURIComponent(siteId)}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true, timeoutMs: START_TIMEOUT_MS }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || 'Could not start Site')
        // Refresh this frame (and other Site consumers) now that the server is
        // healthy; the started listener reloads the preview and re-admits the
        // live document.
        notifySiteStarted(siteId, data?.binding?.developmentBaseUrl)
      } catch (cause) {
        setError(cause?.message || 'Could not start Site')
      } finally {
        setStartingSite(false)
      }
    })()
  }, [siteId])

  const attachExpandedPane = useCallback(container => {
    const viewport = viewportRef.current
    if (!viewport || !container) return undefined
    setAdmitted(true)
    ensureSiteRunning()
    const parent = viewport.parentElement
    const nextSibling = viewport.nextSibling
    const originalStyle = viewport.getAttribute('style')
    container.appendChild(viewport)
    viewport.style.width = '100%'
    viewport.style.height = '100%'
    return () => {
      if (nextSibling?.parentNode === parent) parent.insertBefore(viewport, nextSibling)
      else parent?.appendChild(viewport)
      if (originalStyle === null) viewport.removeAttribute('style')
      else viewport.setAttribute('style', originalStyle)
    }
  }, [ensureSiteRunning])

  useImperativeHandle(ref, () => ({
    attachExpandedPane,
    handleAction(actionId, opts) {
      if (actionId === 'expand' || actionId === 'expand-single' || actionId === 'split-screen') {
        if (published || !siteId) return true
        setAdmitted(true)
        setExpandOverride(actionId === 'split-screen' ? 'split' : opts?.altKey ? 'immersive' : 'single')
        return true
      }
      if (actionId === 'open-external' && siteId) {
        if (openUrl) window.open(openUrl, '_blank', 'noopener,noreferrer')
        else window.open(siteViewerPath(import.meta.env.BASE_URL || '/', siteId, route), '_blank', 'noopener,noreferrer')
      } else if (actionId === 'refresh-frame') {
        setLoadedSrc(null)
        setReloadToken(token => token + 1)
        if (!manualSnapshot && !published) void reloadSnapshot({ capture: true, force: true })
      } else return false
    },
  }), [attachExpandedPane, manualSnapshot, openUrl, published, reloadSnapshot, route, setExpandOverride, siteId])

  const expandedLayout = useMemo(() => {
    if (!expandMode || published) return null
    const primary = window.__storyboardCanvasBridgeState?.widgets?.find(widget => widget.id === widgetId)
      || { id: widgetId, type: 'site-frame', props: { siteId, route, title: props.title } }
    const connected = expandMode === 'split' ? findAllConnectedSplitTargets(widgetId) : []
    return buildSplitLayout(primary, connected, widget => {
      const pane = buildPaneForWidget(widget)
      return widget.id === widgetId ? { ...pane, attach: attachExpandedPane } : pane
    })
  }, [attachExpandedPane, expandMode, props.title, published, route, siteId, widgetId])

  // The external interact gate is the single gate in local dev: activating it
  // admits interaction and makes sure the Site server is running.
  useEffect(() => {
    if (!isLocalDev()) return undefined
    const activated = event => {
      if (event.detail?.widgetType !== 'site-frame' || event.detail?.widgetId !== widgetId) return
      setAdmitted(true)
      ensureSiteRunning()
    }
    document.addEventListener('storyboard:interact-gate-activated', activated)
    return () => document.removeEventListener('storyboard:interact-gate-activated', activated)
  }, [ensureSiteRunning, widgetId])

  const posterNode = poster ? (
    <picture>
      {posterDark ? <source media="(prefers-color-scheme: dark)" srcSet={posterDark} /> : null}
      <img className={styles.snapshot} src={poster} alt="" />
    </picture>
  ) : null

  return <WidgetWrapper>
    <section ref={rootRef} className={styles.root} style={{ width, height }} data-selected={selected || undefined} data-testid="site-frame">
      <header className={styles.header}>
        <span className={styles.headerIcon}><Icon name="iconoir/globe" size={16} /></span>
        <span className={styles.title}>{props.title || siteId || 'Site'}</span>
        <span className={styles.route}>{route || '/'}</span>
      </header>
      {!siteId ? (published ? <div className={styles.empty}>Select a Site</div> : (
        <div className={styles.sitePickerArea}>
          <div className={styles.sitePicker} role="group" aria-label="Choose a Site">
            <div className={styles.sitePickerHeading}>Choose a Site</div>
            {siteList === null ? <div className={styles.sitePickerMessage} role="status">Loading Sites…</div> : null}
            {siteList?.error ? <div className={styles.sitePickerMessage} role="alert">{siteList.error}</div> : null}
            {siteList && !siteList.error && siteList.sites.length === 0
              ? <div className={styles.sitePickerMessage}>No Sites available</div>
              : null}
            {siteList?.sites.map(site => {
              const title = typeof site.title === 'string' && site.title.trim() ? site.title : site.id
              return (
                <button
                  key={site.id}
                  type="button"
                  aria-label={`Use ${title}`}
                  className={styles.sitePickerItem}
                  onMouseDown={event => event.stopPropagation()}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    onUpdate?.({ siteId: site.id, title, route: '' })
                  }}
                >
                  <span>{title}</span>
                  {title !== site.id ? <small>{site.id}</small> : null}
                </button>
              )
            })}
          </div>
        </div>
      )) :
        published ? (
          poster && openUrl ? (
            <a className={styles.snapshotLink} href={openUrl} target="_blank" rel="noopener noreferrer" title={props.title || siteId}>
              {posterNode}
            </a>
          ) : poster ? posterNode :
            openUrl ? <a className={styles.publishedLink} href={openUrl} target="_blank" rel="noopener noreferrer">Open production site</a>
              : <div className={styles.empty}>{shownError || 'Preview unavailable'}</div>
        ) : (
          <div ref={viewportRef} className={styles.viewport}>
            {posterNode && (!admitted || loadedSrc !== frameSrc || startingSite) ? posterNode : null}
            {startingSite ? <div className={styles.pending}>Starting site…</div> : null}
            {admitted && frameSrc && !startingSite ? <iframe ref={frameRef} key={reloadToken} title={props.title || siteId} src={frameSrc} onLoad={event => { event.target.blur(); setLoadedSrc(frameSrc); handleFrameLoad() }} /> : null}
            {shownError && !startingSite && !poster ? <div className={styles.empty}>{shownError}</div> : null}
            {shownError && !startingSite && poster ? <span className={styles.status}>{shownError}</span> : null}
            {pending && !poster && !startingSite ? <div className={styles.pending}>Capturing preview…</div> : null}
            {stalePreview && admitted ? <span className={styles.status}>Preview may be out of date</span> : null}
          </div>
        )}
    </section>
    {expandedLayout && <ExpandedPane initialLayout={expandedLayout} variant={expandMode === 'immersive' ? 'immersive' : 'full'} onClose={clearExpandOverride} />}
    {resizable && <ResizeHandle targetRef={rootRef} onResize={(w, h) => onUpdate?.({ width: w, height: h })} />}
  </WidgetWrapper>
})

export default SiteFrame

function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback }
