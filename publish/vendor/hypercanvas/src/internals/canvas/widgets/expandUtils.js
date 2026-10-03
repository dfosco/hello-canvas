/**
 * Shared utilities for expandable widget modals and split-screen.
 *
 * Reads the canvas bridge state to find connected widgets eligible
 * for split-screen, and builds iframe URLs for secondary panes.
 */
import { createElement, useCallback, useEffect, useState } from 'react'
import { getStoryData } from '../../../core/index.js'
import { isSplitScreenCapable, getWidgetMeta, getFeaturesForSurface } from './widgetConfig.js'
import { ExpandedMarkdownEditor } from './MarkdownBlock.jsx'
import { getImageUrl } from './ImageWidget.jsx'
import { FileSecondaryPane } from './FileWidget/FileSecondaryPane.jsx'
import { AgentChat } from '../../agent-chat/AgentChat.jsx'
import { useAgentChat } from '../../agent-chat/useAgentChat.js'
import linkStyles from './LinkPreview.module.css'
import imageStyles from './ImageWidget.module.css'

// Re-export for convenience
export { isSplitScreenCapable }

/**
 * Stateful wrapper for markdown in secondary split-screen panes.
 * Manages editing state and syncs it to the shared editingRef so
 * the title bar features' getState stays in sync.
 */
function MarkdownSecondaryPane({ widget, editingRef, onUpdate }) {
  const [editing, setEditing] = useState(false)
  // eslint-disable-next-line react-hooks/refs
  editingRef.current = editing
  // eslint-disable-next-line react-hooks/refs
  editingRef.setter = (v) => {
    setEditing(v)
    // Notify ExpandedPane to re-render so titlebar features resolve updated toggle state
    document.dispatchEvent(new CustomEvent('storyboard:expanded-pane:refresh'))
  }

  // Local content state — drives the controlled textarea synchronously so the
  // user's caret position is preserved during typing. The dispatched canvas
  // update is async (event → CanvasPage → setState → bridge → re-render),
  // and a controlled textarea with an async value source resets the caret to
  // the end on every keystroke.
  const [content, setContent] = useState(widget.props?.content || '')

  // Re-sync from the canvas bridge when the widget changes externally
  // (e.g. an agent edits it, or the user edits it elsewhere). We compare
  // against the local value to avoid clobbering in-flight keystrokes.
  useEffect(() => {
    const handler = () => {
      const liveWidget = window.__storyboardCanvasBridgeState?.widgets?.find((w) => w.id === widget.id)
      const liveContent = liveWidget?.props?.content
      if (typeof liveContent === 'string') {
        setContent((prev) => (prev === liveContent ? prev : liveContent))
      }
    }
    document.addEventListener('storyboard:canvas:bridge-updated', handler)
    return () => document.removeEventListener('storyboard:canvas:bridge-updated', handler)
  }, [widget.id])

  const handleUpdate = useCallback((updates) => {
    if (typeof updates?.content === 'string') {
      setContent(updates.content)
    }
    onUpdate(updates)
  }, [onUpdate])

  // eslint-disable-next-line react-hooks/refs
  return createElement(ExpandedMarkdownEditor, {
    content,
    onUpdate: handleUpdate,
    editing,
    onToggleEdit: () => editingRef.setter(!editing),
  })
}

/**
 * Build a pane config for a connected widget to use with ExpandedPane.
 * Returns a ReactPane or ExternalPane config depending on the widget type.
 *
 * @param {{ id: string, type: string, props: Object }} widget
 * @param {'fullbar' | 'splitbar'} [surface='splitbar'] — surface for titlebar features
 * @returns {import('./ExpandedPane.jsx').PaneConfig | null}
 */
