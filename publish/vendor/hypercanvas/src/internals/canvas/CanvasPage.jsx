import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '../../canvas/index.js'
import '../../canvas/style.css'
import { useCanvas } from './useCanvas.js'
import { shouldPreventCanvasTextSelection } from './textSelection.js'
import { getCanvasThemeVars, getCanvasPrimerAttrs } from './canvasTheme.js'
import { getWidgetComponent } from './widgets/index.js'
import { schemas, getDefaults } from './widgets/widgetProps.js'
import { getFeatures, isResizable, isExpandable, getAnchorState, canAcceptConnection, isSplitScreenCapable, getChromeOptions, getInteractionOptions, isMovable, getDeleteConfirm, isEditableInProduction } from './widgets/widgetConfig.js'
import { createPasteContext, resolvePaste } from './widgets/pasteRules.js'
import { getPasteRules } from '../../core/index.js'
import { isTerminalResizable, getTerminalDimensions } from '../../core/index.js'
import { getFlag, subscribeToStorage } from '../../core/index.js'
import { getCanvasZoom } from '../../core/index.js'
import { isCanvasProductionEnabled } from '../../core/index.js'
import { applyEvent as applyCanvasEvent } from '../../core/canvas/materializer.js'
import {
  getCanvasInteraction,
  subscribeToCanvasInteraction,
  getCanvasInteractionSnapshot,
} from '../../core/index.js'
import { trackRecent as trackRecentArtifact } from '../../core/index.js'
import { registerSmoothCorners } from '../../core/utils/smoothCorners.js'
import { registerHotPoolDevLogs } from './hotPoolDevLogs.js'
import { isGitHubEmbedUrl } from './widgets/githubUrl.js'
import { showToast } from '../showToast.js'
import { parseSiteUrl, resolveSiteUrl, siteRouteForUrl } from '../../core/site/contract.js'

import WidgetChrome from './widgets/WidgetChrome.jsx'
import ComponentWidget from './widgets/ComponentWidget.jsx'
import useUndoRedo from './useUndoRedo.js'
import useMarqueeSelect from './useMarqueeSelect.js'
import MarqueeOverlay from './MarqueeOverlay.jsx'
import FilePickerController from './widgets/FileWidget/FilePickerController.jsx'
import DeleteConfirmController from './widgets/FileWidget/DeleteConfirmController.jsx'
import {
  addWidget as addWidgetApi,
  checkGitHubCliAvailable,
  duplicateImage,
  fetchGitHubEmbed,
  getCanvas as getCanvasApi,
  patchWidget as patchWidgetApi,
  removeWidget as removeWidgetApi,
  redoEvent as redoEventApi,
  undoEvent as undoEventApi,
  updateCanvas,
  updateFolderMeta,
  uploadImage,
  addConnector as addConnectorApi,
  removeConnector as removeConnectorApi,
  updateConnector as updateConnectorApi,
  batchOperations,
  getHubRoles,
} from './canvasApi.js'
import PageSelector from './PageSelector.jsx'
import Icon from '../Icon.jsx'
import ChromeSlot from '../../core/ui/ChromeSlot.jsx'
import { stories as storyIndex } from 'virtual:storyboard-data-index'
import styles from './CanvasPage.module.css'
import ConnectorLayer from './ConnectorLayer.jsx'
import { findBestAnchors } from './connectorGeometry.js'
import { storyboardWs } from '../storyboard-ws.js'

/** Canvas zoom limits — read from storyboard.config.json via canvasConfig. */
function zoomLimits() {
  const z = getCanvasZoom()
  return { ZOOM_MIN: z.min, ZOOM_MAX: z.max, ZOOM_STEP: z.step }
}

/**
 * Compute the .canvasZoom wrapper's layout width/height for a given scale,
 * honoring `canvas.surface.{width,height}`.
 *
 * Default ("auto"): `max(10000, 100 / scale) <axis-unit>` — keeps the
 * surface huge so users can pan into an infinite-feeling canvas; layout
 * shrinks with zoom-in but the 10000-unit floor keeps scroll available.
 *
 * Viewport: the surface clamps to 100<axis-unit> at scale = 1, then grows
 * proportionally with scale on zoom-in (`100 * scale <axis-unit>`) so the
 * scroller still produces horizontal/vertical scroll above 100% zoom.
 * At scale < 1 the layout stays at 100<axis-unit> (zoom-out doesn't add
 * extra empty space).
 */
function getZoomLayoutDim(scale, surfaceAxis, axisUnit) {
  if (surfaceAxis === 'viewport') {
    return `${Math.max(100, 100 * scale)}${axisUnit}`
  }
  return `${Math.max(10000, 100 / scale)}${axisUnit}`
}

function getZoomLayoutWidth(scale, surface) {
  return getZoomLayoutDim(scale, surface?.width, 'vw')
}

function getZoomLayoutHeight(scale, surface) {
  return getZoomLayoutDim(scale, surface?.height, 'vh')
}

/** Saved viewport state older than this is considered stale — zoom-to-fit instead. */
const VIEWPORT_TTL_MS = 15 * 60 * 1000

const CANVAS_BRIDGE_STATE_KEY = '__storyboardCanvasBridgeState'
const CANVAS_WIDGET_REFS_KEY = '__storyboardCanvasWidgetRefs'
const GH_INSTALL_URL = 'https://github.com/cli/cli'

function isLocalSiteUrl(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '::1') return true
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 169 && octets[1] === 254)
}

function isSiteLoopbackUrl(url) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

registerSmoothCorners()
registerHotPoolDevLogs()

function setCanvasWidgetRef(widgetId, ref) {
  if (!widgetId || typeof window === 'undefined') return
  if (!window[CANVAS_WIDGET_REFS_KEY]) window[CANVAS_WIDGET_REFS_KEY] = new Map()
  if (ref) window[CANVAS_WIDGET_REFS_KEY].set(widgetId, ref)
  else window[CANVAS_WIDGET_REFS_KEY].delete(widgetId)
}

// Build a reverse map from story route paths → { storyId, route }
const storyRouteIndex = new Map()
for (const [storyId, data] of Object.entries(storyIndex || {})) {
  if (data?._route) {
    storyRouteIndex.set(data._route.replace(/\/+$/, ''), storyId)
  }
}

function getToolbarColorMode(theme) {
  return String(theme || 'light').startsWith('dark') ? 'dark' : 'light'
}

/**
 * Compute CSS overrides to apply to the canvas scroll container based on the
 * configured scroll axis lock.
 *   "both"       — no override (default behavior)
 *   "vertical"   — disable horizontal scroll (canvas behaves like a webpage)
 *   "horizontal" — disable vertical scroll
 *   "none"       — disable both axes
 */
function scrollAxisStyle(axis) {
  if (axis === 'vertical')   return { overflowX: 'hidden' }
  if (axis === 'horizontal') return { overflowY: 'hidden' }
  if (axis === 'none')       return { overflowX: 'hidden', overflowY: 'hidden' }
  return null
}

function getConnectedComponent(widgetId, connectors) {
  const adj = new Map()
  for (const c of connectors || []) {
    const a = c.start?.widgetId
    const b = c.end?.widgetId
    if (!a || !b || a === b) continue
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a).add(b)
    adj.get(b).add(a)
  }

  const queue = [widgetId]
  const seen = new Set([widgetId])
  while (queue.length > 0) {
    const cur = queue.shift()
    for (const next of adj.get(cur) || []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

function resolveCanvasThemeFromStorage() {
  if (typeof localStorage === 'undefined') return 'light'
  let sync = { prototype: true, toolbar: true, codeBoxes: true, canvas: true }
  try {
    const rawSync = localStorage.getItem('sb-theme-sync')
    if (rawSync) sync = { ...sync, ...JSON.parse(rawSync) }
  } catch {
    // Ignore malformed sync settings
  }

  if (!sync.canvas) return 'light'

  const attrTheme = document.documentElement.getAttribute('data-sb-canvas-theme')
  if (attrTheme) return attrTheme

  const stored = localStorage.getItem('sb-color-scheme') || 'system'
  if (stored !== 'system') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Get the copyable URL for a widget based on its type.
 * Returns the most relevant URL/path for the widget content.
 */
// eslint-disable-next-line no-unused-vars
function getWidgetCopyableUrl(widget) {
  const { type, props = {} } = widget
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  switch (type) {
    case 'prototype':
      // Prototype src is a path like "/MyPrototype" - make it a full URL
      return props.src ? `${window.location.origin}${base.replace(/\/$/, '')}${props.src}` : ''
    case 'figma-embed':
      return props.url || ''
    case 'link-preview':
      return props.url || ''
    case 'image':
      // Return the served image URL
      return props.src ? `${window.location.origin}${base.replace(/\/$/, '')}/_storyboard/canvas/images/${props.src}` : ''
    case 'sticky-note':
      // Sticky notes have text content, not a URL
      return props.text || ''
    case 'markdown':
      // Markdown has content, not a URL
      return props.content || ''
    default:
      return ''
  }
}

/**
 * Debounce helper — returns a function that delays invocation.
 * Exposes `.cancel()` to abort pending calls (used by undo/redo).
 */
function debounce(fn, ms) {
  let timer
  const debounced = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

/** Per-canvas viewport state persistence (zoom + scroll position). */
function getViewportStorageKey(canvasId) {
  return `sb-canvas-viewport:${canvasId}`
}

function loadViewportState(canvasId) {
  try {
    const raw = localStorage.getItem(getViewportStorageKey(canvasId))
    if (!raw) { if (getFlag('dev-logs')) console.log('[viewport] no saved state for', canvasId); return null }
    const state = JSON.parse(raw)
    const timestamp = typeof state.timestamp === 'number' ? state.timestamp : 0
    const age = Date.now() - timestamp
    if (age > VIEWPORT_TTL_MS) {
      if (getFlag('dev-logs')) console.log('[viewport] stale state for', canvasId, '— age:', Math.round(age / 1000), 's')
      localStorage.removeItem(getViewportStorageKey(canvasId))
      return null
    }
    if (getFlag('dev-logs')) console.log('[viewport] loaded state for', canvasId, '— age:', Math.round(age / 1000), 's, zoom:', state.zoom, 'scroll:', state.scrollLeft, state.scrollTop)
    const { ZOOM_MIN, ZOOM_MAX } = zoomLimits()
    return {
      zoom: typeof state.zoom === 'number' ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom)) : null,
      scrollLeft: typeof state.scrollLeft === 'number' ? state.scrollLeft : null,
      scrollTop: typeof state.scrollTop === 'number' ? state.scrollTop : null,
    }
  } catch { return null }
}

function saveViewportState(canvasId, state) {
  try {
    localStorage.setItem(getViewportStorageKey(canvasId), JSON.stringify({
      ...state,
      timestamp: Date.now(),
    }))
  } catch { /* quota exceeded — non-critical */ }
}

/**
 * Get viewport-center coordinates in canvas space for placing a new widget.
 * Converts the visible center of the scroll container to unscaled canvas coordinates.
 */
function getViewportCenter(scrollEl, scale) {
  if (!scrollEl) {
    return { x: 0, y: 0 }
  }
  const cx = scrollEl.scrollLeft + scrollEl.clientWidth / 2
  const cy = scrollEl.scrollTop + scrollEl.clientHeight / 2
  return {
    x: Math.round(cx / scale),
    y: Math.round(cy / scale),
  }
}

/** Fallback sizes for widget types without explicit width/height defaults. */
const WIDGET_FALLBACK_SIZES = {
  'site-frame': { width: 800, height: 600 },
  'sticky-note':  { width: 270, height: 170 },
  'markdown':     { width: 530, height: 240 },
  'prototype':    { width: 800, height: 600 },
  'link-preview': { width: 320, height: 120 },
  'figma-embed':  { width: 800, height: 450 },
  'component':    { width: 200, height: 150 },
  'image':        { width: 400, height: 300 },
}

/**
 * Offset a position so the widget's center (not its top-left corner)
 * lands on the given point.
 */
function centerPositionForWidget(pos, type, props) {
  const fallback = WIDGET_FALLBACK_SIZES[type] || { width: 200, height: 150 }
  const w = props?.width ?? fallback.width
  const h = props?.height ?? fallback.height
  return {
    x: Math.round(pos.x - w / 2),
    y: Math.round(pos.y - h / 2),
  }
}

/**
 * Merge newly created widgets into the local list without duplicating ids.
 *
 * The add call's own response and the server's canvas push (HMR) both carry
 * the same widget, and whichever arrives second must not append it again —
 * duplicated ids break React's keyed list (duplicate-key errors, doubled
 * iframes) and corrupt selection/drag state.
 */
function appendLocalWidgets(prev, widgets) {
  const incoming = Array.isArray(widgets) ? widgets : [widgets]
  const base = prev || []
  const known = new Set(base.map(widget => widget?.id))
  const fresh = incoming.filter(widget => widget?.id && !known.has(widget.id))
  return fresh.length > 0 ? [...base, ...fresh] : prev
}

/**
 * Identify widgets that can act as agents — PromptWidget instances and
 * Terminal widgets whose id starts with `agent-`. Used to derive the
 * "done agents" list surfaced by the collab bar.
 */
function isAgentWidget(widget) {
  if (!widget) return false
  if (widget.type === 'prompt') return true
  if (widget.type === 'agent') return true
  if (widget.type === 'terminal' && typeof widget.id === 'string' && widget.id.startsWith('agent-')) return true
  return false
}

function roundPosition(value) {
  return Math.round(value)
}

/** Snap a value to the nearest grid line. */
function snapValue(value, gridSize) {
  return Math.round(value / gridSize) * gridSize
}

/** Snap a position to the grid if snapping is enabled. */
// eslint-disable-next-line no-unused-vars
function snapPosition(pos, gridSize, enabled) {
  if (!enabled || !gridSize) return pos
  return {
    x: Math.max(0, snapValue(pos.x, gridSize)),
    y: Math.max(0, snapValue(pos.y, gridSize)),
  }
}

/** Snap a dimension to the grid if snapping is enabled. */
function snapDimension(value, gridSize, enabled, min = 0) {
  if (!enabled || !gridSize) return value
  return Math.max(min, snapValue(value, gridSize))
}

/** Padding (canvas-space pixels) around bounding box for zoom-to-fit. */
const FIT_PADDING = 48

/**
 * Compute the axis-aligned bounding box that contains every widget and source.
 * Returns { minX, minY, maxX, maxY } in canvas-space coordinates, or null if empty.
 */
function computeCanvasBounds(widgets, componentEntries) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasItems = false

  // JSON widgets
  for (const w of (widgets ?? [])) {
    const x = w?.position?.x ?? 0
    const y = w?.position?.y ?? 0
    const fallback = WIDGET_FALLBACK_SIZES[w.type] || { width: 200, height: 150 }
    const width = w.props?.width ?? fallback.width
    const height = w.props?.height ?? fallback.height
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
    hasItems = true
  }

  // Component widgets (from jsxExports or sources fallback)
  for (const entry of componentEntries) {
    const x = entry.sourceData?.position?.x ?? 0
    const y = entry.sourceData?.position?.y ?? 0
    const fallback = WIDGET_FALLBACK_SIZES['component']
    const width = entry.sourceData?.width ?? fallback.width
    const height = entry.sourceData?.height ?? fallback.height
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
    hasItems = true
  }

  return hasItems ? { minX, minY, maxX, maxY } : null
}

/** Renders a single JSON-defined widget by type lookup. */
function WidgetRenderer({ widget, onUpdate, widgetRef, onRefreshGitHub, canRefreshGitHub, multiSelected, selected, onSelect }) {
  const Component = getWidgetComponent(widget.type)
  if (!Component) {
    console.warn(`[canvas] Unknown widget type: ${widget.type}`)
    return null
  }
  const resizable = (widget.type === 'terminal' || widget.type === 'agent')
    ? isTerminalResizable(widget.props?.agentId) && !!onUpdate
    : isResizable(widget.type) && !!onUpdate
  // Standard contract: every custom widget component receives these props.
  // selected / onSelect are especially important for chrome-disabled custom
  // widgets that own their visible UI and need to render their own select
  // affordance.
  const elementProps = {
    id: widget.id,
    props: widget.props,
    onUpdate,
    resizable,
    onRefreshGitHub,
    canRefreshGitHub,
    multiSelected,
    selected,
    onSelect,
  }
  if (Component.$$typeof === Symbol.for('react.forward_ref')) {
    elementProps.ref = widgetRef
  }
  return createElement(Component, elementProps)
}

/**
 * Wrapper for each JSON widget that holds its own ref for imperative actions.
 * This allows WidgetChrome to dispatch actions to the widget via ref.
 *
 * Memoized to prevent re-renders during zoom and unrelated state changes.
 */
const ChromeWrappedWidget = memo(function ChromeWrappedWidget({
  widget,
  selected,
  multiSelected,
  connectorCount,
  allWidgets,
  onSelect,
  onDeselect,
  onUpdate,
  onRemove,
  onCopy,
  onCopyWithConnectors,
  onRefreshGitHub,
  canRefreshGitHub,
  onConnectorDragStart,
  hubRoleOptions,
  defaultHubRole,
  onRoleChange,
  readOnly,
}) {
  const widgetRef = useRef(null)
  const setWidgetInstanceRef = useCallback((instance) => {
    widgetRef.current = instance
    setCanvasWidgetRef(widget.id, instance)
  }, [widget.id])

  useEffect(() => () => setCanvasWidgetRef(widget.id, null), [widget.id])

  const rawFeatures = getFeatures(widget.type, { isLocalDev: !readOnly })

  // Dynamically adjust features based on widget state
  const features = useMemo(() => {
    const isGitHub = !!widget.props?.github
    const isTerminalOrAgent = widget.type === 'terminal' || widget.type === 'agent'

    // Detect connected terminal/agent peers — used to gate hub-related features.
    // Hub role and broadcast are meaningless without a peer to coordinate with.
    let hasHubPeers = false
    let allBroadcastActive = true
    const broadcastConnectorIds = []
    if (isTerminalOrAgent) {
      const widgetConnectors = connectorCount || []
      const widgetList = allWidgets || []
      for (const conn of widgetConnectors) {
        const peerId = conn.start?.widgetId === widget.id ? conn.end?.widgetId : conn.start?.widgetId
        const peer = widgetList.find((w) => w.id === peerId)
        if (peer && (peer.type === 'terminal' || peer.type === 'agent')) {
          hasHubPeers = true
          broadcastConnectorIds.push(conn.id)
          if (conn.meta?.messagingMode !== 'two-way') allBroadcastActive = false
        }
      }
    }

    const adjusted = rawFeatures.map((f) => {
      // Toggle collapse label and hide when content is short (no github = no collapse)
      if (f.action === 'toggle-collapse') {
        if (widget.type === 'link-preview' && !isGitHub) return null
        return {
          ...f,
          label: widget.props?.collapsed ? 'Expand height' : 'Collapse height',
          icon: widget.props?.collapsed ? 'unfold' : 'fold',
        }
      }
      // Sticky note: text-scale toggle — reflect current state in the button
      if (f.action === 'toggle-text-scale') {
        const active = !!widget.props?.autoScaleText
        return {
          ...f,
          label: active ? 'Lock text size' : 'Scale text with size',
          active,
        }
      }
      // Hide refresh-github for non-GitHub link previews
      if (f.action === 'refresh-github' && !isGitHub) return null
      // Hide hub-role selector when terminal/agent has no connected peers —
      // a hub of one is not a hub.
      if (f.type === 'role-selector' && isTerminalOrAgent && !hasHubPeers) return null
      return f
    }).filter(Boolean)

    // Add dynamic "Split Screen" action when a connected split target exists.
    // Uses connectorCount/allWidgets props (reactive) instead of the global
    // bridge state which may be stale during React render.
    if (isExpandable(widget.type)) {
      const hasConnected = (connectorCount || []).some((c) => {
        const otherId = c.start?.widgetId === widget.id ? c.end?.widgetId : c.start?.widgetId
        const otherWidget = (allWidgets || []).find((w) => w.id === otherId)
        return otherWidget && isSplitScreenCapable(otherWidget.type)
      })
      if (hasConnected) {
        // Insert before the first menu-only feature
        const insertIdx = adjusted.findIndex((f) => f.menu)
        const splitFeature = {
          id: 'split-screen',
          type: 'action',
          action: 'split-screen',
          label: 'Split Screen',
          icon: 'columns',
          prod: true,
        }
        if (insertIdx >= 0) adjusted.splice(insertIdx, 0, splitFeature)
        else adjusted.push(splitFeature)
      }
    }

    // Add dynamic "Broadcast" toggle for terminal/agent widgets with connected peers
    if (isTerminalOrAgent && hasHubPeers) {
      const isActive = allBroadcastActive
      const insertIdx = adjusted.findIndex((f) => f.menu)
      const broadcastFeature = {
        id: 'broadcast',
        type: 'action',
        action: `broadcast-toggle:${broadcastConnectorIds.join(',')}:${isActive ? 'off' : 'on'}`,
        label: isActive ? 'Broadcast On' : 'Broadcast',
        icon: 'broadcast',
        active: isActive,
      }
      if (insertIdx >= 0) adjusted.splice(insertIdx, 0, broadcastFeature)
      else adjusted.push(broadcastFeature)
    }

    return adjusted
  }, [rawFeatures, widget.props?.github, widget.props?.collapsed, widget.props?.autoScaleText, widget.type, widget.id, connectorCount, allWidgets])

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleAction = useCallback((actionId, opts) => {
    if (actionId === 'delete') {
      const dc = getDeleteConfirm(widget.type)
      if (dc) {
        document.dispatchEvent(new CustomEvent('storyboard:canvas:request-delete-confirm', {
          detail: {
            title: dc.title,
            message: dc.message,
            confirmLabel: dc.confirmLabel,
            onConfirm: () => onRemove?.(widget.id),
          },
        }))
      } else {
        onRemove?.(widget.id)
      }
    } else if (actionId === 'copy') {
      if (opts?.altKey && onCopyWithConnectors) {
        onCopyWithConnectors(widget)
      } else {
        onCopy?.(widget)
      }
    } else if (actionId === 'copy-text') {
      const title = widget.props?.title || ''
      const body = widget.props?.text || widget.props?.content || widget.props?.github?.body || ''
      const text = title && body ? `# ${title}\n\n${body}` : title || body
      navigator.clipboard?.writeText(text).catch(() => {})
    } else if (actionId === 'open-external') {
      const url = widget.props?.url || widget.props?.src
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } else if (actionId === 'refresh-github') {
      const url = widget.props?.url
      if (url && onRefreshGitHub) onRefreshGitHub(widget.id, url)
    } else if (actionId === 'toggle-collapse') {
      const wasCollapsed = !!widget.props?.collapsed
      onUpdate?.(widget.id, { collapsed: !wasCollapsed })
      // When collapsing, pan viewport to center the widget
      if (!wasCollapsed) {
        requestAnimationFrame(() => {
          const el = document.getElementById(widget.id)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
      }
    } else if (actionId === 'toggle-text-scale') {
      // Sticky notes: flip the autoScaleText prop. When true, StickyNote
      // computes its font-size from the widget's area so text grows/shrinks
      // with resize. When false, font-size stays at the locked default.
      const wasOn = !!widget.props?.autoScaleText
      onUpdate?.(widget.id, { autoScaleText: !wasOn })
    } else if (actionId.startsWith('broadcast-toggle:')) {
      // broadcast-toggle:<connectorId1,connectorId2,...>:<on|off>
      const parts = actionId.split(':')
      const connectorIds = parts[1].split(',')
      const turnOn = parts[2] === 'on'
      const bridge = window.__storyboardCanvasBridgeState
      const canvasId = bridge?.canvasId || ''
      const meta = turnOn ? { messagingMode: 'two-way' } : { messagingMode: null }
      for (const cid of connectorIds) {
        updateConnectorApi(canvasId, cid, meta)
          .catch((err) => console.error('[canvas] Failed to toggle broadcast:', err))
      }
    }
  }, [widget, onRemove, onCopy, onCopyWithConnectors, onRefreshGitHub])

  const handleWidgetFieldUpdate = useCallback((updates) => {
    onUpdate?.(widget.id, updates)
  }, [onUpdate, widget.id])

  // Per-widget chrome + interaction switches from the (consumer-merged)
  // widget definition. Defaults match historical behavior, so core widgets
  // (sticky-note, image, terminal, etc.) are unaffected.
  const chromeOpts = useMemo(() => getChromeOptions(widget.type), [widget.type])
  const interactionOpts = useMemo(() => getInteractionOptions(widget.type), [widget.type])

  return (
    <WidgetChrome
      widgetId={widget.id}
      widgetType={widget.type}
      features={features}
      selected={selected}
      multiSelected={multiSelected}
      widgetProps={widget.props}
      widgetRef={widgetRef}
      onSelect={onSelect}
      onDeselect={onDeselect}
      onAction={handleAction}
      onUpdate={onUpdate ? handleWidgetFieldUpdate : undefined}
      onConnectorDragStart={onConnectorDragStart}
      roleOptions={hubRoleOptions}
      currentRole={widget.props?.role || defaultHubRole}
      onRoleChange={onRoleChange ? (roleId) => onRoleChange(widget.id, roleId) : undefined}
      readOnly={readOnly}
      chromeEnabled={chromeOpts.enabled}
      movable={isMovable(widget.type)}
      selectable={interactionOpts.selectable}
    >
      <WidgetRenderer
        widget={widget}
        onUpdate={onUpdate ? handleWidgetFieldUpdate : undefined}
        widgetRef={setWidgetInstanceRef}
        onRefreshGitHub={onRefreshGitHub}
        canRefreshGitHub={canRefreshGitHub}
        multiSelected={multiSelected}
        selected={selected}
        onSelect={onSelect}
      />
    </WidgetChrome>
  )
}, function chromeWidgetAreEqual(prev, next) {
  return (
    prev.widget === next.widget &&
    prev.selected === next.selected &&
    prev.multiSelected === next.multiSelected &&
    prev.connectorCount === next.connectorCount &&
    prev.allWidgets === next.allWidgets &&
    prev.readOnly === next.readOnly &&
    prev.onSelect === next.onSelect &&
    prev.onDeselect === next.onDeselect &&
    prev.onUpdate === next.onUpdate &&
    prev.onRemove === next.onRemove &&
    prev.onCopy === next.onCopy &&
    prev.onConnectorDragStart === next.onConnectorDragStart &&
    prev.hubRoleOptions === next.hubRoleOptions &&
    prev.defaultHubRole === next.defaultHubRole &&
    prev.onRoleChange === next.onRoleChange
  )
})

/**
 * Editable canvas/folder title — always visible, double-click to edit in dev mode.
 */
function CanvasTitleEditable({ canvasId, canvasMeta, canvas, isLocalDev }) {
  const [editing, setEditing] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const inputRef = useRef(null)
  const displayTitle = canvasMeta?.title || canvas?.title || canvasId.split('/').pop()

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleCommit = useCallback(async () => {
    const trimmed = titleValue.trim()
    setEditing(false)
    if (!trimmed || trimmed === displayTitle) return
    try {
      if (canvasId.includes('/')) {
        const folder = canvasId.split('/')[0]
        const result = await updateFolderMeta(folder, trimmed)
        if (result?.renamed && result?.folder) {
          // Folder was renamed on disk — navigate to new route
          const pageName = canvasId.split('/').slice(1).join('/')
          const newCanvasId = `${result.folder}/${pageName}`
          const base = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
          const targetUrl = `${base}/canvas/${newCanvasId}`
          if (import.meta.hot) {
            const timer = setTimeout(() => { window.location.href = targetUrl }, 3000)
            import.meta.hot.on('vite:beforeFullReload', () => {
              clearTimeout(timer)
              sessionStorage.setItem('sb-pending-navigate', targetUrl)
            })
          } else {
            setTimeout(() => { window.location.href = targetUrl }, 1000)
          }
          return
        }
      } else {
        await updateCanvas(canvasId, { settings: { title: trimmed } })
      }
      // Reload to pick up the updated metadata from the data plugin
      if (import.meta.hot) {
        const timer = setTimeout(() => { window.location.reload() }, 2000)
        import.meta.hot.on('vite:beforeFullReload', () => clearTimeout(timer))
      } else {
        setTimeout(() => { window.location.reload() }, 1000)
      }
    } catch (err) {
      console.error('Failed to update title:', err)
    }
  }, [titleValue, displayTitle, canvasId])

  const handleDblClick = useCallback(() => {
    if (!isLocalDev) return
    setTitleValue(displayTitle)
    setEditing(true)
  }, [isLocalDev, displayTitle])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.canvasTitleEditing}
        type="text"
        value={titleValue}
        onChange={(e) => setTitleValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleCommit() }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
        }}
        onBlur={handleCommit}
      />
    )
  }

  return (
    <h1
      className={styles.canvasTitleStatic}
      onDoubleClick={handleDblClick}
      style={isLocalDev ? { cursor: 'default' } : undefined}
    >
      {displayTitle}
    </h1>
  )
}

