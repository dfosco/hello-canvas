import { useState, useEffect, useMemo, useRef, Suspense, lazy, Component } from 'react'
import { useParams, useLocation } from 'react-router-dom'
// Named import seeds the core data index via init() AND provides canvas/story route data
import { canvases, stories } from 'virtual:storyboard-data-index'
import { loadFlow, flowExists, findRecord, deepMerge, setFlowClass, installBodyClassSync, resolveFlowName, resolveRecordName, getPrototypeMetadata } from '../core/index.js'
import { StoryboardContext } from './StoryboardContext.js'
import usePrototypeReloadGuard from './hooks/usePrototypeReloadGuard.js'
import useConfigurationReloadGuard from './hooks/useConfigurationReloadGuard.js'
import { storyboardWs } from './storyboard-ws.js'
import { openNotebookSidebar } from '../core/notebook/browserBridge.js'
import styles from './FlowError.module.css'

export { StoryboardContext }

const CanvasPageLazy = lazy(() => import('./canvas/CanvasPage.jsx'))
const StoryPageLazy = lazy(() => import('./story/StoryPage.jsx'))
const CommandPaletteLazy = lazy(() => import('./CommandPalette/CommandPalette.jsx'))

/**
 * Error boundary for top-level sections (canvas, story).
 * Prevents a crash in one section from taking down the entire provider tree.
 */
class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(
      `[storyboard] ${this.props.section || 'Section'} crashed:`,
      error,
      info?.componentStack,
    )
  }

  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error)
      return (
        <main className={styles.container}>
          <div className={styles.banner}>
            <strong>{this.props.section || 'Section'} error</strong>
            {message}
          </div>
          <button className={styles.homeLink} type="button" onClick={() => openNotebookSidebar()}>Open notebook sidebar</button>
        </main>
      )
    }
    return this.props.children
  }
}

// Canvas route resolution and group lookup happen live below
// (see matchCanvasRoute / getCanvasGroupMap) so that HMR rename/duplicate
// take effect without a page reload.

// Build a map from group name → array of { name, route, title } for page selector.
// Read live from `canvases` (HMR mutates it in place) so rename/duplicate are
// reflected immediately. Sorted by pageOrder from .meta.json when available.
function getCanvasGroupMap() {
  const map = new Map()
  for (const [name, data] of Object.entries(canvases || {})) {
    const route = (data?._route || `/canvas/${name}`).replace(/\/+$/, '')
    const group = data?._group
    if (!group) continue
    if (!map.has(group)) map.set(group, [])
    map.get(group).push({
      name,
      route,
      title: data?.title || name.split('/').pop(),
      isPrivate: !!data?._isPrivate,
      _canvasMeta: data?._canvasMeta || null,
    })
  }
  for (const [, pages] of map) {
    const pageOrder = pages[0]?._canvasMeta?.pageOrder
    if (Array.isArray(pageOrder)) {
      const orderMap = new Map()
      pageOrder.forEach((entry, idx) => {
        if (typeof entry === 'string' && !entry.startsWith('sep-')) orderMap.set(entry, idx)
      })
      pages.sort((a, b) => {
        const ai = orderMap.has(a.name) ? orderMap.get(a.name) : Infinity
        const bi = orderMap.has(b.name) ? orderMap.get(b.name) : Infinity
        return ai - bi
      })
    }
  }
  return map
}

function matchCanvasRoute(pathname) {
  const normalized = stripBasePath(pathname)
  // Iterate `canvases` live so HMR rename/duplicate are reflected without
  // a page reload (virtual-module HMR mutates the object in place).
  for (const [name, data] of Object.entries(canvases || {})) {
    const route = (data?._route || `/canvas/${name}`).replace(/\/+$/, '')
    if (route === normalized) return name
  }
  return null
}

/**
 * Live-lookup a story route against the current `stories` object.
 *
 * Unlike the canvas route map (built once at module scope), this iterates
 * the `stories` object on every call so it always reflects HMR mutations
 * (the virtual-module HMR handler mutates `stories` in place).
 *
 * Also strips encoded query strings (%3F / %3f) that can leak into the
 * pathname when an iframe src is percent-encoded incorrectly.
 */