export function buildPaneForWidget(widget, surface = 'splitbar') {
  if (!widget) return null

  const label = getSplitPaneLabel(widget)

  // Site Frames retain their live viewport and route observer in either pane.
  if (widget.type === 'site-frame') {
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      widgetProps: widget.props,
      kind: 'external',
      attach: container => window.__storyboardCanvasWidgetRefs?.get(widget.id)?.attachExpandedPane?.(container),
    }
  }

  // Terminal/agent: external pane with DOM reparenting
  if (widget.type === 'terminal' || widget.type === 'terminal-read' || widget.type === 'agent') {
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      widgetProps: widget.props,
      kind: 'external',
      attach: (container) => reparentTerminalInto(widget.id, container),
      onResize: (rect) => {
        // fitTerminalToElement is in TerminalWidget.jsx (module-level).
        // We call it via the global registry if available.
        if (typeof window !== 'undefined' && window.__storyboardTerminalRegistry) {
          const entry = window.__storyboardTerminalRegistry.get(widget.id)
          if (entry) {
            const { term, ws } = entry
            const cw = term.renderer?.charWidth
            const ch = term.renderer?.charHeight
            if (cw && ch && rect.width > 50 && rect.height > 50) {
              const cols = Math.max(10, Math.floor(rect.width / cw))
              const rows = Math.max(4, Math.floor(rect.height / ch))
              term.resize?.(cols, rows)
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols, rows }))
              }
            }
          }
        }
      },
    }
  }

  // iframe-embeddable types: build iframe URL
  const iframeUrl = buildSecondaryIframeUrl(widget)
  if (iframeUrl) {
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      kind: 'react',
      render: () => createElement('iframe', {
        src: iframeUrl,
        style: { border: 'none', width: '100%', height: '100%', display: 'block' },
        title: label,
      }),
    }
  }

  // Markdown: same editable pane as primary, updates via custom event
  if (widget.type === 'markdown') {
    // Shared mutable ref for editing state — lets getState and render stay in sync
    const editingRef = { current: false, setter: null }
    const toggleEdit = () => { editingRef.setter?.(!editingRef.current) }
    const onUpdate = (updates) => {
      document.dispatchEvent(new CustomEvent('storyboard:canvas:update-widget', {
        detail: { widgetId: widget.id, updates },
      }))
    }
    const surfaceFeatures = getFeaturesForSurface('markdown', surface)
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      kind: 'react',
      features: surfaceFeatures,
      getState: (key) => {
        if (key === 'editing') return editingRef.current
        return undefined
      },
      onAction: (actionId) => {
        if (actionId === 'toggle-edit') toggleEdit()
      },
      render: () => createElement(MarkdownSecondaryPane, { widget, editingRef, onUpdate }),
    }
  }

  // Agent Chat panes share the same backend conversation, but render a
  // separate React surface inside the expanded layout.
  if (widget.type === 'agent-chat') {
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      kind: 'react',
      render: () => createElement(AgentChatSecondaryPane, { widget }),
    }
  }

  // Link-preview
  if (widget.type === 'link-preview') {
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      kind: 'react',
      render: () => createElement(LazyLinkPreviewPane, { widget }),
    }
  }

  // Image: display at full size within the pane
  if (widget.type === 'image') {
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      kind: 'react',
      render: () => createElement(LazyImagePane, { widget }),
    }
  }

  // File: render the same editable pane shape as the primary expanded view,
  // backed by the shared fileContentStore. Editing state is local to this
  // pane (each split-screen pane has its own toggle).
  if (widget.type === 'file') {
    const editingRef = { current: false, setter: null }
    const surfaceFeatures = getFeaturesForSurface('file', surface)
    return {
      id: widget.id,
      label,
      widgetType: widget.type,
      kind: 'react',
      features: surfaceFeatures,
      getState: (key) => {
        if (key === 'editing') return editingRef.current
        return undefined
      },
      onAction: (actionId) => {
        if (actionId === 'toggle-edit') editingRef.setter?.(!editingRef.current)
      },
      render: () => createElement(FileSecondaryPane, { widget, editingRef }),
    }
  }

  return null
}