/**
 * Generic canvas page component.
 * Reads canvas data from the index and renders all widgets on a draggable surface.
 *
 * @param {{ canvasId: string }} props - Canvas name as indexed by the data plugin
 */
export default function CanvasPage({ canvasId: canvasIdProp, name, siblingPages = [], canvasMeta = null }) {
  const canvasId = canvasIdProp || name || ''
  const { canvas, jsxExports, jsxError, loading } = useCanvas(canvasId)
  const isLocalDev = typeof window !== 'undefined' && window.__SB_LOCAL_DEV__ === true && !new URLSearchParams(window.location.search).has('prodMode')

  // Local mutable copy of widgets for instant UI updates
  const [localWidgets, setLocalWidgets] = useState(canvas?.widgets ?? null)
  const [localConnectors, setLocalConnectors] = useState(canvas?.connectors ?? [])
  // Track widget/connector IDs the user has just deleted locally so the HMR
  // reconcile in the canvas-changed handler doesn't re-add them. Each ID is
  // pruned once a server push confirms it's gone OR after a 5s safety timeout.
  const pendingWidgetDeletionsRef = useRef(new Set())
  const pendingConnectorDeletionsRef = useRef(new Set())
  const markWidgetDeleted = useCallback((widgetId) => {
    if (!widgetId) return
    pendingWidgetDeletionsRef.current.add(widgetId)
    setTimeout(() => pendingWidgetDeletionsRef.current.delete(widgetId), 5000)
  }, [])
  const markConnectorDeleted = useCallback((connectorId) => {
    if (!connectorId) return
    pendingConnectorDeletionsRef.current.add(connectorId)
    setTimeout(() => pendingConnectorDeletionsRef.current.delete(connectorId), 5000)
  }, [])
  const [trackedCanvas, setTrackedCanvas] = useState(canvas)
  const [selectedWidgetIds, setSelectedWidgetIds] = useState(() => new Set())
  const initialViewport = loadViewportState(canvasId)
  const [zoom, setZoom] = useState(initialViewport?.zoom ?? 100)
  const zoomRef = useRef(initialViewport?.zoom ?? 100)
  const scrollRef = useRef(null)
  const zoomElRef = useRef(null)
  const zoomCommitTimer = useRef(null)
  const zoomEventTimer = useRef(null)
  const pendingScrollRestore = useRef(initialViewport)
  // Gate viewport persistence until initial positioning is complete.
  // Tracks which canvasId was last initialized — save effects only
  // write when this matches `canvasId`, preventing cross-canvas corruption.
  const viewportInitName = useRef(null)
  const [localSources, setLocalSources] = useState(canvas?.sources ?? [])
  const [canvasTheme, setCanvasTheme] = useState(() => resolveCanvasThemeFromStorage())
  const [snapEnabled, setSnapEnabled] = useState(canvas?.snapToGrid ?? false)
  const [snapGridSize, setSnapGridSize] = useState(canvas?.gridSize || 40)
  const [showGhInstallBanner, setShowGhInstallBanner] = useState(false)
  const [hubRoleOptions, setHubRoleOptions] = useState([])
  const [defaultHubRole, setDefaultHubRole] = useState('member')

  // Scroll lock: prevents focus-triggered scroll jumps when adding terminal/agent widgets.
  // The lock captures the current scroll position and forces it back on every scroll event
  // until unlocked by the widget's ready signal or a safety timeout.
  // Visual UI (outline + banner) only appears after 1.5s if still locked.

  // Canvas interaction overrides (scrollAxis lock, zoomGestures gate).
  // Advanced opt-in surface — see core/stores/canvasInteractionStore.js.
  // Subscribed via useSyncExternalStore so React re-renders when overrides
  // change at runtime. A ref mirror lets the wheel/touch handlers (which
  // attach with `[]` deps to avoid re-binding) read the latest values.
  const interaction = useSyncExternalStore(
    subscribeToCanvasInteraction,
    () => getCanvasInteractionSnapshot(),
    () => getCanvasInteractionSnapshot(),
  )
  void interaction // referenced so React subscribes; values read via the ref + getter below
  const interactionRef = useRef(getCanvasInteraction())
  // eslint-disable-next-line react-hooks/refs
  interactionRef.current = getCanvasInteraction()

  // Refs for snap settings (used by drop handler inside effect closure)
  const snapEnabledRef = useRef(snapEnabled)
  const snapGridSizeRef = useRef(snapGridSize)

  useEffect(() => {
    let cancelled = false
    async function loadRoles() {
      try {
        const data = await getHubRoles()
        if (cancelled) return
        setHubRoleOptions(Array.isArray(data?.roles) ? data.roles : [])
        const resolvedDefaultRole = typeof data?.defaultRoleId === 'string'
          ? data.defaultRoleId
          : (typeof data?.defaultRole === 'string' ? data.defaultRole : 'member')
        setDefaultHubRole(resolvedDefaultRole)
      } catch {
        if (cancelled) return
        setHubRoleOptions([])
        setDefaultHubRole('member')
      }
    }
    loadRoles()
    return () => { cancelled = true }
  }, [canvasId])

  // Track this canvas as a recent visit so it appears in the workspace
  // Recent tab and the command palette regardless of how the user arrived
  // (card click, command palette, direct URL, link from another canvas, …).
  useEffect(() => {
    if (!canvasId) return
    const label = canvasMeta?.title || canvas?.title || name || canvasId.split('/').pop() || canvasId
    trackRecentArtifact('canvas', canvasId, label)
  }, [canvasId, canvasMeta, canvas, name])

  // Centralized list of component export names.
  // When jsxExports is available, use it (discovers new exports not yet in sources).
  // When jsxExports is null (module import failed), fall back to sources so iframes
  // still render — the error is contained inside each iframe.
  const componentEntries = useMemo(() => {
    const sourceMap = Object.fromEntries(
      (localSources || []).filter((s) => s?.export).map((s) => [s.export, s]),
    )
    if (jsxExports) {
      return Object.keys(jsxExports).map((exportName) => ({
        exportName,
        Component: jsxExports[exportName],
        sourceData: sourceMap[exportName] || {},
      }))
    }
    // Fallback: use sources when module import failed (iframe isolation still works)
    if (jsxError && canvas?._jsxModule) {
      return (localSources || [])
        .filter((s) => s?.export)
        .map((s) => ({
          exportName: s.export,
          Component: null,
          sourceData: s,
        }))
    }
    return []
  }, [jsxExports, jsxError, localSources, canvas?._jsxModule])

  // Undo/redo history — tracks both widgets and sources as a combined snapshot
  const undoRedo = useUndoRedo()
  const stateRef = useRef({ widgets: localWidgets, sources: localSources, connectors: localConnectors })
  useEffect(() => {
    stateRef.current = { widgets: localWidgets, sources: localSources, connectors: localConnectors }
  }, [localWidgets, localSources, localConnectors])

  // Dirty flag — true while optimistic edits haven't been persisted yet.
  // Prevents HMR echoes from overwriting in-flight local state.
  const dirtyRef = useRef(false)

  // Counter of in-flight writes. dirtyRef is only cleared when this reaches 0,
  // preventing early clears when multiple writes are queued in sequence.
  const inflightWritesRef = useRef(0)

  // Grace period timer — after all writes complete, dirtyRef stays true for a
  // brief window to absorb delayed file-watcher HMR events that arrive after
  // the server's immediate push. Defense-in-depth for the write guard.
  const dirtyGraceTimerRef = useRef(null)

  // Serialized write queue — ensures JSONL events land in the right order
  const writeQueueRef = useRef(Promise.resolve())
  function queueWrite(fn) {
    clearTimeout(dirtyGraceTimerRef.current)
    inflightWritesRef.current += 1
    writeQueueRef.current = writeQueueRef.current
      .then(fn)
      .catch((err) => console.error('[canvas] Write queue error:', err))
      .finally(() => {
        inflightWritesRef.current -= 1
        if (inflightWritesRef.current < 0) {
          console.warn('[canvas] Write queue counter underflow — resetting')
          inflightWritesRef.current = 0
        }
        if (inflightWritesRef.current === 0) {
          // Grace period — absorb delayed watcher HMR events before clearing
          dirtyGraceTimerRef.current = setTimeout(() => {
            if (inflightWritesRef.current === 0) {
              dirtyRef.current = false
            }
          }, 600)
        }
      })
    return writeQueueRef.current
  }

  // Ref for selectedWidgetIds to avoid stale closures in callbacks
  const selectedIdsRef = useRef(selectedWidgetIds)
  useEffect(() => {
    selectedIdsRef.current = selectedWidgetIds
  }, [selectedWidgetIds])

  const isMultiSelected = selectedWidgetIds.size > 1

  /**
   * Selection handler — shift+click toggles in/out of multi-select set,
   * plain click single-selects (clears others).
   * Suppressed immediately after a multi-drag to prevent the post-drag
   * click from collapsing the selection.
   *
   * Side effect: selecting a widget that is currently in `done` agent
   * status flips it back to `running` (re-engaged by the user). The flip
   * goes through handleWidgetUpdate so it lands in the undo history —
   * Cmd+Z restores `done`.
   */
  const handleWidgetSelect = useCallback((widgetId, shiftKey) => {
    if (justDraggedRef.current) return
    if (shiftKey) {
      setSelectedWidgetIds(prev => {
        const next = new Set(prev)
        if (next.has(widgetId)) {
          next.delete(widgetId)
        } else {
          next.add(widgetId)
        }
        return next
      })
    } else {
      setSelectedWidgetIds(new Set([widgetId]))
    }
    // Re-engage a "done" agent on user-initiated selection.
    const widgets = stateRef.current.widgets ?? []
    const target = widgets.find((w) => w?.id === widgetId)
    if (target?.props?.status === 'done' && isAgentWidget(target)) {
      handleWidgetUpdateRef.current?.(widgetId, { status: 'running' })
    }
  }, [])

  // --- Multi-select drag: peers animate to new positions on drag end ---
  // During drag, only the dragged widget moves (via neodrag). On drag end,
  // peer widget positions are updated via React state, and we add the
  // tc-on-translation class so they animate smoothly to their new spots.
  const peerArticlesRef = useRef(new Map())
  // Flag to suppress the click-based selection reset that fires after a drag
  const justDraggedRef = useRef(false)

  const handleItemDragStart = useCallback((dragId) => {
    setWidgetDragging(true)
    const ids = selectedIdsRef.current
    peerArticlesRef.current.clear()
    if (ids.size <= 1 || !ids.has(dragId)) return

    // Suppress selection changes for the duration of the drag
    justDraggedRef.current = true // eslint-disable-line react-hooks/immutability

    // Collect peer article elements for transition on drag end
    for (const id of ids) {
      if (id === dragId) continue
      const widgetEl = document.getElementById(id)
      const article = widgetEl?.closest('article')
      if (!article) continue
      peerArticlesRef.current.set(id, article)
    }
  }, [])

  const handleItemDrag = useCallback(() => {
    // Peers stay put during drag — they animate on drag end
  }, [])

  /** Add transition class to peer articles so they animate to new positions. */
  const transitionPeers = useCallback(() => {
    for (const [, article] of peerArticlesRef.current) {
      article.classList.add('tc-on-translation')
    }
    // Remove class after animation completes
    const articles = [...peerArticlesRef.current.values()]
    setTimeout(() => {
      for (const article of articles) {
        article.classList.remove('tc-on-translation')
      }
    }, 150 + 50 + 200)
    peerArticlesRef.current.clear()
  }, [])

  const clearDragPreview = useCallback(() => {
    peerArticlesRef.current.clear()
  }, [])

  if (canvas !== trackedCanvas) {
    const isCanvasSwitch = trackedCanvas && canvas && trackedCanvas._route !== canvas._route
    if (getFlag('dev-logs')) console.log('[viewport] canvas changed —', isCanvasSwitch ? 'new canvas, resetting viewport' : 'same canvas, updating widgets only')
    setTrackedCanvas(canvas)

    // Skip replacing local state with server data when optimistic edits are
    // pending — the local state is more recent. The next save will persist it
    // and the subsequent server push (after dirty clears) will reconcile.
    // EXCEPTION: if the server push contains widgets/connectors we don't know
    // about locally, merge those in. Otherwise a stale local list would
    // overwrite freshly-created widgets (e.g. those just added via batch API
    // by an agent) on the next debounced save.
    if (!dirtyRef.current || isCanvasSwitch) {
      setLocalWidgets(canvas?.widgets ?? null)
      setLocalConnectors(canvas?.connectors ?? [])
      setLocalSources(canvas?.sources ?? [])
    } else {
      const serverWidgets = canvas?.widgets ?? []
      const serverConnectors = canvas?.connectors ?? []
      setLocalWidgets((prev) => {
        if (!prev) return serverWidgets
        const localIds = new Set(prev.map((w) => w.id))
        const pending = pendingWidgetDeletionsRef.current
        const additions = serverWidgets.filter((w) => !localIds.has(w.id) && !pending.has(w.id))
        return additions.length > 0 ? [...prev, ...additions] : prev
      })
      setLocalConnectors((prev) => {
        if (!prev || prev.length === 0) return serverConnectors.filter((c) => !pendingConnectorDeletionsRef.current.has(c.id))
        const localIds = new Set(prev.map((c) => c.id))
        const pending = pendingConnectorDeletionsRef.current
        const additions = serverConnectors.filter((c) => !localIds.has(c.id) && !pending.has(c.id))
        return additions.length > 0 ? [...prev, ...additions] : prev
      })
    }

    setSnapEnabled(canvas?.snapToGrid ?? false)
    setSnapGridSize(canvas?.gridSize || 40)
    if (isCanvasSwitch) {
      undoRedo.reset()
    }
    // Only reset viewport state when switching to a different canvas,
    // not when the same canvas refreshes with server data.
    if (isCanvasSwitch) {
      viewportInitName.current = null
      const newViewport = loadViewportState(canvasId)
      pendingScrollRestore.current = newViewport
      const newZoom = newViewport?.zoom ?? 100
      zoomRef.current = newZoom
      setZoom(newZoom)
    }
  }

  // Per-widget debounced PATCH. Each widget gets its own pending props
  // accumulator + timer so concurrent edits to different widgets don't stomp
  // on one another. Successful patches return event ids — we push them onto
  // the undo stack via undoRedo.trackMany so the toolbar Undo button targets
  // exactly the right granular events.
  const widgetPatchDebouncersRef = useRef(new Map())
  const flushAllPendingWidgetPatches = useCallback(() => {
    for (const entry of widgetPatchDebouncersRef.current.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
        entry.flushNow()
      }
    }
  }, [])
  const cancelAllPendingWidgetPatches = useCallback(() => {
    for (const entry of widgetPatchDebouncersRef.current.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
        entry.pendingProps = {}
      }
    }
  }, [])
  // patchWidgetDebounced(canvasId, widgetId, propsDelta) — coalesces multiple
  // PATCHes per widget within DEBOUNCE_MS into a single request.
  const patchWidgetDebounced = useCallback((targetCanvasId, widgetId, propsDelta) => {
    if (!widgetId || !propsDelta) return
    const map = widgetPatchDebouncersRef.current
    let entry = map.get(widgetId)
    if (!entry) {
      entry = {
        pendingProps: {},
        timer: null,
        flushNow: () => {
          const props = entry.pendingProps
          entry.pendingProps = {}
          if (Object.keys(props).length === 0) return
          dirtyRef.current = true
          queueWrite(async () => {
            try {
              const res = await patchWidgetApi(targetCanvasId, widgetId, { props })
              if (Array.isArray(res?.eventIds)) undoRedo.trackMany(res.eventIds)
            } catch (err) {
              console.error('[canvas] Failed to patch widget:', err)
            }
          })
        },
      }
      map.set(widgetId, entry)
    }
    Object.assign(entry.pendingProps, propsDelta)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      entry.flushNow()
    }, 500)
  }, [undoRedo])

  const handleWidgetUpdate = useCallback((widgetId, updates) => {
    // Snap width/height to grid when snap is enabled
    const snapped = { ...updates }
    if (snapEnabled && snapGridSize) {
      if (snapped.width != null) snapped.width = snapDimension(snapped.width, snapGridSize, true, 60)
      if (snapped.height != null) snapped.height = snapDimension(snapped.height, snapGridSize, true, 60)
    }
    // Guard against NaN values corrupting widget state
    if (typeof snapped.width === 'number' && Number.isNaN(snapped.width)) delete snapped.width
    if (typeof snapped.height === 'number' && Number.isNaN(snapped.height)) delete snapped.height
    setLocalWidgets((prev) => {
      if (!prev) return prev
      const next = prev.map((w) =>
        w.id === widgetId ? { ...w, props: { ...w.props, ...snapped } } : w
      )
      return next
    })
    dirtyRef.current = true
    patchWidgetDebounced(canvasId, widgetId, snapped)
  }, [canvasId, patchWidgetDebounced, snapEnabled, snapGridSize])

  // Stable ref so handleWidgetSelect can flip a "done" agent back to
  // "running" without re-creating itself on every widget update.
  const handleWidgetUpdateRef = useRef(handleWidgetUpdate)
  useEffect(() => { handleWidgetUpdateRef.current = handleWidgetUpdate }, [handleWidgetUpdate])

  const handleWidgetRoleChange = useCallback((widgetId, roleId) => {
    const targetRole = typeof roleId === 'string' && roleId ? roleId : defaultHubRole
    const roleMeta = hubRoleOptions.find((r) => r.id === targetRole) || null
    const defaultMeta = hubRoleOptions.find((r) => r.id === defaultHubRole) || null
    const fallbackRoleId = defaultMeta?.id || 'member'

    // Compute next state and batch ops up-front (outside the setState updater).
    // Doing this work inside `setLocalWidgets((prev) => …)` double-fires
    // queueWrite under React StrictMode in dev (the updater runs twice),
    // producing duplicate widget_updated events in the JSONL.
    const currentWidgets = stateRef.current.widgets ?? []
    const componentIds = getConnectedComponent(widgetId, localConnectors)
    const scopeHas = (id) => componentIds.has(id)
    const roleChanges = []  // { widgetId, role }
    const nextWidgets = currentWidgets.map((widget) => {
      if (widget.id === widgetId) {
        roleChanges.push({ widgetId: widget.id, role: targetRole })
        return { ...widget, props: { ...widget.props, role: targetRole } }
      }
      if (!roleMeta || roleMeta.type !== 'unique') return widget
      if (widget.type !== 'agent' && widget.type !== 'prompt') return widget
      if (!scopeHas(widget.id)) return widget
      if ((widget.props?.role || fallbackRoleId) !== targetRole) return widget
      roleChanges.push({ widgetId: widget.id, role: fallbackRoleId })
      return { ...widget, props: { ...widget.props, role: fallbackRoleId } }
    })

    if (roleChanges.length === 0) return

    dirtyRef.current = true
    setLocalWidgets(nextWidgets)
    // Persist as a single batch so undo restores all role flips atomically.
    const operations = roleChanges.map((c) => ({
      op: 'update-widget',
      widgetId: c.widgetId,
      props: { role: c.role },
    }))
    queueWrite(async () => {
      try {
        const res = await batchOperations(canvasId, operations)
        const ids = (res?.results || [])
          .map((r) => r?.eventId)
          .filter(Boolean)
        if (ids.length > 0) undoRedo.trackMany(ids)
      } catch (err) {
        console.error('[canvas] Failed to persist role change:', err)
      }
    })
  }, [canvasId, undoRedo, defaultHubRole, hubRoleOptions, localConnectors])

  const handleWidgetRemove = useCallback((widgetId) => {
    // Cancel any pending widget patches that target this widget — they
    // would race against the delete and leave a stale widget_updated event
    // in the JSONL.
    const debouncer = widgetPatchDebouncersRef.current.get(widgetId)
    if (debouncer?.timer) {
      clearTimeout(debouncer.timer)
      debouncer.timer = null
      debouncer.pendingProps = {}
    }

    markWidgetDeleted(widgetId)
    setLocalWidgets((prev) => prev ? prev.filter((w) => w.id !== widgetId) : prev)
    // Cascade: remove connectors referencing this widget. Compute the
    // orphan list outside the setState updater so the queueWrite calls
    // don't double-fire under React StrictMode in dev.
    const currentConnectors = stateRef.current.connectors ?? []
    const orphanedConnectors = currentConnectors.filter(
      (c) => c.start.widgetId === widgetId || c.end.widgetId === widgetId,
    )
    if (orphanedConnectors.length > 0) {
      const orphanIds = new Set(orphanedConnectors.map((c) => c.id))
      for (const c of orphanedConnectors) {
        markConnectorDeleted(c.id)
        queueWrite(async () => {
          try {
            const res = await removeConnectorApi(canvasId, c.id)
            if (res?.eventId) undoRedo.track(res.eventId)
          } catch (err) {
            console.error('[canvas] Failed to remove orphaned connector:', err)
          }
        })
      }
      setLocalConnectors((prev) => prev.filter((c) => !orphanIds.has(c.id)))
    }
    dirtyRef.current = true
    queueWrite(async () => {
      try {
        const res = await removeWidgetApi(canvasId, widgetId)
        if (res?.eventId) undoRedo.track(res.eventId)
      } catch (err) {
        console.error('[canvas] Failed to remove widget:', err)
      }
    })
  }, [canvasId, undoRedo, markWidgetDeleted, markConnectorDeleted])

  const handleConnectorAdd = useCallback(async ({ startWidgetId, startAnchor, endWidgetId, endAnchor }) => {
    try {
      const result = await addConnectorApi(canvasId, { startWidgetId, startAnchor, endWidgetId, endAnchor })
      if (result.success && result.connector) {
        setLocalConnectors((prev) => [...prev, result.connector])
        if (result.eventId) undoRedo.track(result.eventId)
      }
    } catch (err) {
      console.error('[canvas] Failed to add connector:', err)
    }
  }, [canvasId, undoRedo])

  /**
   * Alt+Click handler: create a connector from the selected widget to the clicked widget.
   * Automatically finds the shortest anchor pair between the two widgets.
   */
  const handleAltClickConnect = useCallback((targetWidgetId) => {
    const selectedArr = Array.from(selectedIdsRef.current)
    if (selectedArr.length !== 1) return
    const sourceId = selectedArr[0]
    if (sourceId === targetWidgetId) return

    const widgets = stateRef.current.widgets ?? []
    const sourceWidget = widgets.find((w) => w.id === sourceId)
    const targetWidget = widgets.find((w) => w.id === targetWidgetId)
    if (!sourceWidget || !targetWidget) return

    // Check if connection already exists
    const connectors = stateRef.current.connectors ?? []
    const alreadyConnected = connectors.some((c) =>
      (c.start?.widgetId === sourceId && c.end?.widgetId === targetWidgetId) ||
      (c.start?.widgetId === targetWidgetId && c.end?.widgetId === sourceId)
    )
    if (alreadyConnected) return

    const { startAnchor, endAnchor } = findBestAnchors(sourceWidget, targetWidget)
    handleConnectorAdd({
      startWidgetId: sourceId,
      startAnchor,
      endWidgetId: targetWidgetId,
      endAnchor,
    })
  }, [handleConnectorAdd])

  const handleConnectorRemove = useCallback((connectorId) => {
    markConnectorDeleted(connectorId)
    setLocalConnectors((prev) => prev.filter((c) => c.id !== connectorId))
    dirtyRef.current = true
    queueWrite(async () => {
      try {
        const res = await removeConnectorApi(canvasId, connectorId)
        if (res?.eventId) undoRedo.track(res.eventId)
      } catch (err) {
        console.error('[canvas] Failed to remove connector:', err)
      }
    })
  }, [canvasId, undoRedo, markConnectorDeleted])

  // Connector drag state
  const [connectorDrag, setConnectorDrag] = useState(null)
  const [widgetDragging, setWidgetDragging] = useState(false)

  const handleConnectorDragStart = useCallback((widgetId, anchor, e) => {
    e.stopPropagation()
    e.preventDefault()
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const scale = zoomRef.current / 100
    const rect = scrollEl.getBoundingClientRect()

    const widgets = stateRef.current.widgets ?? []
    const startWidget = widgets.find((w) => w.id === widgetId)
    if (!startWidget) return

    // Don't start drag from a disabled/unavailable anchor
    const srcAnchorState = getAnchorState(startWidget.type, anchor)
    if (srcAnchorState !== 'available') return

    const computeAnchorPt = (widget, anch) => {
      let ww, wh
      const el = document.getElementById(widget.id)
      if (el) {
        const inner = el.querySelector('[data-widget-id]') || el.firstElementChild
        if (inner) { ww = inner.offsetWidth; wh = inner.offsetHeight }
      }
      if (!ww) ww = widget.props?.width ?? widget.bounds?.width ?? 270
      if (!wh) wh = widget.props?.height ?? widget.bounds?.height ?? 170
      const px = widget.position?.x ?? 0
      const py = widget.position?.y ?? 0
      switch (anch) {
        case 'top':    return { x: px + ww / 2, y: py }
        case 'bottom': return { x: px + ww / 2, y: py + wh }
        case 'left':   return { x: px, y: py + wh / 2 }
        case 'right':  return { x: px + ww, y: py + wh / 2 }
        default:       return { x: px + ww / 2, y: py + wh / 2 }
      }
    }

    const startPt = computeAnchorPt(startWidget, anchor)

    const toCanvasPoint = (clientX, clientY) => ({
      x: (scrollEl.scrollLeft + clientX - rect.left) / scale,
      y: (scrollEl.scrollTop + clientY - rect.top) / scale,
    })

    // Find nearest anchor on any other widget within a rectangular snap zone.
    // Each anchor has a 30px-wide strip (15px each side) extending from the widget edge.
    const SNAP_EXTEND = 15
    const SNAP_DEPTH = 40
    const SNAP_CROSS = 20 // perpendicular expansion so you can approach from any direction
    const sourceType = startWidget.type
    const findNearestAnchor = (canvasPt) => {
      const currentWidgets = stateRef.current.widgets ?? []
      let best = null
      let bestDist = Infinity
      for (const w of currentWidgets) {
        if (w.id === widgetId) continue
        if (!canAcceptConnection(w.type, sourceType)) continue

        let ww, wh
        const el = document.getElementById(w.id)
        if (el) {
          const inner = el.querySelector('[data-widget-id]') || el.firstElementChild
          if (inner) { ww = inner.offsetWidth; wh = inner.offsetHeight }
        }
        if (!ww) ww = w.props?.width ?? w.bounds?.width ?? 270
        if (!wh) wh = w.props?.height ?? w.bounds?.height ?? 170
        const wx = w.position?.x ?? 0
        const wy = w.position?.y ?? 0

        // If the cursor is inside the widget's bounds (but not in any specific
        // edge anchor zone), treat all available anchors as candidates and pick
        // the nearest one. This way, dropping anywhere inside a widget always
        // produces a connection.
        const insideBounds =
          canvasPt.x >= wx && canvasPt.x <= wx + ww &&
          canvasPt.y >= wy && canvasPt.y <= wy + wh

        for (const anch of ['top', 'bottom', 'left', 'right']) {
          const anchorState = getAnchorState(w.type, anch)
          if (anchorState !== 'available') continue

          // Build a rectangular hit zone for this anchor
          let inZone = false
          if (anch === 'top') {
            inZone = canvasPt.x >= wx - SNAP_CROSS && canvasPt.x <= wx + ww + SNAP_CROSS &&
                     canvasPt.y >= wy - SNAP_DEPTH && canvasPt.y <= wy + SNAP_EXTEND
          } else if (anch === 'bottom') {
            inZone = canvasPt.x >= wx - SNAP_CROSS && canvasPt.x <= wx + ww + SNAP_CROSS &&
                     canvasPt.y >= wy + wh - SNAP_EXTEND && canvasPt.y <= wy + wh + SNAP_DEPTH
          } else if (anch === 'left') {
            inZone = canvasPt.x >= wx - SNAP_DEPTH && canvasPt.x <= wx + SNAP_EXTEND &&
                     canvasPt.y >= wy - SNAP_CROSS && canvasPt.y <= wy + wh + SNAP_CROSS
          } else if (anch === 'right') {
            inZone = canvasPt.x >= wx + ww - SNAP_EXTEND && canvasPt.x <= wx + ww + SNAP_DEPTH &&
                     canvasPt.y >= wy - SNAP_CROSS && canvasPt.y <= wy + wh + SNAP_CROSS
          }
          if (!inZone && !insideBounds) continue

          const pt = computeAnchorPt(w, anch)
          const dist = Math.hypot(pt.x - canvasPt.x, pt.y - canvasPt.y)
          if (dist < bestDist) {
            bestDist = dist
            best = { widgetId: w.id, anchor: anch, pt }
          }
        }
      }
      return best
    }

    const cursorPt = toCanvasPoint(e.clientX, e.clientY)
    const snap = findNearestAnchor(cursorPt)
    setConnectorDrag({
      startWidgetId: widgetId,
      startAnchor: anchor,
      startPt,
      endPt: snap ? snap.pt : cursorPt,
      endAnchor: snap ? snap.anchor : anchor,
      snapTarget: snap,
    })

    const handlePointerMove = (moveE) => {
      const pt = toCanvasPoint(moveE.clientX, moveE.clientY)
      const nearSnap = findNearestAnchor(pt)
      setConnectorDrag((prev) => prev ? {
        ...prev,
        endPt: nearSnap ? nearSnap.pt : pt,
        endAnchor: nearSnap ? nearSnap.anchor : prev.startAnchor,
        snapTarget: nearSnap,
      } : null)
    }

    const handlePointerUp = (upE) => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)

      const pt = toCanvasPoint(upE.clientX, upE.clientY)
      const nearSnap = findNearestAnchor(pt)

      if (nearSnap) {
        handleConnectorAdd({
          startWidgetId: widgetId,
          startAnchor: anchor,
          endWidgetId: nearSnap.widgetId,
          endAnchor: nearSnap.anchor,
        })
      }
      setConnectorDrag(null)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [handleConnectorAdd])

  // Endpoint drag removed — dragging from a filled anchor now always
  // creates a new connection via handleConnectorDragStart instead of
  // repositioning the existing one.

  const handleWidgetCopy = useCallback(async (widget) => {
    // Find the next free offset — check how many copies already exist at +n*40
    const baseX = widget.position?.x ?? 0
    const baseY = widget.position?.y ?? 0
    const occupied = new Set(
      (localWidgets ?? []).map((w) => `${w.position?.x ?? 0},${w.position?.y ?? 0}`)
    )
    let n = 1
    while (occupied.has(`${baseX + n * 40},${baseY + n * 40}`)) {
      n++
    }
    const position = { x: baseX + n * 40, y: baseY + n * 40 }
    const isTerminal = widget.type === 'terminal' || widget.type === 'agent'
    try {
      const copyProps = { ...widget.props }
      // Terminal widgets must get unique names — strip prettyName so the server generates a fresh one
      if (isTerminal) delete copyProps.prettyName
      // Image widgets: duplicate the asset file so each widget owns its own copy
      if (widget.type === 'image' && copyProps.src) {
        const dupResult = await duplicateImage(copyProps.src)
        if (dupResult.success) copyProps.src = dupResult.filename
      }

      const result = await addWidgetApi(canvasId, {
        type: widget.type,
        props: copyProps,
        position,
      })
      if (result.success && result.widget) {
        setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
        setSelectedWidgetIds(new Set([result.widget.id]))
        if (result.eventId) undoRedo.track(result.eventId)
      }
    } catch (err) {
      console.error('[canvas] Failed to copy widget:', err)
    }
  }, [canvasId, localWidgets, undoRedo])

  // Duplicate a single widget WITH its connectors (Alt+click on duplicate button)
  const handleWidgetCopyWithConnectors = useCallback(async (widget) => {
    if (!widget) return
    const widgets = [widget]

    const occupied = new Set(
      (localWidgets ?? []).map((w) => `${w.position?.x ?? 0},${w.position?.y ?? 0}`)
    )
    let offset = 1
    while (occupied.has(`${(widget.position?.x ?? 0) + offset * 40},${(widget.position?.y ?? 0) + offset * 40}`)) offset++

    const imageOverrides = new Map()
    if (widget.type === 'image' && widget.props?.src) {
      try {
        const dupResult = await duplicateImage(widget.props.src)
        if (dupResult.success) imageOverrides.set(widget.id, dupResult.filename)
      } catch { /* use original src as fallback */ }
    }

    const selectedIds = new Set([widget.id])
    const relevantConnectors = (localConnectors ?? []).filter(
      (c) => selectedIds.has(c.start?.widgetId) || selectedIds.has(c.end?.widgetId)
    )

    const ops = []
    for (const w of widgets) {
      const copyProps = { ...w.props }
      const isTerminal = w.type === 'terminal' || w.type === 'agent'
      if (isTerminal) delete copyProps.prettyName
      if (imageOverrides.has(w.id)) copyProps.src = imageOverrides.get(w.id)
      ops.push({
        op: 'create-widget',
        ref: `clone-${w.id}`,
        type: w.type,
        props: copyProps,
        position: {
          x: (w.position?.x ?? 0) + offset * 40,
          y: (w.position?.y ?? 0) + offset * 40,
        },
      })
    }

    for (const conn of relevantConnectors) {
      const startInSelection = selectedIds.has(conn.start?.widgetId)
      const endInSelection = selectedIds.has(conn.end?.widgetId)
      ops.push({
        op: 'create-connector',
        startWidgetId: startInSelection ? `$clone-${conn.start.widgetId}` : conn.start.widgetId,
        startAnchor: conn.start.anchor,
        endWidgetId: endInSelection ? `$clone-${conn.end.widgetId}` : conn.end.widgetId,
        endAnchor: conn.end.anchor,
        connectorType: conn.connectorType || 'default',
      })
    }

    try {
      const response = await batchOperations(canvasId, ops)
      if (!response.success) {
        console.error('[canvas] Batch duplicate failed:', response.error)
        return
      }

      const newWidgets = []
      const newConnectors = []
      const refMap = response.refs || {}
      const eventIds = []

      for (const result of response.results) {
        if (result.eventId) eventIds.push(result.eventId)
        if (result.op === 'create-widget' && result.widget) {
          newWidgets.push(result.widget)
        }
        if (result.op === 'create-connector' && result.connectorId) {
          const origOp = ops[result.index]
          const resolveId = (val) => {
            if (typeof val === 'string' && val.startsWith('$')) {
              return refMap[val.slice(1)] ?? val
            }
            return val
          }
          newConnectors.push({
            id: result.connectorId,
            type: 'connector',
            connectorType: origOp.connectorType || 'default',
            start: { widgetId: resolveId(origOp.startWidgetId), anchor: origOp.startAnchor },
            end: { widgetId: resolveId(origOp.endWidgetId), anchor: origOp.endAnchor },
            meta: {},
          })
        }
      }

      if (newWidgets.length > 0) {
        setLocalWidgets((prev) => appendLocalWidgets(prev, newWidgets))
        setSelectedWidgetIds(new Set(newWidgets.map((w) => w.id)))
      }
      if (newConnectors.length > 0) {
        setLocalConnectors((prev) => [...prev, ...newConnectors])
      }
      if (eventIds.length > 0) undoRedo.trackMany(eventIds)
    } catch (err) {
      console.error('[canvas] Failed to duplicate with connectors:', err)
    }
  }, [canvasId, localWidgets, localConnectors, undoRedo])

  // Duplicate all selected widgets in one undo step (Cmd+D)
  const handleDuplicateSelected = useCallback(async () => {
    const widgets = (localWidgets ?? []).filter((w) => selectedWidgetIds.has(w.id))
    if (widgets.length === 0) return

    // Compute occupied positions to find free offset
    const occupied = new Set(
      (localWidgets ?? []).map((w) => `${w.position?.x ?? 0},${w.position?.y ?? 0}`)
    )
    let offset = 1
    const anyOccupied = () => widgets.some((w) => {
      const bx = (w.position?.x ?? 0) + offset * 40
      const by = (w.position?.y ?? 0) + offset * 40
      return occupied.has(`${bx},${by}`)
    })
    while (anyOccupied()) offset++

    const newWidgets = []
    const eventIds = []
    for (const widget of widgets) {
      const position = {
        x: (widget.position?.x ?? 0) + offset * 40,
        y: (widget.position?.y ?? 0) + offset * 40,
      }
      const isTerminal = widget.type === 'terminal' || widget.type === 'agent'
      try {
        const copyProps = { ...widget.props }
        if (isTerminal) delete copyProps.prettyName
        if (widget.type === 'image' && copyProps.src) {
          try {
            const dupResult = await duplicateImage(copyProps.src)
            if (dupResult.success) copyProps.src = dupResult.filename
          } catch { /* use original src as fallback */ }
        }
        const result = await addWidgetApi(canvasId, {
          type: widget.type,
          props: copyProps,
          position,
        })
        if (result.success && result.widget) {
          newWidgets.push(result.widget)
          if (result.eventId) eventIds.push(result.eventId)
        }
      } catch (err) {
        console.error('[canvas] Failed to duplicate widget:', err)
      }
    }

    if (newWidgets.length > 0) {
      setLocalWidgets((prev) => appendLocalWidgets(prev, newWidgets))
      setSelectedWidgetIds(new Set(newWidgets.map((w) => w.id)))
    }
    if (eventIds.length > 0) undoRedo.trackMany(eventIds)
  }, [canvasId, localWidgets, selectedWidgetIds, undoRedo])

  // Duplicate selected widgets WITH connectors (Cmd+Shift+D)
  // Uses the batch API for atomic operation — all widgets and connectors
  // are created in a single request with $ref resolution.
  const handleDuplicateWithConnectors = useCallback(async () => {
    const widgets = (localWidgets ?? []).filter((w) => selectedWidgetIds.has(w.id))
    if (widgets.length === 0) return

    // Compute offset — same logic as handleDuplicateSelected
    const occupied = new Set(
      (localWidgets ?? []).map((w) => `${w.position?.x ?? 0},${w.position?.y ?? 0}`)
    )
    let offset = 1
    const anyOccupied = () => widgets.some((w) => {
      const bx = (w.position?.x ?? 0) + offset * 40
      const by = (w.position?.y ?? 0) + offset * 40
      return occupied.has(`${bx},${by}`)
    })
    while (anyOccupied()) offset++

    // Pre-process image widgets — duplicate asset files to get unique filenames
    const imageOverrides = new Map()
    for (const widget of widgets) {
      if (widget.type === 'image' && widget.props?.src) {
        try {
          const dupResult = await duplicateImage(widget.props.src)
          if (dupResult.success) imageOverrides.set(widget.id, dupResult.filename)
        } catch { /* use original src as fallback */ }
      }
    }

    // Find all connectors touching at least one selected widget
    const selectedIds = new Set(widgets.map((w) => w.id))
    const relevantConnectors = (localConnectors ?? []).filter(
      (c) => selectedIds.has(c.start?.widgetId) || selectedIds.has(c.end?.widgetId)
    )

    // Build batch operations
    const ops = []

    // 1. Create-widget ops with ref names for $ref resolution
    for (const widget of widgets) {
      const copyProps = { ...widget.props }
      const isTerminal = widget.type === 'terminal' || widget.type === 'agent'
      if (isTerminal) delete copyProps.prettyName
      if (imageOverrides.has(widget.id)) copyProps.src = imageOverrides.get(widget.id)

      ops.push({
        op: 'create-widget',
        ref: `clone-${widget.id}`,
        type: widget.type,
        props: copyProps,
        position: {
          x: (widget.position?.x ?? 0) + offset * 40,
          y: (widget.position?.y ?? 0) + offset * 40,
        },
      })
    }

    // 2. Create-connector ops — remap selected endpoints to $ref clones
    for (const conn of relevantConnectors) {
      const startInSelection = selectedIds.has(conn.start?.widgetId)
      const endInSelection = selectedIds.has(conn.end?.widgetId)

      ops.push({
        op: 'create-connector',
        startWidgetId: startInSelection ? `$clone-${conn.start.widgetId}` : conn.start.widgetId,
        startAnchor: conn.start.anchor,
        endWidgetId: endInSelection ? `$clone-${conn.end.widgetId}` : conn.end.widgetId,
        endAnchor: conn.end.anchor,
        connectorType: conn.connectorType || 'default',
      })
    }

    try {
      const response = await batchOperations(canvasId, ops)
      if (!response.success) {
        console.error('[canvas] Batch duplicate failed:', response.error)
        return
      }

      // Extract created widgets and connectors from results
      const newWidgets = []
      const newConnectors = []
      const refMap = response.refs || {}
      const eventIds = []

      for (const result of response.results) {
        if (result.eventId) eventIds.push(result.eventId)
        if (result.op === 'create-widget' && result.widget) {
          newWidgets.push(result.widget)
        }
        if (result.op === 'create-connector' && result.connectorId) {
          // Reconstruct connector object from the operation + resolved refs
          const origOp = ops[result.index]
          const resolveId = (val) => {
            if (typeof val === 'string' && val.startsWith('$')) {
              return refMap[val.slice(1)] ?? val
            }
            return val
          }
          newConnectors.push({
            id: result.connectorId,
            type: 'connector',
            connectorType: origOp.connectorType || 'default',
            start: { widgetId: resolveId(origOp.startWidgetId), anchor: origOp.startAnchor },
            end: { widgetId: resolveId(origOp.endWidgetId), anchor: origOp.endAnchor },
            meta: {},
          })
        }
      }

      if (newWidgets.length > 0) {
        setLocalWidgets((prev) => appendLocalWidgets(prev, newWidgets))
        setSelectedWidgetIds(new Set(newWidgets.map((w) => w.id)))
      }
      if (newConnectors.length > 0) {
        setLocalConnectors((prev) => [...prev, ...newConnectors])
      }
      if (eventIds.length > 0) undoRedo.trackMany(eventIds)
    } catch (err) {
      console.error('[canvas] Failed to duplicate with connectors:', err)
    }
  }, [canvasId, localWidgets, localConnectors, selectedWidgetIds, undoRedo])

  // Select all widgets (Cmd+A)
  const handleSelectAll = useCallback(() => {
    const allIds = (localWidgets ?? []).map((w) => w.id)
    if (allIds.length > 0) setSelectedWidgetIds(new Set(allIds))
  }, [localWidgets])

  const showMissingGhBanner = useCallback(() => {
    setShowGhInstallBanner(true)
  }, [])

  const buildGitHubPreviewUpdates = useCallback(async (url) => {
    try {
      const availability = await checkGitHubCliAvailable()
      if (!availability?.available) {
        showMissingGhBanner()
        return null
      }

      const result = await fetchGitHubEmbed(url)
      if (result?.code === 'gh_unavailable') {
        showMissingGhBanner()
        return null
      }
      if (!result?.success || !result?.snapshot) return null

      const snapshot = result.snapshot
      return {
        title: snapshot.title || '',
        width: 580,
        height: 400,
        github: {
          kind: snapshot.kind || 'issue',
          parentKind: snapshot.parentKind || snapshot.kind || 'issue',
          context: snapshot.context || '',
          body: snapshot.body || '',
          bodyHtml: snapshot.bodyHtml || '',
          authors: Array.isArray(snapshot.authors)
            ? snapshot.authors.filter((author) => typeof author === 'string' && author.trim())
            : [],
          createdAt: snapshot.createdAt ?? null,
          updatedAt: snapshot.updatedAt ?? null,
          // PR-specific metadata (state, branches, diff stats)
          state: snapshot.state ?? null,
          merged: typeof snapshot.merged === 'boolean' ? snapshot.merged : null,
          draft: typeof snapshot.draft === 'boolean' ? snapshot.draft : null,
          baseRef: typeof snapshot.baseRef === 'string' ? snapshot.baseRef : null,
          headRef: typeof snapshot.headRef === 'string' ? snapshot.headRef : null,
          additions: typeof snapshot.additions === 'number' ? snapshot.additions : null,
          deletions: typeof snapshot.deletions === 'number' ? snapshot.deletions : null,
          changedFiles: typeof snapshot.changedFiles === 'number' ? snapshot.changedFiles : null,
          fetchedAt: new Date().toISOString(),
        },
      }
    } catch (err) {
      console.error('[canvas] Failed to fetch GitHub embed metadata:', err)
      return null
    }
  }, [showMissingGhBanner])

  const handleRefreshGitHubWidget = useCallback(async (widgetId, url) => {
    if (!widgetId || !url) return { updated: false }
    const updates = await buildGitHubPreviewUpdates(url)
    if (!updates) return { updated: false }
    handleWidgetUpdate(widgetId, updates)
    return { updated: true }
  }, [buildGitHubPreviewUpdates, handleWidgetUpdate])

  const debouncedSourceSave = useRef(
    debounce((canvasId, sources, onResult) => {
      queueWrite(async () => {
        try {
          const res = await updateCanvas(canvasId, { sources })
          if (typeof onResult === 'function') onResult(res)
        } catch (err) {
          console.error('[canvas] Failed to save sources:', err)
        }
      })
    }, 2000)
  ).current

  const handleSourceUpdate = useCallback((exportName, updates) => {
    const snapped = { ...updates }
    if (snapEnabled && snapGridSize) {
      if (snapped.width != null) snapped.width = snapDimension(snapped.width, snapGridSize, true, 100)
      if (snapped.height != null) snapped.height = snapDimension(snapped.height, snapGridSize, true, 60)
    }
    // Compute next outside the updater so the debounced save isn't scheduled
    // twice under React StrictMode in dev.
    const currentSources = Array.isArray(stateRef.current.sources) ? stateRef.current.sources : []
    const nextSources = currentSources.some((s) => s?.export === exportName)
      ? currentSources.map((s) => (s?.export === exportName ? { ...s, ...snapped } : s))
      : [...currentSources, { export: exportName, ...snapped }]
    dirtyRef.current = true
    setLocalSources(nextSources)
    debouncedSourceSave(canvasId, nextSources)
  }, [canvasId, debouncedSourceSave, snapEnabled, snapGridSize])

  const handleItemDragEnd = useCallback((dragId, position) => {
    setWidgetDragging(false)
    if (!dragId || !position) {
      clearDragPreview()
      return
    }
    const rounded = { x: Math.max(0, roundPosition(position.x)), y: Math.max(0, roundPosition(position.y)) }

    const ids = selectedIdsRef.current
    // Multi-select move: apply same delta to all selected widgets
    // Checked BEFORE the jsx- early return so mixed selections work
    if (ids.size > 1 && ids.has(dragId)) {
      transitionPeers()
      // Suppress the click-based selection reset that fires after pointerup
      justDraggedRef.current = true // eslint-disable-line react-hooks/immutability
      requestAnimationFrame(() => { justDraggedRef.current = false })

      // Compute delta from the dragged widget's old position
      const isJsx = dragId.startsWith('jsx-')
      let oldPos = { x: 0, y: 0 }
      if (isJsx) {
        const sourceExport = dragId.replace(/^jsx-/, '')
        const source = (stateRef.current.sources ?? []).find(s => s?.export === sourceExport)
        oldPos = source?.position || { x: 0, y: 0 }
      } else {
        const draggedWidget = (stateRef.current.widgets ?? []).find(w => w.id === dragId)
        oldPos = draggedWidget?.position || { x: 0, y: 0 }
      }
      const dx = rounded.x - oldPos.x
      const dy = rounded.y - oldPos.y

      cancelAllPendingWidgetPatches()

      // Compute the new widgets array and batch ops up-front (outside the
      // setState updater). Doing this work inside `setLocalWidgets((prev) => …)`
      // double-fires queueWrite under React StrictMode in dev because the
      // updater is invoked twice — observed as duplicate widget_moved events
      // in the JSONL with prevPosition == position on the second batch.
      const currentWidgets = stateRef.current.widgets ?? []
      const widgetMoveOps = []
      const nextWidgets = currentWidgets.map((w) => {
        if (w.id === dragId) {
          widgetMoveOps.push({ op: 'move-widget', widgetId: w.id, position: rounded })
          return { ...w, position: rounded }
        }
        if (ids.has(w.id)) {
          const newPos = {
            x: Math.max(0, roundPosition((w.position?.x ?? 0) + dx)),
            y: Math.max(0, roundPosition((w.position?.y ?? 0) + dy)),
          }
          widgetMoveOps.push({ op: 'move-widget', widgetId: w.id, position: newPos })
          return { ...w, position: newPos }
        }
        return w
      })
      if (widgetMoveOps.length > 0) {
        dirtyRef.current = true
        setLocalWidgets(nextWidgets)
        queueWrite(async () => {
          try {
            const res = await batchOperations(canvasId, widgetMoveOps)
            const evIds = (res?.results || []).map((r) => r?.eventId).filter(Boolean)
            if (evIds.length > 0) undoRedo.trackMany(evIds)
          } catch (err) {
            console.error('[canvas] Failed to save multi-move:', err)
          }
        })
      }

      // Update JSX source positions — still a single source_updated event;
      // not yet wired to per-source undo tracking.
      const currentSources = Array.isArray(stateRef.current.sources) ? stateRef.current.sources : []
      let sourcesChanged = false
      const nextSources = currentSources.map((s) => {
        if (!s?.export) return s
        const sid = `jsx-${s.export}`
        if (sid === dragId) {
          sourcesChanged = true
          return { ...s, position: rounded }
        }
        if (ids.has(sid)) {
          sourcesChanged = true
          return {
            ...s,
            position: {
              x: Math.max(0, roundPosition((s.position?.x ?? 0) + dx)),
              y: Math.max(0, roundPosition((s.position?.y ?? 0) + dy)),
            },
          }
        }
        return s
      })
      if (sourcesChanged) {
        dirtyRef.current = true
        setLocalSources(nextSources)
        queueWrite(() =>
          updateCanvas(canvasId, { sources: nextSources })
            .catch((err) => console.error('[canvas] Failed to save multi-move sources:', err))
        )
      }
      return
    }

    if (dragId.startsWith('jsx-')) {
      const sourceExport = dragId.replace(/^jsx-/, '')
      // Compute next outside the updater so the queueWrite doesn't double-fire
      // under React StrictMode (see multi-move branch above for the same fix).
      const currentSources = Array.isArray(stateRef.current.sources) ? stateRef.current.sources : []
      const nextSources = currentSources.some((s) => s?.export === sourceExport)
        ? currentSources.map((s) => (s?.export === sourceExport ? { ...s, position: rounded } : s))
        : [...currentSources, { export: sourceExport, position: rounded }]
      dirtyRef.current = true
      setLocalSources(nextSources)
      queueWrite(() =>
        updateCanvas(canvasId, { sources: nextSources })
          .catch((err) => console.error('[canvas] Failed to save source position:', err))
      )
      return
    }

    // Single-widget move — granular PATCH /widget so the move is its own
    // undoable event.
    cancelAllPendingWidgetPatches()
    setLocalWidgets((prev) => {
      if (!prev) return prev
      const next = prev.map((w) =>
        w.id === dragId ? { ...w, position: rounded } : w
      )
      dirtyRef.current = true
      return next
    })
    queueWrite(async () => {
      try {
        const res = await patchWidgetApi(canvasId, dragId, { position: rounded })
        if (Array.isArray(res?.eventIds)) undoRedo.trackMany(res.eventIds)
      } catch (err) {
        console.error('[canvas] Failed to save widget position:', err)
      }
    })
  }, [canvasId, undoRedo, cancelAllPendingWidgetPatches, transitionPeers, clearDragPreview])

  // Keep zoomRef in sync when React state is set (e.g. by toolbar or zoom-to-fit)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // Cleanup zoom timers on unmount
  useEffect(() => () => {
    clearTimeout(zoomCommitTimer.current)
    clearTimeout(zoomEventTimer.current)
  }, [])

  // Restore scroll position from localStorage after first render.
  // When saved state is fresh (< 15 min), restore it. Otherwise zoom-to-fit
  // all objects so the user sees a useful overview instead of stale coordinates.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || loading) return
    const saved = pendingScrollRestore.current
    if (saved) {
      if (getFlag('dev-logs')) console.log('[viewport] restoring saved viewport — zoom:', saved.zoom, 'scroll:', saved.scrollLeft, saved.scrollTop)
      // Fresh saved viewport — restore exactly
      if (saved.scrollLeft != null) el.scrollLeft = saved.scrollLeft
      if (saved.scrollTop != null) el.scrollTop = saved.scrollTop
      pendingScrollRestore.current = null
    } else {
      if (getFlag('dev-logs')) console.log('[viewport] no saved viewport — fitting to objects')
      // No saved state or stale — zoom-to-fit all objects
      const bounds = computeCanvasBounds(localWidgets, componentEntries)
      if (bounds && el.clientWidth > 0 && el.clientHeight > 0) {
        const boxW = bounds.maxX - bounds.minX + FIT_PADDING * 2
        const boxH = bounds.maxY - bounds.minY + FIT_PADDING * 2
        const fitScale = Math.min(el.clientWidth / boxW, el.clientHeight / boxH)
        const { ZOOM_MIN: zMin, ZOOM_MAX: zMax } = zoomLimits()
        const fitZoom = Math.min(zMax, Math.max(zMin, Math.round(fitScale * 100)))
        const newScale = fitZoom / 100
        zoomRef.current = fitZoom
        // Imperative DOM update for initial zoom-to-fit — same path as applyZoom
        const zoomEl = zoomElRef.current
        if (zoomEl) {
          zoomEl.style.transform = `scale(${newScale})`
          zoomEl.style.width = getZoomLayoutWidth(newScale, interactionRef.current?.surface)
          zoomEl.style.height = getZoomLayoutHeight(newScale, interactionRef.current?.surface)
        }
        setZoom(fitZoom)
        el.scrollLeft = (bounds.minX - FIT_PADDING) * newScale
        el.scrollTop = (bounds.minY - FIT_PADDING) * newScale
      } else {
        el.scrollLeft = 0
        el.scrollTop = 0
      }
    }
    // Allow save effects for this canvas now that positioning is settled.
    viewportInitName.current = canvasId
  }, [canvasId, loading])

  // Center on a specific widget if `?widget=<id>` is in the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const targetId = params.get('widget')
    if (!targetId || loading) return

    const el = scrollRef.current
    if (!el) return

    let x, y, w, h

    // Check JSON widgets first
    const widgets = localWidgets ?? []
    const widget = widgets.find((wgt) => wgt.id === targetId)
    if (widget) {
      const fallback = WIDGET_FALLBACK_SIZES[widget.type] || { width: 200, height: 150 }
      x = widget.position?.x ?? 0
      y = widget.position?.y ?? 0
      w = widget.props?.width ?? fallback.width
      h = widget.props?.height ?? fallback.height
    }

    // Check JSX sources (jsx-ExportName)
    if (!widget && targetId.startsWith('jsx-')) {
      const exportName = targetId.slice(4)
      const entry = componentEntries.find((e) => e.exportName === exportName)
      if (entry) {
        const fallback = WIDGET_FALLBACK_SIZES['component']
        x = entry.sourceData?.position?.x ?? 0
        y = entry.sourceData?.position?.y ?? 0
        w = entry.sourceData?.width ?? fallback.width
        h = entry.sourceData?.height ?? fallback.height
      }
    }

    if (x == null) return

    const scale = zoomRef.current / 100
    el.scrollLeft = (x + w / 2) * scale - el.clientWidth / 2
    el.scrollTop = (y + h / 2) * scale - el.clientHeight / 2

    // Clean the URL param without triggering navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('widget')
    window.history.replaceState({}, '', url.toString())
  }, [loading, localWidgets, componentEntries])

  // Persist viewport state (zoom only) to localStorage on zoom changes.
  // Scroll position is persisted separately by the debounced scroll handler,
  // cleanup handler, and beforeunload — never here, because imperative zoom
  // operations (applyZoom, zoom-to-fit) adjust scroll AFTER setZoom, so the
  // scroll values would be stale at this point.
  useEffect(() => {
    if (viewportInitName.current !== canvasId) return
    const el = scrollRef.current
    if (getFlag('dev-logs')) console.log('[viewport] saving — zoom:', zoom, 'scroll:', el?.scrollLeft, el?.scrollTop)
    // Read current scroll so the zoom entry doesn't zero-out position,
    // but the authoritative scroll save comes from the scroll handler.
    saveViewportState(canvasId, {
      zoom,
      scrollLeft: el?.scrollLeft ?? 0,
      scrollTop: el?.scrollTop ?? 0,
    })
  }, [canvasId, zoom])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const saveNow = () => {
      if (viewportInitName.current !== canvasId) return
      saveViewportState(canvasId, {
        zoom: zoomRef.current,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
      })
    }
    const debouncedScrollSave = debounce(saveNow, 150)
    function handleScroll() {
      if (viewportInitName.current !== canvasId) return
      debouncedScrollSave()
    }
    el.addEventListener('scroll', handleScroll, { passive: true })

    // Flush viewport state on page unload so a refresh never misses it
    function handleBeforeUnload() {
      debouncedScrollSave.cancel()
      saveNow()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      debouncedScrollSave.cancel()
      el.removeEventListener('scroll', handleScroll)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // Save final state on cleanup (covers SPA navigation where
      // beforeunload doesn't fire).
      saveNow()
    }
  }, [canvasId, loading])

  // Gather current viewport data from refs (safe for callbacks/timeouts)
  const getViewportData = useCallback(() => {
    const el = scrollRef.current
    if (!el) return null
    const scale = zoomRef.current / 100
    const scrollLeft = el.scrollLeft
    const scrollTop = el.scrollTop
    const cw = el.clientWidth
    const ch = el.clientHeight
    return {
      centerX: Math.round((scrollLeft + cw / 2) / scale),
      centerY: Math.round((scrollTop + ch / 2) / scale),
      zoom: zoomRef.current,
      topLeftX: Math.round(scrollLeft / scale),
      topLeftY: Math.round(scrollTop / scale),
      width: Math.round(cw / scale),
      height: Math.round(ch / scale),
    }
  }, [])

  // Debounced viewport-changed HMR event — sends position/zoom to Vite server
  // so the selected-widgets bridge can write it to disk for agents.
  useEffect(() => {
    if (!import.meta.hot) return
    const el = scrollRef.current
    if (!el) return

    const tabId = selectionTabIdRef.current

    function sendViewport() {
      const viewport = getViewportData()
      if (viewport) {
        import.meta.hot.send('storyboard:viewport-changed', { tabId, canvasId, viewport })
      }
    }

    const debouncedSend = debounce(sendViewport, 500)

    function handleScroll() { debouncedSend() }
    el.addEventListener('scroll', handleScroll, { passive: true })

    // Also send on zoom commits (zoom state changes trigger this effect)
    sendViewport()

    return () => {
      debouncedSend.cancel()
      el.removeEventListener('scroll', handleScroll)
    }
  }, [canvasId, zoom, loading, getViewportData])

  /**
   * Zoom to a new level, anchoring on an optional client-space point.
   * When a cursor position is provided (e.g. from a wheel event), the
   * canvas point under the cursor stays fixed. Otherwise falls back to
   * the viewport center.
   *
   * Performs an imperative DOM mutation instead of a React state update
   * to avoid triggering a full re-render of the widget tree on every
   * zoom tick. React state is committed after a debounce for toolbar
   * display updates.
   */
  function applyZoom(newZoom, clientX, clientY) {
    const el = scrollRef.current
    const zoomEl = zoomElRef.current
    const { ZOOM_MIN, ZOOM_MAX } = zoomLimits()
    const clampedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom))

    if (!el || !zoomEl) {
      zoomRef.current = clampedZoom
      setZoom(clampedZoom)
      return
    }

    const oldScale = zoomRef.current / 100
    const newScale = clampedZoom / 100

    // Anchor point in scroll-container space.
    //
    // When a cursor position is supplied (wheel/pinch zoom), anchor there.
    // Otherwise (toolbar +/− and keyboard shortcuts) honor the configured
    // `canvas.zoom.origin`:
    //   - "center"   → viewport center (default; matches native canvas)
    //   - "top-left" → the scroll container's top-left, which keeps the
    //                  canvas's (0, 0) pinned to the viewport top-left
    //                  through any zoom — useful for landing canvases
    //                  with top-left-anchored content.
    const rect = el.getBoundingClientRect()
    const cursorProvided = clientX != null && clientY != null
    let anchorX
    let anchorY
    if (cursorProvided) {
      anchorX = clientX - rect.left
      anchorY = clientY - rect.top
    } else if (interactionRef.current?.zoomOrigin === 'top-left') {
      anchorX = 0
      anchorY = 0
    } else {
      anchorX = el.clientWidth / 2
      anchorY = el.clientHeight / 2
    }

    // Anchor → canvas coordinate
    const canvasX = (el.scrollLeft + anchorX) / oldScale
    const canvasY = (el.scrollTop + anchorY) / oldScale

    // Imperative DOM update — no React re-render
    zoomRef.current = clampedZoom
    zoomEl.style.transform = `scale(${newScale})`
    zoomEl.style.width = getZoomLayoutWidth(newScale, interactionRef.current?.surface)
    zoomEl.style.height = getZoomLayoutHeight(newScale, interactionRef.current?.surface)

    // Hint GPU compositing during active zoom
    zoomEl.dataset.zooming = ''

    // Scroll so the same canvas point stays under the anchor
    el.scrollLeft = canvasX * newScale - anchorX
    el.scrollTop = canvasY * newScale - anchorY

    // Debounced commit: update React state for toolbar display + persistence
    clearTimeout(zoomCommitTimer.current)
    zoomCommitTimer.current = setTimeout(() => {
      // Remove GPU compositing hint
      delete zoomEl.dataset.zooming
      setZoom(clampedZoom)
    }, 150)

    // Throttled zoom-changed event for external consumers (toolbar)
    if (!zoomEventTimer.current) {
      zoomEventTimer.current = setTimeout(() => {
        zoomEventTimer.current = null
        const bridge = window[CANVAS_BRIDGE_STATE_KEY] || {}
        bridge.active = true
        bridge.canvasId = canvasId
        bridge.zoom = zoomRef.current
        window[CANVAS_BRIDGE_STATE_KEY] = bridge
        document.dispatchEvent(new CustomEvent('storyboard:canvas:zoom-changed', {
          detail: { zoom: zoomRef.current }
        }))
      }, 100)
    }
  }

  // Signal canvas mount/unmount to CoreUIBar
  useEffect(() => {
    const bridge = window[CANVAS_BRIDGE_STATE_KEY] || {}
    bridge.active = true
    bridge.canvasId = canvasId
    bridge.zoom = zoomRef.current
    window[CANVAS_BRIDGE_STATE_KEY] = bridge
    document.dispatchEvent(new CustomEvent('storyboard:canvas:mounted', {
      detail: { canvasId, zoom: zoomRef.current }
    }))

    // While the canvas is active, suppress the browser's visual-viewport
    // pinch zoom across the entire page. CSS `touch-action: pan-x pan-y`
    // on `<html>` is honored by Android Chrome and desktop touch
    // surfaces; iOS Safari needs the JS `gesturestart` preventDefault
    // already installed on document. Restore the previous value on
    // unmount so prototype routes are unaffected.
    const htmlEl = document.documentElement
    const prevTouchAction = htmlEl.style.touchAction
    htmlEl.style.touchAction = 'pan-x pan-y'

    function handleStatusRequest() {
      const state = window[CANVAS_BRIDGE_STATE_KEY] || { active: true, canvasId, zoom: zoomRef.current }
      document.dispatchEvent(new CustomEvent('storyboard:canvas:status', { detail: state }))
    }

    document.addEventListener('storyboard:canvas:status-request', handleStatusRequest)

    return () => {
      document.removeEventListener('storyboard:canvas:status-request', handleStatusRequest)
      htmlEl.style.touchAction = prevTouchAction
      window[CANVAS_BRIDGE_STATE_KEY] = { active: false, canvasId: '', zoom: 100 }
      document.dispatchEvent(new CustomEvent('storyboard:canvas:unmounted'))
    }
  }, [canvasId])

  // Tell the Vite dev server to suppress full-reloads while this canvas is active.
  // Controlled by the "canvas-auto-reload" feature flag (default: false = guard ON).
  // When the flag is true, the guard is skipped so canvas pages receive HMR updates.
  // Sends a heartbeat every 3s so the guard auto-expires if the tab closes.
  // Re-syncs when the flag is toggled at runtime (e.g. from devtools menu).
  useEffect(() => {
    if (!import.meta.hot) return

    let interval = null

    function start() {
      if (interval) return
      const msg = { active: true }
      import.meta.hot.send('storyboard:canvas-hmr-guard', msg)
      interval = setInterval(() => {
        import.meta.hot.send('storyboard:canvas-hmr-guard', msg)
      }, 3000)
    }

    function stop() {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      import.meta.hot.send('storyboard:canvas-hmr-guard', { active: false })
    }

    function sync() {
      if (getFlag('canvas-auto-reload')) stop()
      else start()
    }

    sync()

    const unsub = subscribeToStorage(() => sync())

    return () => {
      stop()
      unsub()
    }
  }, [canvasId])

  // --- Selected widgets bridge ---
  // Writes .selectedwidgets.json so Copilot knows which canvas/widgets are active.
  // Uses a stable tabId to survive WebSocket reconnects.
  const selectionTabIdRef = useRef(Math.random().toString(36).slice(2, 10))

  // Gather selected widget data from refs (safe for callbacks/timeouts)
  const getSelectedWidgetData = useCallback(() => {
    const ids = [...selectedIdsRef.current]
    const widgets = (stateRef.current.widgets || [])
      .filter(w => ids.includes(w.id))
      .map(w => ({ id: w.id, type: w.type, props: w.props }))

    // Include jsx-* component selections
    for (const id of ids) {
      if (id.startsWith('jsx-') && !widgets.some(w => w.id === id)) {
        widgets.push({ id, type: 'component', props: { exportName: id.slice(4) } })
      }
    }

    return { widgetIds: ids, widgets }
  }, [])

  // Send focus event on mount, tab focus, and visibility change
  useEffect(() => {
    if (!import.meta.hot) return

    const tabId = selectionTabIdRef.current

    function sendFocus() {
      const { widgetIds, widgets } = getSelectedWidgetData()
      const viewport = getViewportData()
      import.meta.hot.send('storyboard:canvas-focused', { tabId, canvasId, widgetIds, widgets, viewport })
    }

    sendFocus()

    function handleVisibility() {
      if (!document.hidden) sendFocus()
    }
    function handleFocus() { sendFocus() }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      import.meta.hot.send('storyboard:canvas-unfocused', { tabId })
    }
  }, [canvasId, getSelectedWidgetData])

  // Debounced selection change (500ms) — reads from refs at fire time
  useEffect(() => {
    if (!import.meta.hot) return

    const tabId = selectionTabIdRef.current
    const timer = setTimeout(() => {
      const { widgetIds, widgets } = getSelectedWidgetData()
      const viewport = getViewportData()
      import.meta.hot.send('storyboard:selection-changed', { tabId, canvasId, widgetIds: widgetIds, widgets, viewport })
    }, 500)

    return () => clearTimeout(timer)
  }, [selectedWidgetIds, canvasId, getSelectedWidgetData])

  // Add a widget by type — used by CanvasControls and CoreUIBar event
  const addWidget = useCallback(async (type, extraProps = {}, { near, direction } = {}) => {
    const defaultProps = schemas[type] ? getDefaults(schemas[type]) : {}
    // For terminal/agent, apply config-based dimension defaults over schema defaults
    if (type === 'terminal' || type === 'agent') {
      const dims = getTerminalDimensions(extraProps.agentId, { width: defaultProps.width ?? 800, height: defaultProps.height ?? 450 })
      defaultProps.width = dims.width
      defaultProps.height = dims.height
    }
    const mergedProps = { ...defaultProps, ...extraProps }
    const center = getViewportCenter(scrollRef.current, zoomRef.current / 100)
    const pos = near ? undefined : centerPositionForWidget(center, type, mergedProps)
    try {
      const result = await addWidgetApi(canvasId, {
        type,
        props: mergedProps,
        position: pos,
        near,
        direction,
      })
      if (result.success && result.widget) {
        // Guard against duplicates: HMR may have already pushed the new widget
        // into localWidgets before the API response returns (race condition).
        setLocalWidgets((prev) => {
          const arr = prev || []
          if (arr.some((w) => w.id === result.widget.id)) return arr
          return [...arr, result.widget]
        })
        setSelectedWidgetIds(new Set([result.widget.id]))
        if (result.eventId) undoRedo.track(result.eventId)
      }
    } catch (err) {
      console.error('[canvas] Failed to add widget:', err)
    }
  }, [canvasId, undoRedo])

  // Add a story widget by storyId — used by CanvasControls story picker
  const addStoryWidget = useCallback(async (storyId) => {
    const storyProps = { storyId, exportName: '', width: 600, height: 400 }
    const center = getViewportCenter(scrollRef.current, zoomRef.current / 100)
    const pos = centerPositionForWidget(center, 'story', storyProps)
    try {
      const result = await addWidgetApi(canvasId, {
        type: 'story',
        props: storyProps,
        position: pos,
      })
      if (result.success && result.widget) {
        setLocalWidgets((prev) => {
          const arr = prev || []
          if (arr.some((w) => w.id === result.widget.id)) return arr
          return [...arr, result.widget]
        })
        setSelectedWidgetIds(new Set([result.widget.id]))
        if (result.eventId) undoRedo.track(result.eventId)
      }
    } catch (err) {
      console.error('[canvas] Failed to add story widget:', err)
    }
  }, [canvasId, undoRedo])

  // Listen for CoreUIBar add-widget and update-widget events
  useEffect(() => {
    function handleAddWidget(e) {
      const { type, props, near, direction } = e.detail
      addWidget(type, props, { near, direction })
    }
    function handleAddStoryWidget(e) {
      addStoryWidget(e.detail.storyId)
    }
    function handleUpdateWidget(e) {
      const { widgetId, updates } = e.detail || {}
      if (widgetId && updates) handleWidgetUpdate(widgetId, updates)
    }
    document.addEventListener('storyboard:canvas:add-widget', handleAddWidget)
    document.addEventListener('storyboard:canvas:add-story-widget', handleAddStoryWidget)
    document.addEventListener('storyboard:canvas:update-widget', handleUpdateWidget)
    return () => {
      document.removeEventListener('storyboard:canvas:add-widget', handleAddWidget)
      document.removeEventListener('storyboard:canvas:add-story-widget', handleAddStoryWidget)
      document.removeEventListener('storyboard:canvas:update-widget', handleUpdateWidget)
    }
  }, [addWidget, addStoryWidget, handleWidgetUpdate])

  // Listen for zoom changes from CoreUIBar
  useEffect(() => {
    function handleZoom(e) {
      const { zoom: newZoom } = e.detail
      if (typeof newZoom === 'number') {
        applyZoom(newZoom)
      }
    }
    document.addEventListener('storyboard:canvas:set-zoom', handleZoom)
    return () => document.removeEventListener('storyboard:canvas:set-zoom', handleZoom)
  }, [])

  // Listen for snap-to-grid toggle from CoreUIBar
  useEffect(() => {
    function handleSnapToggle() {
      setSnapEnabled((prev) => {
        const next = !prev
        updateCanvas(canvasId, { settings: { snapToGrid: next } }).catch((err) =>
          console.error('[canvas] Failed to persist snap setting:', err)
        )
        return next
      })
    }
    document.addEventListener('storyboard:canvas:toggle-snap', handleSnapToggle)
    return () => document.removeEventListener('storyboard:canvas:toggle-snap', handleSnapToggle)
  }, [canvasId])

  // Broadcast snap state to toolbar
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('storyboard:canvas:snap-state', {
      detail: { snapEnabled }
    }))
    snapEnabledRef.current = snapEnabled
  }, [snapEnabled])

  // Respond to snap-state requests from toolbar (handles mount-order race)
  useEffect(() => {
    function handleRequest() {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:snap-state', {
        detail: { snapEnabled: snapEnabledRef.current }
      }))
    }
    document.addEventListener('storyboard:canvas:snap-state-request', handleRequest)
    return () => document.removeEventListener('storyboard:canvas:snap-state-request', handleRequest)
  }, [])

  // Listen for gridSize from toolbar config
  useEffect(() => {
    function handleGridSize(e) {
      const size = e.detail?.gridSize
      if (typeof size === 'number' && size > 0) setSnapGridSize(size)
    }
    document.addEventListener('storyboard:canvas:grid-size', handleGridSize)
    return () => document.removeEventListener('storyboard:canvas:grid-size', handleGridSize)
  }, [])

  // Keep snapGridSize ref in sync for drop handler
  useEffect(() => {
    snapGridSizeRef.current = snapGridSize
  }, [snapGridSize])

  // Listen for zoom-to-fit from CoreUIBar
  useEffect(() => {
    function handleZoomToFit() {
      const el = scrollRef.current
      if (!el) return

      const bounds = computeCanvasBounds(localWidgets, componentEntries)
      if (!bounds) return

      const boxW = bounds.maxX - bounds.minX + FIT_PADDING * 2
      const boxH = bounds.maxY - bounds.minY + FIT_PADDING * 2

      const viewW = el.clientWidth
      const viewH = el.clientHeight

      // Find the zoom level that fits the bounding box in the viewport
      const fitScale = Math.min(viewW / boxW, viewH / boxH)
      const { ZOOM_MIN: zMin, ZOOM_MAX: zMax } = zoomLimits()
      const fitZoom = Math.min(zMax, Math.max(zMin, Math.round(fitScale * 100)))
      const newScale = fitZoom / 100

      // Imperative DOM update — same path as applyZoom
      zoomRef.current = fitZoom
      const zoomEl = zoomElRef.current
      if (zoomEl) {
        zoomEl.style.transform = `scale(${newScale})`
        zoomEl.style.width = getZoomLayoutWidth(newScale, interactionRef.current?.surface)
        zoomEl.style.height = getZoomLayoutHeight(newScale, interactionRef.current?.surface)
      }
      setZoom(fitZoom)

      // Scroll so the bounding box top-left (with padding) is at viewport top-left
      el.scrollLeft = (bounds.minX - FIT_PADDING) * newScale
      el.scrollTop = (bounds.minY - FIT_PADDING) * newScale

      // Persist after both zoom and scroll are settled
      if (viewportInitName.current === canvasId) {
        saveViewportState(canvasId, {
          zoom: fitZoom,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
        })
      }
    }
    document.addEventListener('storyboard:canvas:zoom-to-fit', handleZoomToFit)
    return () => document.removeEventListener('storyboard:canvas:zoom-to-fit', handleZoomToFit)
  }, [localWidgets, componentEntries])

  // ── Prototype fullscreen (immersive mode) ──────────────────────────
  const fullscreenWidgetRef = useRef(null)
  const fullscreenChromeWasHidden = useRef(false)

  useEffect(() => {
    function handlePrototypeFullscreen() {
      // EXIT: if already in fullscreen, signal exit (triggers animated close)
      if (fullscreenWidgetRef.current) {
        document.dispatchEvent(new CustomEvent('storyboard:canvas:widget-fullscreen-exit', {
          detail: { widgetId: fullscreenWidgetRef.current }
        }))
        fullscreenWidgetRef.current = null
        // Chrome restoration happens after fade-out animation in PrototypeEmbed onClose
        return
      }

      // ENTER: find selected prototype widget
      const selected = selectedIdsRef.current
      if (!selected || selected.size === 0) return

      const widgets = localWidgets ?? []
      let targetWidget = null
      for (const id of selected) {
        const w = widgets.find((w) => w.id === id)
        if (w && w.type === 'prototype') {
          targetWidget = w
          break
        }
      }
      if (!targetWidget) return

      fullscreenWidgetRef.current = targetWidget.id

      // Save current chrome state before hiding (so we can restore correctly on exit)
      fullscreenChromeWasHidden.current = document.documentElement.classList.contains('storyboard-chrome-hidden')

      // Hide toolbar
      document.documentElement.classList.add('storyboard-chrome-hidden')
      document.documentElement.classList.add('storyboard-chrome-completely-hidden')

      // Signal widget to enter fullscreen (renders fixed overlay with iframe)
      document.dispatchEvent(new CustomEvent('storyboard:canvas:widget-fullscreen', {
        detail: { widgetId: targetWidget.id }
      }))
    }

    function handleFullscreenExit() {
      // Only restore chrome if CanvasPage was the one that hid it (keyboard shortcut path)
      if (fullscreenWidgetRef.current && !fullscreenChromeWasHidden.current) {
        document.documentElement.classList.remove('storyboard-chrome-hidden')
        document.documentElement.classList.remove('storyboard-chrome-completely-hidden')
      }
      fullscreenWidgetRef.current = null
    }

    document.addEventListener('storyboard:canvas:prototype-fullscreen', handlePrototypeFullscreen)
    document.addEventListener('storyboard:canvas:widget-fullscreen-exit', handleFullscreenExit)
    document.addEventListener('storyboard:canvas:immersive-closed', handleFullscreenExit)
    return () => {
      document.removeEventListener('storyboard:canvas:prototype-fullscreen', handlePrototypeFullscreen)
      document.removeEventListener('storyboard:canvas:widget-fullscreen-exit', handleFullscreenExit)
      document.removeEventListener('storyboard:canvas:immersive-closed', handleFullscreenExit)
    }
  }, [localWidgets])

  // Canvas background should follow toolbar theme target.
  useEffect(() => {
    function readMode() {
      setCanvasTheme(resolveCanvasThemeFromStorage())
    }

    readMode()
    document.addEventListener('storyboard:theme:changed', readMode)
    return () => document.removeEventListener('storyboard:theme:changed', readMode)
  }, [])

  // Broadcast zoom level to CoreUIBar whenever it changes
  useEffect(() => {
    const bridge = window[CANVAS_BRIDGE_STATE_KEY] || {}
    bridge.active = true
    bridge.canvasId = canvasId
    bridge.zoom = zoom
    window[CANVAS_BRIDGE_STATE_KEY] = bridge
    document.dispatchEvent(new CustomEvent('storyboard:canvas:zoom-changed', {
      detail: { zoom }
    }))
  }, [canvasId, zoom])

  // Keep bridge in sync with widgets/connectors for expand features.
  // Child widgets now use props directly for split-screen gating, but
  // FigmaEmbed/PrototypeEmbed/etc. still read this bridge at expand time.
  useEffect(() => {
    const bridge = window[CANVAS_BRIDGE_STATE_KEY] || {}
    bridge.widgets = localWidgets
    bridge.connectors = localConnectors
    window[CANVAS_BRIDGE_STATE_KEY] = bridge
    // Notify subscribers (e.g. split-screen secondary panes) that the bridge
    // has fresh widget data so they can re-read live content.
    document.dispatchEvent(new CustomEvent('storyboard:canvas:bridge-updated'))
  }, [localWidgets, localConnectors])

  // ── Done agents: surface readiness in tab title + collab bar ──
  // Derives the list of agent widgets currently in `done` state from
  // localWidgets, broadcasts changes for AgentsReadyTrigger, prepends a
  // sparkle to document.title, and centers the viewport on a target
  // agent when the trigger asks (without selecting it).
  const doneAgents = useMemo(() => {
    const widgets = localWidgets ?? []
    const out = []
    for (const w of widgets) {
      if (!isAgentWidget(w)) continue
      if (w?.props?.status === 'done') {
        out.push({ id: w.id, type: w.type, alias: w.props?.alias || null })
      }
    }
    return out
  }, [localWidgets])

  const workingAgents = useMemo(() => {
    const widgets = localWidgets ?? []
    const out = []
    for (const w of widgets) {
      if (!isAgentWidget(w)) continue
      if (w?.props?.status === 'working') {
        out.push({ id: w.id, type: w.type, alias: w.props?.alias || null })
      }
    }
    return out
  }, [localWidgets])

  // Broadcast doneAgents to the collab bar (snapshots on demand too).
  useEffect(() => {
    const detail = { canvasId, doneAgents, workingAgents }
    document.dispatchEvent(new CustomEvent('storyboard:done-agents-changed', { detail }))
    function handleRequest() {
      document.dispatchEvent(new CustomEvent('storyboard:done-agents-changed', { detail }))
    }
    document.addEventListener('storyboard:done-agents-request', handleRequest)
    return () => document.removeEventListener('storyboard:done-agents-request', handleRequest)
  }, [canvasId, doneAgents, workingAgents])

  // Prepend ✳️ to the page title while any agent on this canvas is done.
  useEffect(() => {
    if (doneAgents.length === 0) return
    const original = document.title
    const sparkle = '✳️ '
    if (!original.startsWith(sparkle)) {
      document.title = sparkle + original
    }
    return () => { document.title = original }
  }, [doneAgents.length])

  // Persist agent status updates from the Hypercanvas server directly
  // on the matching widget. PromptWidget/TerminalWidget also subscribe
  // for their internal state, but routing through handleWidgetUpdate here
  // guarantees `props.status` lands in localWidgets — driving the
  // ✳️ title, the collab-bar count, and the green chrome outline.
  useEffect(() => {
    function handler(data) {
      const widgetId = data?.widgetId
      if (!widgetId) return
      const widgets = stateRef.current.widgets ?? []
      const widget = widgets.find((w) => w?.id === widgetId)
      if (!widget) return
      let nextStatus = null
      if (data.status === 'done' || data.status === 'completed') nextStatus = 'done'
      else if (data.status === 'error') nextStatus = 'error'
      else if (data.status === 'cancelled') nextStatus = 'idle'
      else if (data.status === 'working') nextStatus = 'working'
      else if (data.status === 'running' || data.status === 'pending') nextStatus = 'running'
      if (!nextStatus) return
      if (widget.props?.status === nextStatus) return
      const updates = { status: nextStatus }
      if (nextStatus === 'error' && data.message) updates.errorMessage = data.message
      handleWidgetUpdateRef.current?.(widgetId, updates)
    }
    storyboardWs.on('storyboard:agent-status', handler)
    return () => storyboardWs.off('storyboard:agent-status', handler)
  }, [])

  // Pan/zoom the viewport to center a specific widget without selecting it.
  // Mirrors the `?widget=<id>` URL handling. Used by AgentsReadyTrigger.
  useEffect(() => {
    function handleCenterOnWidget(e) {
      const targetId = e?.detail?.widgetId
      if (!targetId) return
      const el = scrollRef.current
      if (!el) return
      const widgets = localWidgets ?? []
      const widget = widgets.find((wgt) => wgt.id === targetId)
      if (!widget) return
      const fallback = WIDGET_FALLBACK_SIZES[widget.type] || { width: 200, height: 150 }
      const x = widget.position?.x ?? 0
      const y = widget.position?.y ?? 0
      const w = widget.props?.width ?? fallback.width
      const h = widget.props?.height ?? fallback.height

      // Zoom in (to at least 100%) so the agent is comfortably visible.
      const { ZOOM_MIN, ZOOM_MAX } = zoomLimits()
      const targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.max(zoomRef.current || 100, 100)))
      const newScale = targetZoom / 100
      if (targetZoom !== zoomRef.current) {
        zoomRef.current = targetZoom
        const zoomEl = zoomElRef.current
        if (zoomEl) {
          zoomEl.style.transform = `scale(${newScale})`
          zoomEl.style.width = getZoomLayoutWidth(newScale, interactionRef.current?.surface)
          zoomEl.style.height = getZoomLayoutHeight(newScale, interactionRef.current?.surface)
        }
        setZoom(targetZoom)
      }

      el.scrollTo({
        left: (x + w / 2) * newScale - el.clientWidth / 2,
        top: (y + h / 2) * newScale - el.clientHeight / 2,
        behavior: 'instant',
      })
    }
    document.addEventListener('storyboard:canvas:center-on-widget', handleCenterOnWidget)
    return () => document.removeEventListener('storyboard:canvas:center-on-widget', handleCenterOnWidget)
  }, [localWidgets])

  // Delete selected widget on Delete/Backspace key
  useEffect(() => {
    function handleSelectStart(e) {
      if (shouldPreventCanvasTextSelection(e.target)) {
        e.preventDefault()
      }
    }
    document.addEventListener('selectstart', handleSelectStart)
    return () => document.removeEventListener('selectstart', handleSelectStart)
  }, [])

  useEffect(() => {
    function handleKeyDown(e) {
      if (selectedWidgetIds.size === 0) return
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setSelectedWidgetIds(new Set())
      }
      // Copy shortcut (one or more widgets selected):
      // cmd+c → copy canvasId::id1,id2,... (for cross-canvas paste-duplicate)
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'c' && !e.shiftKey && selectedWidgetIds.size >= 1) {
        // Filter out non-duplicable widgets (jsx- component widgets are code)
        const copyableIds = [...selectedWidgetIds].filter(id => !id.startsWith('jsx-'))
        if (copyableIds.length > 0) {
          e.preventDefault()
          navigator.clipboard.writeText(`${canvasId}::${copyableIds.join(',')}`).catch(() => {})
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedWidgetIds.size > 1) {
          // Multi-delete — remove all via individual widget_removed events
          // (not widgets_replaced) to avoid the server's wipe guard and
          // ensure terminal sessions are properly orphaned per widget.
          cancelAllPendingWidgetPatches()
          const idsToRemove = new Set(selectedWidgetIds)
          // Mark deletions before mutating local state so the HMR merge
          // doesn't re-add them mid-flight.
          for (const id of idsToRemove) markWidgetDeleted(id)
          // Remove from local state immediately
          setLocalWidgets((prev) => prev ? prev.filter(w => !idsToRemove.has(w.id)) : prev)
          // Cascade-remove orphaned connectors. Compute outside the updater
          // so the per-orphan queueWrite calls don't double-fire under
          // React StrictMode in dev.
          const currentConnectors = stateRef.current.connectors ?? []
          const orphanedConnectors = currentConnectors.filter(
            (c) => idsToRemove.has(c.start.widgetId) || idsToRemove.has(c.end.widgetId),
          )
          if (orphanedConnectors.length > 0) {
            const orphanIds = new Set(orphanedConnectors.map((c) => c.id))
            for (const c of orphanedConnectors) {
              markConnectorDeleted(c.id)
              queueWrite(async () => {
                try {
                  const res = await removeConnectorApi(canvasId, c.id)
                  if (res?.eventId) undoRedo.track(res.eventId)
                } catch (err) {
                  console.error('[canvas] Failed to remove orphaned connector:', err)
                }
              })
            }
            setLocalConnectors((prev) => prev.filter((c) => !orphanIds.has(c.id)))
          }
          dirtyRef.current = true
          // Queue individual delete API calls
          for (const widgetId of idsToRemove) {
            queueWrite(async () => {
              try {
                const res = await removeWidgetApi(canvasId, widgetId)
                if (res?.eventId) undoRedo.track(res.eventId)
              } catch (err) {
                console.error('[canvas] Failed to remove widget in multi-delete:', err)
              }
            })
          }
        } else {
          const widgetId = [...selectedWidgetIds][0]
          if (widgetId) handleWidgetRemove(widgetId)
        }
        setSelectedWidgetIds(new Set())
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedWidgetIds, localWidgets, handleWidgetRemove, undoRedo, canvasId, cancelAllPendingWidgetPatches, markWidgetDeleted, markConnectorDeleted])

  // Ref to store processImageFile for use by drop effect
  const processImageFileRef = useRef(null)

  // Paste and drop handler — images become image widgets, same-origin URLs become prototypes,
  // other URLs become link previews, text becomes markdown
  useEffect(() => {
    const origin = window.location.origin
    const basePath = (import.meta.env?.BASE_URL || '/').replace(/\/$/, '')
    const pasteCtx = createPasteContext(origin, basePath)

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    }

    function getImageDimensions(dataUrl) {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => resolve({ width: 400, height: 300 })
        img.src = dataUrl
      })
    }

    /**
     * Process an image file (from paste or drop) and add it as a widget.
     * @param {File|Blob} file - Image file to process
     * @param {{ x: number, y: number }|null} position - Drop position, or null to use viewport center
     */
    async function processImageFile(file, position = null) {
      try {
        const dataUrl = await blobToDataUrl(file)
        const { width: natW, height: natH } = await getImageDimensions(dataUrl)

        // Display at 2x retina: halve natural dimensions, then cap at 600px
        const maxWidth = 600
        let displayW = Math.round(natW / 2)
        let displayH = Math.round(natH / 2)
        if (displayW > maxWidth) {
          displayH = Math.round(displayH * (maxWidth / displayW))
          displayW = maxWidth
        }

        const uploadResult = await uploadImage(dataUrl, canvasId)
        if (!uploadResult.success) {
          console.error('[canvas] Image upload failed:', uploadResult.error)
          return false
        }

        // Use provided position or fall back to viewport center
        let pos
        if (position) {
          pos = { x: position.x, y: position.y }
        } else {
          const center = getViewportCenter(scrollRef.current, zoomRef.current / 100)
          pos = centerPositionForWidget(center, 'image', { width: displayW, height: displayH })
        }

        const result = await addWidgetApi(canvasId, {
          type: 'image',
          props: { src: uploadResult.filename, private: false, width: displayW, height: displayH },
          position: pos,
        })
        if (result.success && result.widget) {
          setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
          setSelectedWidgetIds(new Set([result.widget.id]))
          navigator.clipboard?.writeText(result.widget.id).catch(() => {})
          if (result.eventId) undoRedo.track(result.eventId)
        }
        return true
      } catch (err) {
        console.error('[canvas] Failed to process image:', err)
        return false
      }
    }

    // Store in ref for use by drag/drop effect
    processImageFileRef.current = processImageFile

    async function handleImagePaste(e) {
      const items = e.clipboardData?.items
      if (!items) return false

      for (const item of items) {
        if (!item.type.startsWith('image/')) continue

        const blob = item.getAsFile()
        if (!blob) continue

        e.preventDefault()
        await processImageFile(blob, null)
        return true
      }
      return false
    }

    async function handlePaste(e) {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return

      // Image paste takes priority
      const handledImage = await handleImagePaste(e)
      if (handledImage) return

      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (!text) return

      // Detect canvasId::widgetId or canvasId::id1,id2,id3 format for widget duplication
      // Also supports legacy canvasId/widgetId for basenames without slashes,
      // but only when the second segment looks like a widget ID (type-hash).
      const widgetRefMatch = text.match(/^(.+)::([^:]+)$/) || (text.indexOf('::') === -1 && text.match(/^([^/]+)\/((?:sticky-note|markdown|prototype|link-preview|figma-embed|component|image)-[a-z0-9]+)$/))
      if (widgetRefMatch) {
        e.preventDefault()
        const [, sourceCanvas, sourceWidgetRef] = widgetRefMatch
        const sourceWidgetIds = sourceWidgetRef.split(',').filter(id => !id.startsWith('jsx-'))
        if (sourceWidgetIds.length === 0) return

        try {
          // Resolve source widgets in canvas order
          let sourceList
          if (sourceCanvas === canvasId) {
            sourceList = localWidgets ?? []
          } else {
            const canvasData = await getCanvasApi(sourceCanvas)
            sourceList = canvasData?.widgets ?? []
          }

          const sourceWidgets = sourceList.filter(w => sourceWidgetIds.includes(w.id))
          if (sourceWidgets.length === 0) return

          // Compute bounding box of source widgets for relative positioning
          const fallback = { width: 200, height: 150 }
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const w of sourceWidgets) {
            const wx = w.position?.x ?? 0
            const wy = w.position?.y ?? 0
            const ww = w.props?.width ?? WIDGET_FALLBACK_SIZES[w.type]?.width ?? fallback.width
            const wh = w.props?.height ?? WIDGET_FALLBACK_SIZES[w.type]?.height ?? fallback.height
            if (wx < minX) minX = wx
            if (wy < minY) minY = wy
            if (wx + ww > maxX) maxX = wx + ww
            if (wy + wh > maxY) maxY = wy + wh
          }
          const groupW = maxX - minX
          const groupH = maxY - minY

          // Center the group in the viewport
          const center = getViewportCenter(scrollRef.current, zoomRef.current / 100)
          const baseX = Math.round(center.x - groupW / 2)
          const baseY = Math.round(center.y - groupH / 2)

          // Paste all widgets, collecting new IDs for selection
          const newWidgets = []
          const eventIds = []
          for (const w of sourceWidgets) {
            const relX = (w.position?.x ?? 0) - minX
            const relY = (w.position?.y ?? 0) - minY
            const pasteProps = { ...w.props }
            if (w.type === 'terminal' || w.type === 'agent') delete pasteProps.prettyName
            // Image widgets: duplicate the asset so the paste owns its own copy
            if (w.type === 'image' && pasteProps.src) {
              try {
                const dupResult = await duplicateImage(pasteProps.src)
                if (dupResult.success) pasteProps.src = dupResult.filename
              } catch { /* use original src as fallback */ }
            }
            const result = await addWidgetApi(canvasId, {
              type: w.type,
              props: pasteProps,
              position: { x: baseX + relX, y: baseY + relY },
            })
            if (result.success && result.widget) {
              newWidgets.push(result.widget)
              if (result.eventId) eventIds.push(result.eventId)
            }
          }

          if (newWidgets.length > 0) {
            setLocalWidgets((prev) => appendLocalWidgets(prev, newWidgets))
            setSelectedWidgetIds(new Set(newWidgets.map(w => w.id)))
          }
          if (eventIds.length > 0) undoRedo.trackMany(eventIds)
        } catch (err) {
          console.error('[canvas] Failed to paste widget reference:', err)
        }
        // Always consume the ref — never fall through to markdown creation
        return
      }

      e.preventDefault()
      await pasteTextAsWidget(text, pasteCtx)
    }

    // Shared helper: resolve pasted text into a widget and add it to the canvas.
    // Used by both native paste and the programmatic paste-url event.
    async function pasteTextAsWidget(text, pasteCtx) {
      // Pre-check: does the pasted text look like a repo-relative file path?
      // If so, verify with the server and create a `file` widget instead of
      // running the URL-based paste rules. Path heuristic: no scheme, no
      // leading slash, no whitespace, contains a known text extension.
      if (
        /^[A-Za-z0-9._-][A-Za-z0-9./_-]*\.(md|markdown|mdx|jsx?|tsx?|json|css|scss|html?|ya?ml|svg|xml|toml|ini|env|sh|py|rb|go|rs|java|cpp|hpp|c|h|txt|log|config)$/i.test(text)
        && !text.startsWith('/')
        && !text.includes('://')
      ) {
        try {
          const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
          const res = await fetch(`${base}/_storyboard/file/exists?path=${encodeURIComponent(text)}`)
          const data = await res.json().catch(() => ({}))
          if (data?.exists) {
            const center = getViewportCenter(scrollRef.current, zoomRef.current / 100)
            const pos = centerPositionForWidget(center, 'file', { path: text })
            const result = await addWidgetApi(canvasId, {
              type: 'file',
              props: { path: text },
              position: pos,
            })
            if (result.success && result.widget) {
              setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
              setSelectedWidgetIds(new Set([result.widget.id]))
              if (result.eventId) undoRedo.track(result.eventId)
            }
            return
          }
        } catch {
          // Fall through to normal paste rules on error
        }
      }

      const resolved = resolvePaste(text, pasteCtx, getPasteRules())
      const siteResolved = await resolvePastedSite(text, pasteCtx)
      if (siteResolved) {
        if (siteResolved.type === 'site-create') {
          document.dispatchEvent(new CustomEvent('storyboard:open-site-create', { detail: siteResolved.props }))
        } else await addResolvedWidget(siteResolved)
        return
      }
      // A locally hosted site that isn't served by this Storyboard instance
      // should use the standard prototype iframe widget, which provides the
      // full embed chrome and interactions (resize, copy, fullscreen, split).
      const parsedUrl = pasteCtx.parseUrl(text)
      if (parsedUrl && isLocalSiteUrl(parsedUrl) && !pasteCtx.isSameOrigin(text)) {
        await addResolvedWidget({
          type: 'prototype',
          props: { src: text, width: 800, height: 600 },
        })
        return
      }
      if (!resolved) return
      let { type } = resolved
      let props = resolved.props

      // Component/story URLs → story widget (instead of prototype embed)
      if (type === 'prototype' && props?.src) {
        const srcPath = props.src.replace(/[?#].*$/, '').replace(/\/+$/, '')
        const storyId = storyRouteIndex.get(srcPath)
        if (storyId) {
          type = 'story'
          const parsed = pasteCtx.parseUrl(text)
          const searchParams = new URLSearchParams(parsed?.search || '')
          props = {
            storyId,
            exportName: searchParams.get('export') || '',
            width: 600,
            height: 400,
          }
        }
      }

      if (type === 'link-preview' && isGitHubEmbedUrl(props?.url || text)) {
        const githubUpdates = await buildGitHubPreviewUpdates(props?.url || text)
        if (githubUpdates) props = { ...props, ...githubUpdates }
      }

      await addResolvedWidget({ type, props })
    }

    async function resolvePastedSite(text, pasteCtx) {
      const parsed = pasteCtx.parseUrl(text)
      if (!parsed) return null
      try {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
        const response = await fetch(`${base}/_storyboard/site/list`)
        const data = await response.json()
        const sites = Array.isArray(data?.sites) ? data.sites : []
        // A Core viewer URL identifies a Site, but its route must come from
        // /sites/{id}/, never from the viewer's own path on the dev server.
        const viewerPath = pasteCtx.extractSrc(parsed.pathname)
        const viewerMatch = pasteCtx.isSameOrigin(parsed.href)
          ? viewerPath.match(/^\/sites\/([^/]+)(?:\/(.*))?$/)
          : null
        if (viewerMatch) {
          const site = sites.find(candidate => candidate.id === decodeURIComponent(viewerMatch[1]))
          if (site?.binding?.developmentBaseUrl) {
            const route = `${viewerMatch[2] || ''}${parsed.search}${parsed.hash}`
            return { type: 'site-frame', props: { siteId: site.id, route, title: site.title || site.id, width: 800, height: 600 } }
          }
          // A Core viewer URL cannot be registered as a new development
          // server when its Site no longer exists or is not bound.
          return null
        }
        if (isLocalSiteUrl(parsed)) {
          for (const candidate of sites) {
            const localUrl = candidate.binding?.developmentBaseUrl
            if (!localUrl || !candidate.id) continue
            const route = siteRouteForUrl(parsed.href, localUrl, candidate.id, { siteIdInUrl: false })
            if (route !== null) return { type: 'site-frame', props: { siteId: candidate.id, route, title: candidate.title || candidate.id, width: 800, height: 600 } }
          }
          if (!isSiteLoopbackUrl(parsed)) return null
          const unmatched = parseSiteUrl(parsed.href, { basePath: pasteCtx.basePath, siteIdInUrl: false })
          if (unmatched) return {
            type: 'site-create',
            props: {
              title: unmatched.siteId ? unmatched.siteId.split('-').map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ') : '',
              developmentBaseUrl: unmatched.baseUrl,
              route: unmatched.route,
            },
          }
          return null
        }
        for (const candidate of sites) {
          const productionUrl = candidate.deployments?.[candidate.defaultDeployment]?.baseUrl
          if (!productionUrl || !candidate.id) continue
          const route = siteRouteForUrl(parsed.href, productionUrl, candidate.id, { basePath: pasteCtx.basePath })
          if (route !== null) {
            return {
              type: 'prototype',
              props: { src: resolveSiteUrl(productionUrl, candidate.id, route), label: candidate.title || candidate.id, width: 800, height: 600 },
            }
          }
        }
        return null
      } catch { return null }
    }

    async function addResolvedWidget({ type, props }) {
      const center = getViewportCenter(scrollRef.current, zoomRef.current / 100)
      const pos = centerPositionForWidget(center, type, props)
      try {
        const result = await addWidgetApi(canvasId, {
          type,
          props,
          position: pos,
        })
        if (result.success && result.widget) {
          setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
          setSelectedWidgetIds(new Set([result.widget.id]))
          if (result.eventId) undoRedo.track(result.eventId)
        }
      } catch (err) {
        console.error('[canvas] Failed to add widget from paste:', err)
      }
    }

    // Listen for programmatic paste-url events from the command palette
    function handlePasteUrl(e) {
      const text = e.detail?.url?.trim()
      if (!text) return
      pasteTextAsWidget(text, pasteCtx)
    }

    function handleSiteCreatedFromPaste(event) {
      const site = event.detail?.site
      if (!site?.id) return
      void addResolvedWidget({
        type: 'site-frame',
        props: { siteId: site.id, route: event.detail?.route || '', title: site.title || site.id, width: 800, height: 600 },
      })
    }

    document.addEventListener('paste', handlePaste)
    document.addEventListener('storyboard:canvas:paste-url', handlePasteUrl)
    document.addEventListener('storyboard:site-created-from-paste', handleSiteCreatedFromPaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
      document.removeEventListener('storyboard:canvas:paste-url', handlePasteUrl)
      document.removeEventListener('storyboard:site-created-from-paste', handleSiteCreatedFromPaste)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, undoRedo, localWidgets])

  // --- Drag and drop handlers for images from Finder/file manager ---
  // Separate effect to ensure listeners attach after scroll container mounts (loading=false)
  useEffect(() => {
    if (loading) return // Don't attach until canvas is loaded and scroll container exists

    const scrollEl = scrollRef.current
    if (!scrollEl) return

    // Detect VSCode-style drags: dataTransfer carries text/uri-list URIs but
    // no actual File bytes. Without preventDefault, Chrome falls back to
    // navigating to the file:// URL and hits about:blank#blocked.
    function isUriListDrag(dt) {
      if (!dt?.types) return false
      return dt.types.includes('text/uri-list') || dt.types.includes('application/vnd.code.uri-list')
    }

    function handleDragOver(e) {
      const dt = e.dataTransfer
      const isUri = isUriListDrag(dt)
      const isFiles = dt?.types?.includes('Files')
      if (!isFiles && !isUri) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    // Bottom-center toast for failed drops — shared helper (also used by the
    // Notebook dialog) so rejection feedback looks identical everywhere.
    const showDropToast = showToast

    // Group rejection reasons into separate human-readable toasts (so we
    // don't conflate "outside repo" with "unsupported type" in one message).
    function reportRejections(rejections, { repoName } = {}) {
      if (rejections.length === 0) return
      const byReason = new Map()
      for (const r of rejections) {
        const key = r.reason || 'rejected'
        if (!byReason.has(key)) byReason.set(key, [])
        byReason.get(key).push(r)
      }
      for (const [key, items] of byReason) {
        if (key === 'outside_repo') {
          const repo = repoName || 'this'
          showDropToast(`Files outside the ${repo} repository can't be added to canvas`)
        } else if (key === 'unsupported') {
          const exts = [...new Set(items.map((it) => it.ext).filter(Boolean))]
          const list = exts.length ? exts.map((e) => `.${e}`).join(', ') : 'this'
          showDropToast(`Files of (${list}) type can't be added to canvas`)
        } else if (key === 'not_found') {
          showDropToast(`Dropped file could not be found on disk`)
        } else if (key === 'not_file') {
          showDropToast(`Dropped item is not a file`)
        } else if (key === 'invalid') {
          showDropToast(`Dropped file has an invalid path`)
        } else {
          showDropToast(`Dropped file rejected (${key})`)
        }
      }
    }

    // Read image natural dimensions from a URL (already-uploaded image),
    // mirroring the cap logic in processImageFile so VSCode-resolved images
    // size identically to Finder-dropped ones.
    function readDimensions(url) {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => resolve({ width: 400, height: 300 })
        img.src = url
      })
    }

    // Parse text/uri-list (RFC 2483): newline-separated, `#` comments ignored.
    // Filter to file:// URIs and decode to absolute filesystem paths.
    function parseUriList(text) {
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .filter((line) => line.startsWith('file://'))
        .map((line) => {
          try {
            return decodeURIComponent(new URL(line).pathname)
          } catch {
            return null
          }
        })
        .filter(Boolean)
    }

    async function handleDrop(e) {
      const dt = e.dataTransfer
      const hasFiles = dt?.types?.includes('Files') && dt.files?.length > 0
      const hasUriList = isUriListDrag(dt)
      if (!hasFiles && !hasUriList) return

      // Prevent browser default (opening file / navigating to file://) for any
      // drop we recognize, even if processing later fails.
      e.preventDefault()
      e.stopPropagation()

      // Convert drop coordinates to canvas coordinates (shared across branches)
      const rect = scrollEl.getBoundingClientRect()
      const scale = zoomRef.current / 100
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const canvasX = (scrollEl.scrollLeft + mouseX) / scale
      const canvasY = (scrollEl.scrollTop + mouseY) / scale
      const gridSize = snapGridSizeRef.current
      const shouldSnap = snapEnabledRef.current
      const snappedX = shouldSnap ? Math.round(canvasX / gridSize) * gridSize : Math.round(canvasX)
      const snappedY = shouldSnap ? Math.round(canvasY / gridSize) * gridSize : Math.round(canvasY)

      const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')

      // ── Branch A: native File drop (Finder, browser file picker) ─────────
      if (hasFiles) {
        const all = Array.from(dt.files)
        const imageFiles = all.filter((f) => f.type.startsWith('image/'))
        const textFiles = all.filter((f) => !f.type.startsWith('image/'))
        if (imageFiles.length === 0 && textFiles.length === 0) return

        for (let i = 0; i < imageFiles.length; i++) {
          const offset = shouldSnap ? i * gridSize : i * 24
          await processImageFileRef.current?.(imageFiles[i], { x: snappedX + offset, y: snappedY + offset })
        }

        // Process each text file: upload via /_storyboard/file/upload and
        // create a `file` widget pointing at the uploaded path.
        for (let i = 0; i < textFiles.length; i++) {
          const f = textFiles[i]
          const offset = shouldSnap ? (imageFiles.length + i) * gridSize : (imageFiles.length + i) * 24
          try {
            const content = await f.text()
            const upRes = await fetch(`${base}/_storyboard/file/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: f.name, content, encoding: 'utf-8' }),
            })
            const upData = await upRes.json().catch(() => ({}))
            if (!upRes.ok || !upData?.success || !upData?.path) {
              console.error('[canvas] File upload failed:', upData?.error || upRes.statusText)
              continue
            }
            const result = await addWidgetApi(canvasId, {
              type: 'file',
              props: { path: upData.path },
              position: { x: snappedX + offset, y: snappedY + offset },
            })
            if (result.success && result.widget) {
              setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
              setSelectedWidgetIds(new Set([result.widget.id]))
              if (result.eventId) undoRedo.track(result.eventId)
            }
          } catch (err) {
            console.error('[canvas] Failed to drop text file:', err)
          }
        }
        return
      }

      // ── Branch B: URI-list drop (VSCode Explorer) ────────────────────────
      // VSCode does not include File bytes. We only get text/uri-list with
      // file:// URIs. The server's /resolve endpoint validates each path is
      // inside the repo, copies images into assets/canvas/images, and tells
      // us what kind of widget to create.
      const uriListText =
        dt.getData('application/vnd.code.uri-list') ||
        dt.getData('text/uri-list') ||
        ''
      const absPaths = parseUriList(uriListText)
      if (absPaths.length === 0) return

      let resolveData
      try {
        const resolveRes = await fetch(`${base}/_storyboard/file/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: absPaths }),
        })
        resolveData = await resolveRes.json().catch(() => ({}))
        if (!resolveRes.ok || !Array.isArray(resolveData?.results)) {
          console.error('[canvas] /file/resolve failed:', resolveData?.error || resolveRes.statusText)
          showDropToast('Could not resolve dropped files')
          return
        }
      } catch (err) {
        console.error('[canvas] /file/resolve request failed:', err)
        showDropToast('Could not resolve dropped files')
        return
      }

      const rejections = []
      for (let i = 0; i < resolveData.results.length; i++) {
        const r = resolveData.results[i]
        const offset = shouldSnap ? i * gridSize : i * 24
        const pos = { x: snappedX + offset, y: snappedY + offset }
        if (!r.ok) {
          console.warn('[canvas] dropped file rejected:', r.reason, r.absPath)
          rejections.push(r)
          continue
        }
        if (r.kind === 'image') {
          const url = `${base}/_storyboard/canvas/images/${r.src}`
          const { width: natW, height: natH } = await readDimensions(url)
          const maxWidth = 600
          let displayW = Math.round(natW / 2)
          let displayH = Math.round(natH / 2)
          if (displayW > maxWidth) {
            displayH = Math.round(displayH * (maxWidth / displayW))
            displayW = maxWidth
          }
          const result = await addWidgetApi(canvasId, {
            type: 'image',
            props: { src: r.src, private: false, width: displayW, height: displayH },
            position: pos,
          })
          if (result.success && result.widget) {
            setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
            setSelectedWidgetIds(new Set([result.widget.id]))
            if (result.eventId) undoRedo.track(result.eventId)
          }
        } else if (r.kind === 'file') {
          const result = await addWidgetApi(canvasId, {
            type: 'file',
            props: { path: r.path },
            position: pos,
          })
          if (result.success && result.widget) {
            setLocalWidgets((prev) => appendLocalWidgets(prev, result.widget))
            setSelectedWidgetIds(new Set([result.widget.id]))
            if (result.eventId) undoRedo.track(result.eventId)
          }
        }
      }

      reportRejections(rejections, { repoName: resolveData.repoName })
    }

    scrollEl.addEventListener('dragover', handleDragOver)
    scrollEl.addEventListener('drop', handleDrop)

    return () => {
      scrollEl.removeEventListener('dragover', handleDragOver)
      scrollEl.removeEventListener('drop', handleDrop)
    }
  }, [loading])

  // --- Undo / Redo ---
  // Server-authoritative: POST /undo / POST /redo append an inverse event
  // to the JSONL. We apply the returned inverseEvent to local state
  // immediately — the HMR push that follows the server's append would
  // otherwise be ignored by the dirty-guard above (writes are in flight,
  // so HMR pushes only merge *new* widgets / connectors and skip updates
  // to existing ones). Applying optimistically guarantees the user sees
  // the change without waiting for the next non-dirty HMR push.
  //
  // 404 handling: if the server can't find the target event, it was almost
  // certainly compacted away (compaction collapses history into a single
  // canvas_created baseline). We clear the per-tab stack so the toolbar
  // button greys out instead of silently no-op'ing on every click.
  //
  // Ordering: popUndo / popRedo run *inside* queueWrite — after any
  // in-flight PATCH / batch writes have resolved and called track() with
  // their server-issued event ids. Popping synchronously here would race
  // against the trackMany() callbacks of recently-fired drags or edits
  // and pop the previous event id instead of the latest one (visible in
  // the JSONL as undo entries appearing in the wrong order, e.g. undoing
  // the second-to-last drag before the last one).
  const applyInverseEventLocally = useCallback((inverseEvent) => {
    if (!inverseEvent || typeof inverseEvent !== 'object') return
    const before = {
      widgets: stateRef.current.widgets ?? [],
      connectors: stateRef.current.connectors ?? [],
      sources: stateRef.current.sources ?? [],
    }
    const after = applyCanvasEvent(before, inverseEvent)
    if (after.widgets !== before.widgets) setLocalWidgets(after.widgets)
    if (after.connectors !== before.connectors) setLocalConnectors(after.connectors)
    if (after.sources !== before.sources) setLocalSources(after.sources)
  }, [])

  const handleUndo = useCallback(() => {
    flushAllPendingWidgetPatches()
    debouncedSourceSave.cancel()
    dirtyRef.current = true
    queueWrite(async () => {
      const eventId = undoRedo.popUndo()
      if (!eventId) return
      try {
        const { status, data } = await undoEventApi(canvasId, eventId)
        if (status === 404) {
          console.warn('[canvas] Undo target was compacted away — resetting undo stack')
          undoRedo.reset()
          return
        }
        if (data?.eventId) undoRedo.pushRedo(data.eventId)
        else if (data?.error) console.error('[canvas] Undo rejected:', data.error)
        if (data?.inverseEvent) applyInverseEventLocally(data.inverseEvent)
      } catch (err) {
        console.error('[canvas] Failed to persist undo:', err)
      }
    })
  }, [canvasId, debouncedSourceSave, flushAllPendingWidgetPatches, undoRedo, applyInverseEventLocally])

  const handleRedo = useCallback(() => {
    flushAllPendingWidgetPatches()
    debouncedSourceSave.cancel()
    dirtyRef.current = true
    queueWrite(async () => {
      const eventId = undoRedo.popRedo()
      if (!eventId) return
      try {
        const { status, data } = await redoEventApi(canvasId, eventId)
        if (status === 404) {
          console.warn('[canvas] Redo target was compacted away — resetting redo stack')
          undoRedo.reset()
          return
        }
        if (data?.eventId) undoRedo.pushUndo(data.eventId)
        else if (data?.error) console.error('[canvas] Redo rejected:', data.error)
        if (data?.inverseEvent) applyInverseEventLocally(data.inverseEvent)
      } catch (err) {
        console.error('[canvas] Failed to persist redo:', err)
      }
    })
  }, [canvasId, debouncedSourceSave, flushAllPendingWidgetPatches, undoRedo, applyInverseEventLocally])

  // Keyboard shortcuts — dev-only (Cmd+Z / Cmd+Shift+Z / Cmd+D / Cmd+A).
  // Listen in capture phase: xterm.js / ghostty-web call stopPropagation
  // on keydown so a bubble-phase document listener never sees keystrokes
  // from a focused terminal. Capture phase fires before any descendant
  // can stop the event, letting us route Cmd+Z to canvas-undo even when
  // a selected terminal/agent widget owns focus.
  useEffect(() => {
    if (!import.meta.hot) return
    function handleKeyDown(e) {
      const tag = e.target.tagName
      // Bail when focus is inside a real text/code editor so we don't
      // steal the editor's own undo/redo. xterm.js / ghostty-web use
      // a contenteditable wrapper for keystroke plumbing (not a real
      // editor) — Cmd+Z there must go to the canvas, otherwise undoing
      // a multi-move with a selected terminal/agent widget silently
      // no-ops because focus lives in the xterm container.
      const inTerminal = e.target.closest?.('[class*="xtermContainer"]') != null
      if (!inTerminal) {
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      } else {
        // Terminal: still respect real form inputs (e.g. a popover INPUT
        // inside the terminal widget chrome), just not the xterm wrapper itself.
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
      }
      // Don't intercept shortcuts when the command palette is open
      if (e.target.closest?.('[cmdk-root]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        handleUndo()
      }
      if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        handleRedo()
      }
      if (mod && e.key.toLowerCase() === 'd' && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        handleDuplicateWithConnectors()
      } else if (mod && e.key.toLowerCase() === 'd' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        handleDuplicateSelected()
      }
      if (mod && e.key === 'a') {
        e.preventDefault()
        e.stopPropagation()
        handleSelectAll()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleUndo, handleRedo, handleDuplicateSelected, handleDuplicateWithConnectors, handleSelectAll])

  // Listen for undo/redo from CoreUIBar
  useEffect(() => {
    function handleUndoEvent() { handleUndo() }
    function handleRedoEvent() { handleRedo() }
    document.addEventListener('storyboard:canvas:undo', handleUndoEvent)
    document.addEventListener('storyboard:canvas:redo', handleRedoEvent)
    return () => {
      document.removeEventListener('storyboard:canvas:undo', handleUndoEvent)
      document.removeEventListener('storyboard:canvas:redo', handleRedoEvent)
    }
  }, [handleUndo, handleRedo])

  // Broadcast undo/redo availability to toolbar
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('storyboard:canvas:undo-redo-state', {
      detail: { canUndo: undoRedo.canUndo, canRedo: undoRedo.canRedo }
    }))
  }, [undoRedo.canUndo, undoRedo.canRedo])

  // Cmd+scroll / trackpad pinch to smooth-zoom the canvas.
  // On macOS, pinch-to-zoom fires wheel events with ctrlKey: true and small
  // fractional deltaY values. We accumulate the delta to handle sub-pixel changes.
  // Skipped entirely when the consumer disables zoomGestures (e.g. landing page).
  //
  // Anchor policy: by default, zoom honors `canvas.zoom.origin` (center or
  // top-left) — same anchor as toolbar/keyboard zoom, so a user zooming
  // out from the corner of the screen doesn't get teleported off-canvas.
  // Hold Alt while cmd+scrolling to opt into cursor-anchor zoom (power
  // user gesture: zoom centered on whatever you're hovering).
  const zoomAccum = useRef(0)
  useEffect(() => {
    function handleWheel(e) {
      if (!e.metaKey && !e.ctrlKey) return
      if (!interactionRef.current.zoomGestures) return
      e.preventDefault()
      zoomAccum.current += -e.deltaY
      const step = Math.trunc(zoomAccum.current)
      if (step === 0) return
      zoomAccum.current -= step
      if (e.altKey) {
        applyZoom(zoomRef.current + step, e.clientX, e.clientY)
      } else {
        applyZoom(zoomRef.current + step)
      }
    }
    document.addEventListener('wheel', handleWheel, { passive: false })
    return () => document.removeEventListener('wheel', handleWheel)
  }, [])

  // Receive cmd+wheel events forwarded from prototype/story iframes
  useEffect(() => {
    function handleMessage(e) {
      if (e.data?.type !== 'storyboard:embed:wheel') return
      if (!interactionRef.current.zoomGestures) return
      zoomAccum.current += -e.data.deltaY
      const step = Math.trunc(zoomAccum.current)
      if (step === 0) return
      zoomAccum.current -= step
      applyZoom(zoomRef.current + step)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Touch pinch-to-zoom for mobile — two-finger pinch zooms the canvas.
  //
  // Bound to `document` (not the canvas scroller) so a pinch that starts
  // anywhere — toolbar buttons, side panels, the canvas surface — drives
  // our custom zoom instead of the browser's visual-viewport zoom (which
  // would scale the entire UI, controls and all). The `touch-action`
  // rules on `.canvasScroll` block the browser pinch on the surface
  // itself; the `gesturestart` preventDefault blocks Safari's older
  // gesture event family (iOS ignores `user-scalable=no` in newer
  // releases as an accessibility allowance, so we have to suppress
  // pinch ourselves at the JS level).
  const pinchState = useRef({ active: false, startDist: 0, startZoom: 0, centerX: 0, centerY: 0 })
  useEffect(() => {
    function getTouchDist(t1, t2) {
      const dx = t1.clientX - t2.clientX
      const dy = t1.clientY - t2.clientY
      return Math.sqrt(dx * dx + dy * dy)
    }

    function handleTouchStart(e) {
      if (e.touches.length < 2) return
      if (!interactionRef.current.zoomGestures) return
      const dist = getTouchDist(e.touches[0], e.touches[1])
      pinchState.current = {
        active: true,
        startDist: dist,
        startZoom: zoomRef.current,
        centerX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        centerY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      }
    }

    function handleTouchMove(e) {
      if (!pinchState.current.active || e.touches.length < 2) return
      if (!interactionRef.current.zoomGestures) return
      e.preventDefault()
      const dist = getTouchDist(e.touches[0], e.touches[1])
      const ratio = dist / pinchState.current.startDist
      const newZoom = Math.round(pinchState.current.startZoom * ratio)
      // Touch pinch has no modifier-key equivalent; always honor the
      // configured zoomOrigin (centerpoint of the pinch is intuitive
      // visually but tends to drift the canvas across the screen).
      applyZoom(newZoom)
    }

    function handleTouchEnd() {
      if (!pinchState.current.active) return
      pinchState.current.active = false
      // Flush the throttled zoom-changed event so the toolbar's zoom
      // tool snaps to the final gesture value immediately — without
      // this the trailing throttle fire is what updates it, which can
      // leave the % display stale for ~100ms after fingers lift.
      if (zoomEventTimer.current) {
        clearTimeout(zoomEventTimer.current)
        zoomEventTimer.current = null
      }
      const bridge = window[CANVAS_BRIDGE_STATE_KEY] || {}
      bridge.active = true
      bridge.canvasId = canvasId
      bridge.zoom = zoomRef.current
      window[CANVAS_BRIDGE_STATE_KEY] = bridge
      document.dispatchEvent(new CustomEvent('storyboard:canvas:zoom-changed', {
        detail: { zoom: zoomRef.current }
      }))
    }

    // iOS Safari historically ignores `user-scalable=no` (added back as
    // an accessibility allowance). The `gesture*` event family fires
    // for two-finger pinches and is the only reliable signal to block
    // the visual-viewport zoom on iPad/iPhone.
    function handleGesture(e) {
      if (!interactionRef.current.zoomGestures) return
      e.preventDefault()
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('touchcancel', handleTouchEnd)
    document.addEventListener('gesturestart', handleGesture, { passive: false })
    document.addEventListener('gesturechange', handleGesture, { passive: false })
    document.addEventListener('gestureend', handleGesture, { passive: false })
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
      document.removeEventListener('gesturestart', handleGesture)
      document.removeEventListener('gesturechange', handleGesture)
      document.removeEventListener('gestureend', handleGesture)
    }
  }, [canvasId])

  // Space + drag to pan the canvas
  const [spaceHeld, setSpaceHeld] = useState(false)
  const isPanning = useRef(false)
  const [panningActive, setPanningActive] = useState(false)
  const panStart = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 })

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === ' ') {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
        e.preventDefault()
        if (!e.repeat) setSpaceHeld(true)
      }
    }
    function handleKeyUp(e) {
      if (e.key === ' ') {
        e.preventDefault()
        setSpaceHeld(false)
        isPanning.current = false
        setPanningActive(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const handlePanStart = useCallback((e) => {
    if (!spaceHeld) return
    e.preventDefault()
    isPanning.current = true
    setPanningActive(true)
    const el = scrollRef.current
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollX: el?.scrollLeft ?? 0,
      scrollY: el?.scrollTop ?? 0,
    }

    function handlePanMove(ev) {
      if (!isPanning.current || !el) return
      el.scrollLeft = panStart.current.scrollX - (ev.clientX - panStart.current.x)
      el.scrollTop = panStart.current.scrollY - (ev.clientY - panStart.current.y)
    }
    function handlePanEnd() {
      isPanning.current = false
      setPanningActive(false)
      document.removeEventListener('mousemove', handlePanMove)
      document.removeEventListener('mouseup', handlePanEnd)
    }
    document.addEventListener('mousemove', handlePanMove)
    document.addEventListener('mouseup', handlePanEnd)
  }, [spaceHeld])

  // Stable callback for deselecting all widgets
  const handleDeselectAll = useCallback(() => setSelectedWidgetIds(new Set()), [])

  // Marquee (lasso) multi-select on canvas background drag
  const { marqueeScreenRect, handleMarqueeMouseDown } = useMarqueeSelect({
    scrollRef,
    zoomRef: zoomRef,
    setSelectedWidgetIds,
    widgets: localWidgets,
    connectors: localConnectors,
    componentEntries,
    fallbackSizes: WIDGET_FALLBACK_SIZES,
    spaceHeld,
    isLocalDev,
  })

  // Stable callback for widget removal + deselect
  const handleWidgetRemoveAndDeselect = useCallback((id) => {
    handleWidgetRemove(id)
    setSelectedWidgetIds(new Set())
  }, [handleWidgetRemove])

  if (!canvas) {
    return (
      <div className={styles.empty}>
        <p>Canvas &ldquo;{canvasId}&rdquo; not found</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <p>Loading canvas…</p>
      </div>
    )
  }

  // Drag is allowed in dev for every widget, and in production only when a
  // widget opts in via `interaction.movable: { enabled: true, prod: true }`,
  // or when `canvas.production.move` is set in `storyboard.config.json`.
  // The canvas-wide `locked` switch is what tiny-canvas reads to disable
  // neodrag; we keep it locked in prod unless at least one widget on this
  // canvas (or any component widget — they share the 'component' type config)
  // is movable-in-prod.
  const allowMoveInProd = isCanvasProductionEnabled('move')
  const allowResizeInProd = isCanvasProductionEnabled('resize')
  const allowMove = isLocalDev || allowMoveInProd
  const hasMovableInEnv = isLocalDev
    || (localWidgets ?? []).some((w) => isMovable(w.type))
    || (componentEntries.length > 0 && isMovable('component'))

  const canvasProps = {
    centered: canvas.centered ?? false,
    dotted: canvas.dotted ?? false,
    grid: canvas.grid ?? false,
    gridSize: canvas.gridSize ?? 18,
    snapGrid: snapEnabled ? [snapGridSize, snapGridSize] : undefined,
    colorMode: canvas.colorMode === 'auto'
      ? getToolbarColorMode(canvasTheme)
      : (canvas.colorMode ?? 'auto'),
    locked: !hasMovableInEnv,
    layout: canvas.layout === 'flow' ? 'flow' : 'absolute',
    className: typeof canvas.className === 'string' ? canvas.className : undefined,
  }
  const isFlowLayout = canvasProps.layout === 'flow'

  const canvasThemeVars = getCanvasThemeVars(canvasTheme)
  const canvasPrimerAttrs = getCanvasPrimerAttrs(canvasTheme)

  // Merge JSX-sourced widgets and JSON widgets
  const allChildren = []

  // 1. Component widgets (from jsxExports or sources fallback)
  const componentFeatures = getFeatures('component', { isLocalDev })
  for (const entry of componentEntries) {
    const { exportName, Component, sourceData } = entry
    const sourcePosition = sourceData.position || { x: 0, y: 0 }
    const passComponentUpdateInProd = (allowResizeInProd && isResizable('component')) || allowMoveInProd
    const componentOnUpdate = (isLocalDev || passComponentUpdateInProd)
      ? (updates) => handleSourceUpdate(exportName, updates)
      : undefined
    allChildren.push(
      <div
        key={`jsx-${exportName}`}
        id={`jsx-${exportName}`}
        data-tc-x={sourcePosition.x}
        data-tc-y={sourcePosition.y}
        data-tc-class={typeof sourceData.className === 'string' ? sourceData.className : undefined}
        data-widget-raised={selectedWidgetIds.has(`jsx-${exportName}`) || undefined}
        {...((isLocalDev || isMovable('component')) ? { 'data-tc-handle': '.tc-drag-handle, .tc-drag-surface' } : {})}
        {...canvasPrimerAttrs}
        style={canvasThemeVars}
        onClick={isLocalDev ? (e) => {
          e.stopPropagation()
          if (!e.target.closest('.tc-drag-handle')) {
            handleWidgetSelect(`jsx-${exportName}`, e.shiftKey)
          }
        } : undefined}
      >
        <WidgetChrome
          widgetId={`jsx-${exportName}`}
          features={componentFeatures}
          selected={selectedWidgetIds.has(`jsx-${exportName}`)}
          multiSelected={isMultiSelected && selectedWidgetIds.has(`jsx-${exportName}`)}
          onSelect={(shiftKey) => handleWidgetSelect(`jsx-${exportName}`, shiftKey)}
          onDeselect={handleDeselectAll}
          readOnly={!isLocalDev}
        >
          <ComponentWidget
            component={Component}
            jsxModule={canvas?._jsxModule}
            exportName={exportName}
            canvasTheme={canvasTheme}
            isLocalDev={isLocalDev}
            width={sourceData.width}
            height={sourceData.height}
            onUpdate={componentOnUpdate}
            resizable={isResizable('component') && !!componentOnUpdate}
          />
        </WidgetChrome>
      </div>
    )
  }

  // 2. JSON-defined mutable widgets (selectable, wrapped in WidgetChrome)
  // Stable DOM order — visual stacking is controlled by z-index on the
  // wrapper div (data-widget-raised), NOT by re-sorting the array.
  // Re-sorting caused iframe widgets (stories, embeds) to remount and
  // reload every time selection changed, because moving an iframe node
  // in the DOM destroys its browsing context.
  for (const widget of (localWidgets ?? [])) {
    // In production, render terminal widgets as read-only instead of hiding them
    const effectiveWidget = (!isLocalDev && (widget.type === 'terminal' || widget.type === 'agent'))
      ? { ...widget, type: 'terminal-read' }
      : widget
    // In prod, pass onUpdate only when the widget needs it — either it's
    // editable-in-prod (markdown/sticky), the global resize-in-prod flag is
    // on and the widget is resize-enabled, or the global move-in-prod flag
    // is on (so position-update calls survive).
    const passOnUpdateInProd = isEditableInProduction(effectiveWidget.type)
      || (allowResizeInProd && isResizable(effectiveWidget.type))
      || allowMoveInProd
    const widgetOnUpdate = (isLocalDev || passOnUpdateInProd) ? handleWidgetUpdate : undefined
    allChildren.push(
      <div
        key={effectiveWidget.id}
        id={effectiveWidget.id}
        data-tc-x={effectiveWidget?.position?.x ?? 0}
        data-tc-y={effectiveWidget?.position?.y ?? 0}
        data-tc-class={typeof effectiveWidget?.props?.className === 'string' ? effectiveWidget.props.className : undefined}
        data-widget-raised={selectedWidgetIds.has(widget.id) || undefined}
        {...((isLocalDev || isMovable(effectiveWidget.type)) ? { 'data-tc-handle': '.tc-drag-handle, .tc-drag-surface' } : {})}
        {...canvasPrimerAttrs}
        style={canvasThemeVars}
        onClick={isLocalDev ? (e) => {
          e.stopPropagation()
          if (!e.target.closest('.tc-drag-handle')) {
            // Alt+Click: create connector from selected widget to this one
            if (e.altKey && selectedWidgetIds.size === 1 && !selectedWidgetIds.has(effectiveWidget.id)) {
              handleAltClickConnect(effectiveWidget.id)
              return
            }
            handleWidgetSelect(effectiveWidget.id, e.shiftKey)
          }
        } : undefined}
      >
        <ChromeWrappedWidget
          widget={effectiveWidget}
          selected={selectedWidgetIds.has(widget.id)}
          multiSelected={isMultiSelected && selectedWidgetIds.has(widget.id)}
          connectorCount={localConnectors.filter((c) => c.start?.widgetId === widget.id || c.end?.widgetId === widget.id)}
          allWidgets={localWidgets}
          onSelect={(shiftKey) => handleWidgetSelect(widget.id, shiftKey)}
          onDeselect={handleDeselectAll}
          onUpdate={widgetOnUpdate}
          onCopy={isLocalDev ? handleWidgetCopy : undefined}
          onCopyWithConnectors={isLocalDev ? handleWidgetCopyWithConnectors : undefined}
          onRemove={isLocalDev ? handleWidgetRemoveAndDeselect : undefined}
          onRefreshGitHub={isLocalDev ? handleRefreshGitHubWidget : undefined}
          canRefreshGitHub={isLocalDev}
          onConnectorDragStart={isLocalDev ? handleConnectorDragStart : undefined}
          hubRoleOptions={hubRoleOptions}
          defaultHubRole={defaultHubRole}
          onRoleChange={isLocalDev ? handleWidgetRoleChange : undefined}
          readOnly={!isLocalDev}
        />
      </div>
    )
  }

  const scale = zoom / 100

  const filteredConnectors = localConnectors

  return (
    <>
      <ChromeSlot id="canvas:title" surface="canvas" ctx={{ canvasId }}>
        <div className={styles.canvasTitle}>
          <ChromeSlot id="canvas:home-link" surface="canvas" ctx={{ canvasId }}>
            <a href={(import.meta.env?.BASE_URL || '/')} className={styles.canvasLogo} aria-label="Go to homepage">
              <Icon name="home" size={16} color="#fff" />
            </a>
          </ChromeSlot>
          {/*
            * Solo-page canvases would render the same name twice (CanvasTitleEditable
            * and PageSelector both surface the canvas/page label). Hide the leftmost
            * title in that case — PageSelector becomes the sole label, and rename
            * still works via its per-page edit affordance. When the PageSelector
            * would not render at all (non-localDev with a single page), keep
            * CanvasTitleEditable so the canvas is never anonymous.
            */}
          {(siblingPages.length > 1 || !isLocalDev) && (
            <ChromeSlot id="canvas:title-editable" surface="canvas" ctx={{ canvasId }}>
              <span style={{ display: 'contents' }}>
                <CanvasTitleEditable
                  canvasId={canvasId}
                  canvasMeta={canvasMeta}
                  canvas={canvas}
                  isLocalDev={isLocalDev}
                />
              </span>
            </ChromeSlot>
          )}
          <ChromeSlot id="canvas:page-selector" surface="canvas" ctx={{ canvasId }}>
            <span style={{ display: 'contents' }}>
              <PageSelector currentName={canvasId} pages={siblingPages} isLocalDev={isLocalDev} />
            </span>
          </ChromeSlot>
        </div>
      </ChromeSlot>
      <div
        ref={scrollRef}
        data-storyboard-canvas-scroll
        data-sb-surface="canvas"
        data-sb-canvas-theme={canvasTheme}
        data-layout={canvasProps.layout}
        {...canvasPrimerAttrs}
        className={styles.canvasScroll}
        style={{
          ...canvasThemeVars,
          ...(spaceHeld && !isFlowLayout ? { cursor: panningActive ? 'grabbing' : 'grab' } : {}),
          ...(isFlowLayout ? {} : scrollAxisStyle(getCanvasInteraction().scrollAxis)),
        }}
        onMouseDown={isFlowLayout ? undefined : (e) => { handlePanStart(e); handleMarqueeMouseDown(e); }}
      >
        <MarqueeOverlay rect={marqueeScreenRect} />
        <FilePickerController />
        <DeleteConfirmController />
        <div
          ref={zoomElRef}
          data-storyboard-canvas-zoom
          data-sb-canvas-theme={canvasTheme}
          data-layout={canvasProps.layout}
          className={styles.canvasZoom}
          style={isFlowLayout
            ? {}
            : {
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
                width: getZoomLayoutWidth(scale, interactionRef.current?.surface),
                height: getZoomLayoutHeight(scale, interactionRef.current?.surface),
                ...(spaceHeld ? { pointerEvents: 'none' } : {}),
              }}
        >
          {!isFlowLayout && (
            <ConnectorLayer
              connectors={filteredConnectors}
              widgets={localWidgets ?? []}
              selectedWidgetIds={selectedWidgetIds}
              onRemove={isLocalDev ? handleConnectorRemove : undefined}
              onEndpointDrag={undefined}
              dragPreview={connectorDrag}
              hidden={widgetDragging}
            />
          )}
          <Canvas {...canvasProps} onDragStart={allowMove ? handleItemDragStart : undefined} onDrag={allowMove ? handleItemDrag : undefined} onDragEnd={allowMove ? handleItemDragEnd : undefined}>
            {allChildren}
          </Canvas>
        </div>
      </div>
      {showGhInstallBanner && (
        <ChromeSlot id="canvas:gh-install-banner" surface="canvas">
          <aside className={styles.ghInstallBanner} role="status" aria-live="polite">
            <span className={styles.ghInstallBannerText}>
              GitHub embeds require local <code>gh</code> CLI access.
            </span>
            <a
              href={GH_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.ghInstallBannerLink}
            >
              Install GitHub CLI
            </a>
            <button
              type="button"
              className={styles.ghInstallBannerDismiss}
              onClick={() => setShowGhInstallBanner(false)}
            >
              Dismiss
            </button>
          </aside>
        </ChromeSlot>
      )}
    </>
  )
}