function matchStoryRoute(pathname) {
  let normalized = stripBasePath(pathname)
  // Strip encoded query strings that leaked into the path (%3F / %3f = ?)
  const encodedIdx = normalized.search(/%3f/i)
  if (encodedIdx !== -1) normalized = normalized.substring(0, encodedIdx)
  const literalIdx = normalized.indexOf('?')
  if (literalIdx !== -1) normalized = normalized.substring(0, literalIdx)

  for (const [name, data] of Object.entries(stories || {})) {
    if (data?._route && data._route.replace(/\/+$/, '') === normalized) {
      return name
    }
  }
  return null
}

/**
 * Strip the app's sub-path prefix (e.g. /storyboard) from the pathname.
 * React Router's basename strips the branch prefix but not the app name prefix
 * when the app runs under a nested base path.
 *
 * Two prefixing scenarios are handled:
 *   1. Branch deploys — BASE_URL is `/branch--xxx/{devDomain}/`, so we strip
 *      whatever app sub-path remains after the branch prefix.
 *   2. Local dev via Caddy proxy — BASE_URL is `/` (Caddy strips `/{devDomain}/`
 *      before forwarding to the dev server), but window.location.pathname is
 *      still `/{devDomain}/...`. React Router's basename `/` doesn't strip it,
 *      so we rely on the injected `__SB_DEV_DOMAIN__` global instead.
 */
function stripBasePath(pathname) {
  let p = pathname.replace(/\/+$/, '') || '/'
  // BASE_URL includes branch prefix + app path (e.g. /branch--name/storyboard/)
  // React Router strips the branch prefix but may leave the app sub-path
  const base = (import.meta.env?.BASE_URL || '/').replace(/\/+$/, '')
  if (base && base !== '/') {
    // Extract just the last segment(s) after the branch prefix
    const withoutBranch = base.replace(/^\/branch--[^/]+/, '')
    const subPath = withoutBranch.replace(/\/+$/, '')
    if (subPath && p.startsWith(subPath)) {
      p = p.slice(subPath.length) || '/'
    }
  }
  // Local dev via Caddy proxy: window.location.pathname includes the
  // /{devDomain}/ prefix that Caddy strips before reaching the dev server.
  // BASE_URL is `/` in this scenario, so the block above is a no-op.
  if (typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ && window.__SB_DEV_DOMAIN__) {
    const devDomain = String(window.__SB_DEV_DOMAIN__).replace(/^\/+|\/+$/g, '')
    if (devDomain) {
      const devPrefix = '/' + devDomain
      if (p === devPrefix || p.startsWith(devPrefix + '/')) {
        p = p.slice(devPrefix.length) || '/'
      }
    }
  }
  return p
}

function isCanvasPath(pathname) {
  const normalized = stripBasePath(pathname)
  return normalized === '/canvas' || normalized.startsWith('/canvas/')
}

function isStoryPath(pathname) {
  const normalized = stripBasePath(pathname)
  return normalized === '/components' || normalized.startsWith('/components/')
}

/**
 * Derives the top-level prototype name from a pathname.
 * "/Dashboard" → "Dashboard", "/Dashboard/sub" → "Dashboard"
 * "/posts/123" → "posts", "/" → null
 */
function getPrototypeName(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return null
  const segments = path.split('/').filter(Boolean)
  return segments[0] || null
}

/**
 * Derives a flow name from a pathname.
 * "/Overview" → "Overview", "/" → "index", "/nested/Page" → "Page"
 */
function getPageFlowName(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'index'
  const last = path.split('/').pop()
  return last || 'index'
}

/**
 * Provides loaded flow data to the component tree.
 * Reads the flow name from the ?flow= URL param (with ?scene= as alias),
 * a matching flow file for the current page, or defaults to "default".
 *
 * Derives the prototype scope from the route and uses it to resolve
 * scoped flow and record names (e.g. "Dashboard/default" for /Dashboard).
 *
 * Optionally merges record data when `recordName` and `recordParam` are provided.
 * The matched record entry is injected under the "record" key in flow data.
 */