function AgentChatSecondaryPane({ widget }) {
  const chat = useAgentChat({
    agentId: widget.props?.agentId || '',
    widgetId: widget.id,
  })
  return createElement(AgentChat, {
    chat,
    providers: chat.providers,
    providersError: chat.providersError,
  })
}

/**
 * Link-preview renderer for expanded panes — matches the primary expanded
 * rendering used when link-preview triggers its own expand/split-screen.
 */
function LazyLinkPreviewPane({ widget }) {
  const { url, title, github, ogImage, description } = widget.props || {}

  let hostname = ''
  try { hostname = new URL(url).hostname } catch { /* */ }

  if (github) {
    const titleText = title || github.title || ''
    const issueNumber = github.number ? `#${github.number}` : ''
    const primaryAuthor = github.author || ''
    const createdAgo = github.createdAgo || ''
    const bodyHtml = github.bodyHtml || ''

    return createElement('div', { className: linkStyles.expandedIssue },
      createElement('header', { className: linkStyles.expandedIssueHeader },
        createElement('h2', { className: linkStyles.expandedIssueTitle },
          createElement('a', { href: url || '#', target: '_blank', rel: 'noopener noreferrer' },
            titleText || url,
            issueNumber && createElement('span', { className: linkStyles.expandedIssueNumber }, ` ${issueNumber}`),
          ),
        ),
        createElement('div', { className: linkStyles.expandedByline },
          primaryAuthor && createElement('a', {
            href: `https://github.com/${primaryAuthor}`,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: linkStyles.expandedAuthor,
          },
            createElement('img', {
              src: `https://github.com/${primaryAuthor}.png?size=40`,
              alt: '', width: '20', height: '20',
              className: linkStyles.avatar, loading: 'lazy',
            }),
            primaryAuthor,
          ),
          createdAgo && createElement('span', { className: linkStyles.expandedBylineText },
            primaryAuthor ? ` opened ${createdAgo}` : `Opened ${createdAgo}`,
          ),
        ),
      ),
      bodyHtml && createElement(DangerousHtmlDiv, { html: bodyHtml, className: linkStyles.expandedIssueBody }),
    )
  }

  return createElement('div', { className: linkStyles.expandedLink },
    ogImage && createElement('img', { className: linkStyles.expandedOgImage, src: ogImage, alt: '', loading: 'lazy' }),
    createElement('h2', { className: linkStyles.expandedTitle }, title || hostname || url || 'Untitled'),
    description && createElement('p', { className: linkStyles.expandedDescription }, description),
    url && createElement('a', {
      href: url, target: '_blank', rel: 'noopener noreferrer',
      className: linkStyles.expandedUrl,
    }, url),
  )
}

/** Renders raw HTML into a div via a callback ref (avoids ref-during-render lint). */
function DangerousHtmlDiv({ html, className }) {
  const setRef = useCallback((el) => { if (el) el.innerHTML = html }, [html])
  return createElement('div', { ref: setRef, className })
}

/** Image renderer for secondary expanded/split-screen panes. */
function LazyImagePane({ widget }) {
  const src = widget.props?.src
  if (!src) return null
  return createElement('div', { className: imageStyles.expandedImageContainer },
    createElement('img', {
      src: getImageUrl(src),
      alt: '',
      className: imageStyles.expandedImage,
      draggable: false,
    }),
  )
}

/**
 * Find a connected widget that is split-screen capable.
 * Returns the first match, or null.
 * @param {string} widgetId — the primary (expanded) widget's ID
 * @returns {{ id: string, type: string, position: { x: number, y: number }, props: Object } | null}
 */