export default function StoryboardProvider({ flowName, sceneName, recordName, recordParam, children }) {
  const basePath = import.meta.env?.BASE_URL || '/'
  const isStaticPublication = globalThis.__HYPERCANVAS_NOTEBOOK_PUBLICATION__ === true
  const location = useLocation()
  const isCanvas = Boolean(matchCanvasRoute(location.pathname))
  const [coreConnected, setCoreConnected] = useState(() => storyboardWs.connectionState() !== 'disconnected')

  useEffect(() => {
    const onConnection = (event) => setCoreConnected(event?.detail?.state !== 'disconnected')
    window.addEventListener('storyboard:core-connection', onConnection)
    return () => window.removeEventListener('storyboard:core-connection', onConnection)
  }, [])

  // Prototype guards belong to prototype/story documents, not the canvas
  // shell. The canvas has its own UI-code guard in CanvasPage.
  usePrototypeReloadGuard({ enabled: !isCanvas })
  useConfigurationReloadGuard()

  return (
    <>
      <StoryboardProviderInner
        flowName={flowName}
        sceneName={sceneName}
        recordName={recordName}
        recordParam={recordParam}
      >
        {children}
      </StoryboardProviderInner>
      <Suspense fallback={null}>
        <CommandPaletteLazy basePath={basePath} />
      </Suspense>
      {!isStaticPublication && !coreConnected && (
        <aside
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', inset: 0, zIndex: 2147483000, display: 'grid', placeItems: 'center',
            padding: 24, background: 'rgba(20, 23, 28, 0.88)', color: '#fff', textAlign: 'center',
          }}
        >
          <div>
            <h1 style={{ margin: '0 0 8px' }}>Hypercanvas is disconnected</h1>
            <p style={{ margin: '0 0 16px' }}>The local Core server stopped. Restart Hypercanvas from its terminal window, then reconnect.</p>
            <button type="button" onClick={() => window.location.reload()}>Reconnect</button>
          </div>
        </aside>
      )}
    </>
  )
}