export function findConnectedSplitTarget(widgetId) {
  const bridge = window.__storyboardCanvasBridgeState
  if (!bridge?.connectors || !bridge?.widgets) return null

  // Find all widgets connected to this one
  const connectedIds = new Set()
  for (const c of bridge.connectors) {
    if (c.start?.widgetId === widgetId && c.end?.widgetId) connectedIds.add(c.end.widgetId)
    if (c.end?.widgetId === widgetId && c.start?.widgetId) connectedIds.add(c.start.widgetId)
  }
  if (connectedIds.size === 0) return null

  // Return the first connected widget that is split-screen capable
  for (const w of bridge.widgets) {
    if (connectedIds.has(w.id) && isSplitScreenCapable(w.type)) return w
  }
  return null
}

/**
 * Find ALL connected widgets that are split-screen capable.
 * If more than maxCount, picks the nearest by Euclidean distance from primary.
 * @param {string} widgetId — the primary (expanded) widget's ID
 * @param {number} [maxCount=3] — max connected widgets to return
 * @returns {Array<{ id: string, type: string, position: { x: number, y: number }, props: Object }>}
 */
export function findAllConnectedSplitTargets(widgetId, maxCount = 3) {
  const bridge = window.__storyboardCanvasBridgeState
  if (!bridge?.connectors || !bridge?.widgets) return []

  const connectedIds = new Set()
  for (const c of bridge.connectors) {
    if (c.start?.widgetId === widgetId && c.end?.widgetId) connectedIds.add(c.end.widgetId)
    if (c.end?.widgetId === widgetId && c.start?.widgetId) connectedIds.add(c.start.widgetId)
  }
  if (connectedIds.size === 0) return []

  const candidates = bridge.widgets.filter(
    (w) => connectedIds.has(w.id) && isSplitScreenCapable(w.type),
  )

  if (candidates.length <= maxCount) return candidates

  // Too many — pick the nearest by Euclidean distance from primary
  const primary = bridge.widgets.find((w) => w.id === widgetId)
  const px = primary?.position?.x ?? 0
  const py = primary?.position?.y ?? 0
  return candidates
    .map((w) => {
      const dx = (w.position?.x ?? 0) - px
      const dy = (w.position?.y ?? 0) - py
      return { widget: w, dist: dx * dx + dy * dy }
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxCount)
    .map((e) => e.widget)
}

/**
 * Build a 2D split layout (PaneConfig[][]) from a primary widget and connected widgets.
 * Uses quadrant-based spatial assignment: compute centroid, assign each widget to
 * TL/TR/BL/BR, then build columns (left = TL+BL, right = TR+BR).
 *
 * @param {{ id: string, type: string, position?: { x: number, y: number }, props: Object }} primaryWidget
 * @param {Array<{ id: string, type: string, position?: { x: number, y: number }, props: Object }>} connectedWidgets
 * @param {(widget: Object) => import('./ExpandedPane.jsx').PaneConfig | null} buildPaneFn — builds a PaneConfig for a widget
 * @returns {import('./ExpandedPane.jsx').PaneConfig[][]} — 2D layout: outer = columns, inner = rows
 */
export function buildSplitLayout(primaryWidget, connectedWidgets, buildPaneFn) {
  const allWidgets = [primaryWidget, ...connectedWidgets]

  // Build panes, filter nulls, keep widget reference for positioning
  const entries = allWidgets
    .map((w) => ({ widget: w, pane: buildPaneFn(w) }))
    .filter((e) => e.pane !== null)

  if (entries.length === 0) return []
  if (entries.length === 1) return [[entries[0].pane]]

  // Assign to quadrants
  const assigned = assignToQuadrants(entries.map((e) => ({
    x: e.widget.position?.x ?? 0,
    y: e.widget.position?.y ?? 0,
    data: e.pane,
  })))

  // Build columns: left = TL + BL (top first), right = TR + BR (top first)
  const leftCol = [assigned.tl, assigned.bl].filter(Boolean)
  const rightCol = [assigned.tr, assigned.br].filter(Boolean)

  const layout = []
  if (leftCol.length > 0) layout.push(leftCol)
  if (rightCol.length > 0) layout.push(rightCol)
  return layout
}

/**
 * Assign items to a 2×2 quadrant grid using centroid splitting.
 * Falls back to TL→TR→BL→BR cycling when positions are degenerate (all same x or y).
 *
 * @template T
 * @param {Array<{ x: number, y: number, data: T }>} items — 2-4 positioned items
 * @returns {{ tl: T|null, tr: T|null, bl: T|null, br: T|null }}
 */
export function assignToQuadrants(items) {
  const result = { tl: null, tr: null, bl: null, br: null }
  if (items.length === 0) return result

  // Centroid
  const cx = items.reduce((s, i) => s + i.x, 0) / items.length
  const cy = items.reduce((s, i) => s + i.y, 0) / items.length

  // Check if all x or all y are identical (degenerate)
  const allSameX = items.every((i) => i.x === items[0].x)
  const allSameY = items.every((i) => i.y === items[0].y)

  if (allSameX && allSameY) {
    // All positions identical — cycle TL→TR→BL→BR
    const slots = ['tl', 'tr', 'bl', 'br']
    for (let i = 0; i < Math.min(items.length, 4); i++) {
      result[slots[i]] = items[i].data
    }
    return result
  }

  // Assign to quadrants based on centroid
  // Use buckets to handle collisions (multiple items in same quadrant)
  const buckets = { tl: [], tr: [], bl: [], br: [] }
  for (const item of items) {
    const col = item.x < cx ? 'l' : 'r'
    const row = item.y < cy ? 't' : 'b'
    buckets[`${row}${col}`].push(item)
  }

  // If centroid splits are degenerate (e.g. 2 items with same x = centroid),
  // we may have empty quadrants and overflow. Redistribute overflow.
  const filled = []
  const overflow = []
  for (const [slot, bucket] of Object.entries(buckets)) {
    if (bucket.length > 0) {
      // Sort by position for deterministic order: top-left first
      bucket.sort((a, b) => a.y - b.y || a.x - b.x)
      result[slot] = bucket[0].data
      filled.push(slot)
      for (let i = 1; i < bucket.length; i++) overflow.push(bucket[i])
    }
  }

  // Place overflow into empty quadrant slots
  if (overflow.length > 0) {
    const allSlots = ['tl', 'tr', 'bl', 'br']
    const emptySlots = allSlots.filter((s) => result[s] === null)
    for (let i = 0; i < Math.min(overflow.length, emptySlots.length); i++) {
      result[emptySlots[i]] = overflow[i].data
    }
  }

  return result
}

/**
 * Get the x-coordinate position of a widget from bridge state.
 * @param {string} widgetId
 * @returns {number}
 */
export function getWidgetX(widgetId) {
  const bridge = window.__storyboardCanvasBridgeState
  if (!bridge?.widgets) return 0
  const w = bridge.widgets.find((w) => w.id === widgetId)
  return w?.position?.x ?? 0
}

/**
 * Determine pane order (left/right) based on x-coordinates.
 * Returns { left, right } where each is 'primary' or 'secondary'.
 * @param {string} primaryId — the widget being expanded
 * @param {{ id: string, position?: { x: number } }} secondaryWidget
 * @returns {{ primaryIsLeft: boolean }}
 */
export function getPaneOrder(primaryId, secondaryWidget) {
  const primaryX = getWidgetX(primaryId)
  const secondaryX = secondaryWidget?.position?.x ?? 0
  return { primaryIsLeft: primaryX <= secondaryX }
}

/**
 * Build an iframe URL for a widget to render in a secondary pane.
 * Returns null if the widget type isn't iframe-embeddable.
 * @param {{ type: string, props: Object }} widget
 * @returns {string | null}
 */
export function buildSecondaryIframeUrl(widget) {
  if (!widget) return null
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  const baseClean = base.endsWith('/') ? base.slice(0, -1) : base

  if (widget.type === 'prototype') {
    const src = widget.props?.src
    if (!src) return null
    if (/^https?:\/\//.test(src)) return src
    // Match PrototypeEmbed's iframeSrc logic: dev → route through the
    // isolated /prototypes.html entry so a broken prototype's transform
    // / HMR errors stay inside the iframe (and don't try to load the
    // canvas SPA inside an iframe nested in the canvas SPA, which
    // produces the "prototype route breaking" symptom in split-screen).
    // Prod → direct SPA route.
    const baseSegment = baseClean.replace(/^\//, '')
    const cleaned = src.replace(/^\/branch--[^/]+/, '')
    let normalized
    if (baseSegment && cleaned.startsWith(baseClean)) normalized = cleaned
    else if (baseSegment && cleaned.startsWith(baseSegment)) normalized = `/${cleaned}`
    else normalized = `${baseClean}${cleaned.startsWith('/') ? '' : '/'}${cleaned}`
    const withoutBase = baseSegment && normalized.startsWith(baseClean)
      ? normalized.slice(baseClean.length) || '/'
      : normalized
    const hashIdx = withoutBase.indexOf('#')
    const innerHash = hashIdx >= 0 ? withoutBase.slice(hashIdx + 1) : ''
    const pathAndQuery = hashIdx >= 0 ? withoutBase.slice(0, hashIdx) : withoutBase
    const routePath = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
    const suffix = innerHash ? `#${innerHash}` : ''
    const sep = routePath.includes('?') ? '&' : '?'
    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV
    const base = isDev
      ? `${baseClean}/prototypes.html${routePath}`
      : `${baseClean}${routePath}`
    return `${base}${sep}_sb_embed&_sb_hide_branch_bar&_sb_theme_target=prototype${suffix}`
  }

  if (widget.type === 'figma-embed') {
    const url = widget.props?.url
    if (!url) return null
    // Inline a minimal figma embed URL builder to avoid circular deps
    try {
      const u = new URL(url)
      if (u.hostname !== 'figma.com' && !u.hostname.endsWith('.figma.com')) return null
      return `https://www.figma.com/embed?embed_host=storyboard&url=${encodeURIComponent(url)}`
    } catch { return null }
  }

  if (widget.type === 'codepen-embed') {
    const url = widget.props?.url
    if (!url) return null
    try {
      const u = new URL(url)
      if (u.hostname !== 'codepen.io' && !u.hostname.endsWith('.codepen.io')) return null
      const path = u.pathname.replace(/\/(pen|full|details)\//, '/embed/')
      return `https://codepen.io${path}?default-tab=result`
    } catch { return null }
  }

  if (widget.type === 'story') {
    const storyId = widget.props?.storyId
    const exportName = widget.props?.exportName
    if (!storyId) return null
    const storyData = getStoryData(storyId)
    if (!storyData?._storyModule) return null
    const route = storyData._route || `/components/${storyId}`
    const params = new URLSearchParams()
    if (exportName) params.set('export', exportName)
    params.set('_sb_embed', '')
    // Dev: route through the shared isolation entry. Prod: direct SPA route.
    if (import.meta.env.DEV) return `${baseClean}/stories.html${route}?${params}`
    return `${baseClean}${route}?${params}`
  }

  if (widget.type === 'component-set') {
    const storyId = widget.props?.storyId
    if (!storyId) return null
    const storyData = getStoryData(storyId)
    if (!storyData?._storyModule) return null
    const params = new URLSearchParams()
    params.set('_sb_embed', '')
    params.set('_sb_component_set', '')
    const layout = widget.props?.layout
    if (layout) params.set('layout', layout)
    // `selected` lives in the URL hash, not the query string — see
    // StorySetWidget.resolveStorySetUrl. Keeps variant-change navigation
    // as a same-document fragment update (no iframe reload).
    const selected = widget.props?.selected
    const hash = selected ? `#selected=${encodeURIComponent(selected)}` : ''
    const route = storyData._route || `/components/${storyId}`
    if (import.meta.env.DEV) return `${baseClean}/stories.html${route}?${params}${hash}`
    return `${baseClean}${route}?${params}${hash}`
  }

  return null
}

/**
 * Reparent a terminal widget's xterm container into a target element.
 * Returns a cleanup function to restore the original position.
 * @param {string} widgetId
 * @param {HTMLElement} targetEl
 * @returns {(() => void) | null}
 */
export function reparentTerminalInto(widgetId, targetEl) {
  const widgetEl = document.querySelector(`[data-widget-id="${widgetId}"]`)
  if (!widgetEl) return null

  const xtermEl = widgetEl.querySelector('[class*="xtermContainer"]')
  if (!xtermEl) return null

  const originalParent = xtermEl.parentElement
  const originalNextSibling = xtermEl.nextSibling

  targetEl.appendChild(xtermEl)

  return () => {
    if (originalNextSibling) {
      originalParent.insertBefore(xtermEl, originalNextSibling)
    } else {
      originalParent.appendChild(xtermEl)
    }
  }
}

/**
 * Build a "Type · Metadata" label for a widget in split-screen top bar.
 * @param {{ type: string, props: Object }} widget
 * @returns {string}
 */
export function getSplitPaneLabel(widget) {
  if (!widget) return ''
  const meta = getWidgetMeta(widget.type)
  const typeName = meta?.label || widget.type

  if (widget.type === 'terminal' || widget.type === 'terminal-read') {
    return `Terminal · ${widget.props?.prettyName || '…'}`
  }
  if (widget.type === 'agent') {
    const name = widget.props?.prettyName || '…'
    return `Agent · ${name}`
  }
  if (widget.type === 'prototype') {
    return `Prototype · ${widget.props?.src || '…'}`
  }
  if (widget.type === 'site-frame') {
    return `Site · ${widget.props?.title || widget.props?.siteId || '…'} · ${widget.props?.route || '/'}`
  }
  if (widget.type === 'figma-embed') {
    const url = widget.props?.url || ''
    let name = 'Figma'
    try { name = new URL(url).pathname.split('/').pop() || 'Figma' } catch { /* */ }
    return `Figma · ${name}`
  }
  if (widget.type === 'codepen-embed') {
    return `CodePen · ${widget.props?.url || '…'}`
  }
  if (widget.type === 'story') {
    return `Story · ${widget.props?.storyId || '…'}`
  }
  if (widget.type === 'component-set') {
    return `Component Set · ${widget.props?.storyId || '…'}`
  }
  if (widget.type === 'markdown') {
    const content = widget.props?.content || ''
    const firstLine = content.split('\n').find((l) => l.trim()) || ''
    const preview = firstLine.replace(/^#+\s*/, '').slice(0, 40)
    return `Markdown · ${preview || '…'}`
  }
  if (widget.type === 'link-preview') {
    return `${widget.props?.github ? 'GitHub' : 'Link'} · ${widget.props?.title || widget.props?.url || '…'}`
  }
  if (widget.type === 'image') {
    const filename = widget.props?.src || ''
    const name = filename.replace(/^~/, '').replace(/\.[^.]+$/, '') || '…'
    return `Image · ${name}`
  }
  if (widget.type === 'file') {
    const p = widget.props?.path || ''
    if (!p) return 'File'
    const basename = p.split('/').pop() || p
    const dir = p.slice(0, p.length - basename.length).replace(/\/$/, '')
    return dir ? `${dir}/${basename}` : basename
  }
  if (widget.type === 'agent-chat') {
    const agentId = widget.props?.agentId || ''
    return `Agent Chat · ${agentId ? `${agentId.slice(0, 12)}…` : 'new chat'}`
  }
  return typeName
}