function StoryboardProviderInner({ flowName, sceneName, recordName, recordParam, children }) {
  const location = useLocation()
  const params = useParams()

  // Re-evaluate story route detection when the data index changes via HMR.
  // The virtual-module HMR handler mutates `stories` in place and dispatches
  // this event; bumping the key forces useMemo deps to re-fire.
  const [storyIndexKey, setStoryIndexKey] = useState(0)
  useEffect(() => {
    const handler = () => setStoryIndexKey((k) => k + 1)
    document.addEventListener('storyboard:story-index-changed', handler)
    return () => document.removeEventListener('storyboard:story-index-changed', handler)
  }, [])

  // Same pattern for canvases: HMR mutates the in-memory `canvases` object
  // when files are added/renamed/removed. Re-run canvas route matching and
  // sibling-page derivation when that happens so the SPA reflects the new
  // state without requiring a hard reload (which would 404 on old URLs).
  const [canvasIndexKey, setCanvasIndexKey] = useState(0)
  useEffect(() => {
    const handler = () => setCanvasIndexKey((k) => k + 1)
    document.addEventListener('storyboard:canvas-index-changed', handler)
    return () => document.removeEventListener('storyboard:canvas-index-changed', handler)
  }, [])

  // Story route detection — matches current URL against registered story routes
  // storyIndexKey forces re-evaluation when HMR mutates the stories object in place
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storyName = useMemo(() => matchStoryRoute(location.pathname), [location.pathname, storyIndexKey])
  const isMissingStoryRoute = useMemo(
    () => isStoryPath(location.pathname) && !storyName,
    [location.pathname, storyName],
  )

  // Canvas route detection — matches current URL against registered canvas routes.
  // canvasIndexKey forces re-evaluation when HMR mutates the canvases object in place
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canvasId = useMemo(() => matchCanvasRoute(location.pathname), [location.pathname, canvasIndexKey])
  const isMissingCanvasRoute = useMemo(
    () => isCanvasPath(location.pathname) && !canvasId && !storyName,
    [location.pathname, canvasId, storyName],
  )

  const searchParams = new URLSearchParams(location.search)
  const sceneParam = searchParams.get('flow') || searchParams.get('scene')
  const prototypeName = getPrototypeName(location.pathname)
  const pageFlow = getPageFlowName(location.pathname)

  // Resolve flow name with prototype scoping (skip for canvas/story pages)
  const activeFlowName = useMemo(() => {
    if (canvasId || isMissingCanvasRoute || storyName || isMissingStoryRoute) return null
    const requested = sceneParam || flowName || sceneName
    if (requested) {
      // Allow fully-scoped flow names from URLs/widgets without re-prefixing
      // (e.g. "Proto/flow" should not become "Proto/Proto/flow").
      if (requested.includes('/')) return requested
      return resolveFlowName(prototypeName, requested)
    }
    // 1. Page-specific flow (e.g., Example/Forms)
    const scopedPageFlow = resolveFlowName(prototypeName, pageFlow)
    if (flowExists(scopedPageFlow)) return scopedPageFlow
    // 2. Prototype flow — named after the prototype folder (e.g., Example/example)
    if (prototypeName) {
      const protoFlow = resolveFlowName(prototypeName, prototypeName)
      if (flowExists(protoFlow)) return protoFlow
    }
    // 3. Prototype-scoped default (e.g. Example/default)
    if (prototypeName) {
      const scopedDefault = resolveFlowName(prototypeName, 'default')
      if (flowExists(scopedDefault)) return scopedDefault
    }
    // 4. Global default — or null if no flow exists at all
    if (flowExists('default')) return 'default'
    return null
  }, [canvasId, isMissingCanvasRoute, storyName, isMissingStoryRoute, sceneParam, flowName, sceneName, prototypeName, pageFlow])

  // Auto-install body class sync (sb-key--value classes on <body>)
  useEffect(() => installBodyClassSync(), [])

  // Update document.title to reflect the current artifact and build channel.
  useEffect(() => {
    const base = import.meta.env?.BASE_URL || '/'
    const branchMatch = base.match(/\/branch--([^/]+)/)
    const branchSuffix = branchMatch ? ` (${branchMatch[1]})` : ''
    const appName = import.meta.env?.DEV ? 'Hypercanvas Dev' : 'Hypercanvas'

    let title
    if (canvasId) {
      const canvasData = canvases?.[canvasId]
      const meta = canvasData?._canvasMeta
      const pageTitle = canvasData?.title || canvasId.split('/').pop()
      title = (meta?.title || pageTitle) + ` · ${appName}`
    } else if (prototypeName) {
      title = prototypeName + ` · ${appName}`
    } else {
      title = appName
    }

    document.title = title + branchSuffix
  }, [canvasId, prototypeName])

  // Skip flow loading for canvas/story pages and flow-less pages
  const { data, error, flowTokens } = useMemo(() => {
    if (canvasId || isMissingCanvasRoute || storyName || isMissingStoryRoute) return { data: null, error: null, flowTokens: null }
    if (!activeFlowName) return { data: {}, error: null, flowTokens: null }
    try {
      let flowData = loadFlow(activeFlowName)

      // Extract tokens before passing data to consumers (reserved metadata key)
      const extractedTokens = flowData?.tokens || null
      if (flowData?.tokens) {
        flowData = { ...flowData }
        delete flowData.tokens
      }

      // Merge record data if configured (with scoped resolution)
      if (recordName && recordParam && params[recordParam]) {
        const resolvedRecord = resolveRecordName(prototypeName, recordName)
        const entry = findRecord(resolvedRecord, params[recordParam])
        if (entry) {
          flowData = deepMerge(flowData, { record: entry })
        }
      }

      setFlowClass(activeFlowName)
      return { data: flowData, error: null, flowTokens: extractedTokens }
    } catch (err) {
      return { data: null, error: err.message, flowTokens: null }
    }
  }, [canvasId, isMissingCanvasRoute, storyName, isMissingStoryRoute, activeFlowName, recordName, recordParam, params, prototypeName])

  // Resolve prototype-level tokens from .prototype.json metadata
  const protoTokens = useMemo(() => {
    if (!prototypeName) return null
    const meta = getPrototypeMetadata(prototypeName)
    return meta?.tokens || null
  }, [prototypeName])

  // Merge prototype + flow tokens (flow wins). Stable reference when tokens don't change.
  const mergedTokens = useMemo(() => {
    if (!protoTokens && !flowTokens) return null
    return { ...(protoTokens || {}), ...(flowTokens || {}) }
  }, [protoTokens, flowTokens])

  // Track which URL params were set by tokens (vs. user-explicit params)
  const managedParamsRef = useRef({})

  // Apply merged tokens to URL search params via replaceState.
  // Only sets params not already present (user-explicit wins on first load).
  // Cleans up stale managed params when flow/prototype tokens change.
  useEffect(() => {
    const url = new URL(window.location.href)
    const managed = managedParamsRef.current
    const nextManaged = {}
    let changed = false

    // Remove stale managed params no longer in merged tokens
    for (const key of Object.keys(managed)) {
      if (!mergedTokens || !(key in mergedTokens)) {
        url.searchParams.delete(key)
        changed = true
      }
    }

    // Apply current tokens
    if (mergedTokens) {
      const reserved = new Set(['flow', 'scene'])
      for (const [key, value] of Object.entries(mergedTokens)) {
        if (value == null || typeof value === 'object' || reserved.has(key)) continue
        const strValue = String(value)
        if (!url.searchParams.has(key) || (key in managed && managed[key] !== strValue)) {
          url.searchParams.set(key, strValue)
          nextManaged[key] = strValue
          changed = true
        } else if (key in managed) {
          nextManaged[key] = strValue
        }
      }
    }

    managedParamsRef.current = nextManaged

    if (changed) {
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [mergedTokens])

  // Canvas pages get their own rendering path — no flow data needed
  if (canvasId) {
    const canvasData = canvases?.[canvasId]
    const group = canvasData?._group
    // Include the current canvas as a sibling even if it's the only page in its group,
    // so the PageSelector can render and allow adding new pages.
    // canvasIndexKey ensures siblingPages are re-derived on HMR
    // eslint-disable-next-line no-unused-vars
    const _hmrTick = canvasIndexKey
    const siblingPages = group
      ? getCanvasGroupMap().get(group) || []
      : [{ name: canvasId, route: canvasData?._route || `/canvas/${canvasId}`, title: canvasData?.title || canvasId.split('/').pop(), isPrivate: !!canvasData?._isPrivate }]
    const canvasMeta = canvasData?._canvasMeta || null
    const canvasValue = {
      data: null,
      error: null,
      loading: false,
      flowName: null,
      sceneName: null,
      prototypeName: null,
    }
    return (
      <StoryboardContext.Provider value={canvasValue}>
        <SectionErrorBoundary section="Canvas">
          <Suspense fallback={null}>
            <CanvasPageLazy canvasId={canvasId} siblingPages={siblingPages} canvasMeta={canvasMeta} />
          </Suspense>
        </SectionErrorBoundary>
      </StoryboardContext.Provider>
    )
  }

  // Story pages get their own rendering path — no flow data needed
  if (storyName) {
    const storyValue = {
      data: null,
      error: null,
      loading: false,
      flowName: null,
      sceneName: null,
      prototypeName: null,
    }
    return (
      <StoryboardContext.Provider value={storyValue}>
        <SectionErrorBoundary section="Story">
          <Suspense fallback={null}>
            <StoryPageLazy name={storyName} />
          </Suspense>
        </SectionErrorBoundary>
      </StoryboardContext.Provider>
    )
  }

  if (isMissingCanvasRoute) {
    const currentUrl = `${location.pathname}${location.search}`
    const truncatedUrl = currentUrl.length > 60
      ? currentUrl.slice(0, 60) + '…'
      : currentUrl

    return (
      <main className={styles.container}>
        <div className={styles.banner}>
          <strong>Canvas not found</strong>
          No canvas matches this route.
        </div>
        <p className={styles.meta}>
          Tried to open{' '}
          <a href={currentUrl} title={currentUrl}>{truncatedUrl}</a>
        </p>
        <button className={styles.homeLink} type="button" onClick={() => openNotebookSidebar()}>Open notebook sidebar</button>
      </main>
    )
  }

  if (isMissingStoryRoute) {
    const currentUrl = `${location.pathname}${location.search}`
    const truncatedUrl = currentUrl.length > 60
      ? currentUrl.slice(0, 60) + '…'
      : currentUrl

    return (
      <main className={styles.container}>
        <div className={styles.banner}>
          <strong>Story not found</strong>
          No story matches this route.
        </div>
        <p className={styles.meta}>
          Tried to open{' '}
          <a href={currentUrl} title={currentUrl}>{truncatedUrl}</a>
        </p>
        <button className={styles.homeLink} type="button" onClick={() => openNotebookSidebar()}>Open notebook sidebar</button>
      </main>
    )
  }

  const value = {
    data,
    error,
    loading: false,
    flowName: activeFlowName,
    sceneName: activeFlowName, // backward compat
    prototypeName,
  }

  if (error) {
    const currentUrl = `${location.pathname}${location.search}`
    const truncatedUrl = currentUrl.length > 60
      ? currentUrl.slice(0, 60) + '…'
      : currentUrl

    return (
      <div className={styles.container}>
        <div className={styles.banner}>
          <strong>Error loading flow</strong>
          {error}
        </div>
        <p className={styles.meta}>
          Tried to load{' '}
          <a href={currentUrl} title={currentUrl}>{truncatedUrl}</a>
        </p>
        <button className={styles.homeLink} type="button" onClick={() => openNotebookSidebar()}>Open notebook sidebar</button>
      </div>
    )
  }

  return (
    <StoryboardContext.Provider value={value}>
      {children}
    </StoryboardContext.Provider>
  )
}
