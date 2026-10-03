import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import KnobsForm from '../../internals/Knobs/KnobsForm.jsx'
import { getPrototypeKnobs } from '../knobs/discovery.js'
import { detectCurrentPrototypeRoute } from '../knobs/route.js'
import { getParam, setParam } from '../session/session.js'
import { subscribeToHash } from '../session/hashSubscribe.js'
import {
  closeKnobsPanel,
  isKnobsPanelOpen,
  KNOBS_PANEL_X_KEY,
  KNOBS_PANEL_Y_KEY,
} from './knobsPanelState.js'
import styles from './KnobsPanel.module.css'

const DEFAULT_MARGIN = 24
const DEFAULT_WIDTH = 340
const DEFAULT_HEIGHT = 420
const MIN_VISIBLE_HEADER = 60

function normalizeRoute(route) {
  if (route == null || route === '' || route === '/') return undefined
  const normalized = String(route).startsWith('/') ? String(route) : `/${route}`
  return normalized.replace(/\/+$/, '') || undefined
}

function finiteNumber(value) {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : null
}

function viewportSize() {
  return {
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
  }
}

function defaultPosition(panelEl) {
  const viewport = viewportSize()
  // Anchor 32px above the toolbar button so the panel feels like a
  // dropdown opening upward from it. Use the actual rendered panel height
  // when available (after first mount) — fall back to DEFAULT_HEIGHT.
  try {
    const button = document.querySelector('[data-tool-id="knobs"]')
    if (button) {
      const rect = button.getBoundingClientRect()
      const GAP = 32
      const panelHeight = panelEl?.getBoundingClientRect?.()?.height || DEFAULT_HEIGHT
      const x = Math.max(DEFAULT_MARGIN, rect.right - DEFAULT_WIDTH)
      const y = Math.max(DEFAULT_MARGIN, rect.top - panelHeight - GAP)
      return { x, y }
    }
  } catch { /* DOM unavailable */ }
  return {
    x: Math.max(DEFAULT_MARGIN, viewport.width - DEFAULT_WIDTH - DEFAULT_MARGIN),
    y: Math.max(DEFAULT_MARGIN, viewport.height - DEFAULT_HEIGHT - DEFAULT_MARGIN * 3),
  }
}

function readInitialPosition() {
  const fallback = defaultPosition()
  return {
    x: finiteNumber(getParam(KNOBS_PANEL_X_KEY)) ?? fallback.x,
    y: finiteNumber(getParam(KNOBS_PANEL_Y_KEY)) ?? fallback.y,
  }
}

function panelSize(element) {
  const rect = element?.getBoundingClientRect?.()
  return {
    width: rect?.width || DEFAULT_WIDTH,
    height: rect?.height || DEFAULT_HEIGHT,
  }
}

function clampKnobsPanelPosition(position, element) {
  const viewport = viewportSize()
  const size = panelSize(element)
  const minX = Math.min(0, MIN_VISIBLE_HEADER - size.width)
  const maxX = Math.max(DEFAULT_MARGIN, viewport.width - MIN_VISIBLE_HEADER)
  const maxY = Math.max(0, viewport.height - MIN_VISIBLE_HEADER)

  return {
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  }
}

function detectCurrentPrototypeRouteFromPanel(basePath = '/', pathname = window.location.pathname) {
  // Thin wrapper kept for back-compat; defers to the shared util so the
  // panel and the in-page highlight installer can never disagree.
  return detectCurrentPrototypeRoute(basePath, pathname)
}

function subscribeToNavigation(callback) {
  const originalPush = history.pushState
  const originalReplace = history.replaceState

  function notify() {
    callback()
  }

  function patchedPushState(...args) {
    const result = originalPush.apply(this, args)
    notify()
    return result
  }

  function patchedReplaceState(...args) {
    const result = originalReplace.apply(this, args)
    notify()
    return result
  }

  history.pushState = patchedPushState
  history.replaceState = patchedReplaceState
  window.addEventListener('popstate', notify)

  return () => {
    window.removeEventListener('popstate', notify)
    if (history.pushState === patchedPushState) history.pushState = originalPush
    if (history.replaceState === patchedReplaceState) history.replaceState = originalReplace
  }
}

function getNavigationSnapshot() {
  return window.location.pathname
}

function filterKnobsForRoute(knobs, route) {
  const normalizedRoute = normalizeRoute(route)
  return knobs.filter(def => {
    const defRoute = normalizeRoute(def?.scope)
    return !defRoute || defRoute === normalizedRoute
  })
}

function GripIcon() {
  return (
    <span className={styles.grip} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} className={styles.gripDot} />
      ))}
    </span>
  )
}

export default function KnobsPanel({ basePath = '/', navigationVersion = 0 }) {
  const open = useSyncExternalStore(subscribeToHash, isKnobsPanelOpen, () => false)
  const navigationSnapshot = useSyncExternalStore(subscribeToNavigation, getNavigationSnapshot, () => '/')
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const [position, setPosition] = useState(readInitialPosition)
  const [dragging, setDragging] = useState(false)
  // Track whether the user has explicitly moved the panel (or whether a
  // persisted position is in the hash). When neither is true, we re-anchor
  // to the toolbar button each time the panel re-opens so it always pops
  // out from the button like a regular dropdown.
  const userMovedRef = useRef(false)
  const routeInfo = useMemo(() => {
    void navigationSnapshot
    void navigationVersion
    return detectCurrentPrototypeRouteFromPanel(basePath)
  }, [basePath, navigationSnapshot, navigationVersion])

  useEffect(() => {
    if (!open) return undefined

    function handleKeydown(event) {
      if (event.key === 'Escape') closeKnobsPanel()
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    // Re-anchor to the toolbar button on every open, unless the user has
    // explicitly dragged the panel or a persisted position is stored in
    // the hash. The initial mount may have computed defaultPosition()
    // before the toolbar button entered the DOM — recomputing here
    // guarantees the panel pops out from the button like a dropdown.
    const hasStoredPosition =
      getParam(KNOBS_PANEL_X_KEY) != null && getParam(KNOBS_PANEL_Y_KEY) != null
    if (!userMovedRef.current && !hasStoredPosition) {
      // requestAnimationFrame so the toolbar button + panel have
      // paint-stable bounds (measure the panel's real height to anchor
      // it 32px above the button accurately).
      const frame = window.requestAnimationFrame(() => {
        setPosition(defaultPosition(panelRef.current))
      })
      return () => window.cancelAnimationFrame(frame)
    }
    return undefined
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    function handleResize() {
      setPosition(current => clampKnobsPanelPosition(current, panelRef.current))
    }

    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [open])

  useEffect(() => {
    if (!dragging) return undefined

    function handlePointerMove(event) {
      const drag = dragRef.current
      if (!drag) return
      const next = clampKnobsPanelPosition({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      }, panelRef.current)
      setPosition(next)
      drag.latest = next
    }

    function handlePointerUp() {
      const latest = dragRef.current?.latest
      setDragging(false)
      dragRef.current = null
      if (latest) {
        userMovedRef.current = true
        setParam(KNOBS_PANEL_X_KEY, Math.round(latest.x))
        setParam(KNOBS_PANEL_Y_KEY, Math.round(latest.y))
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragging])

  const resolvedKnobs = useMemo(() => {
    if (!routeInfo.prototypeName) return []
    return filterKnobsForRoute(getPrototypeKnobs(routeInfo.prototypeName), routeInfo.route)
  }, [routeInfo.prototypeName, routeInfo.route])

  const title = routeInfo.prototypeName ? `Knobs — ${routeInfo.prototypeName}` : 'Knobs'
  const emptyMessage = routeInfo.prototypeName
    ? 'No knobs are defined for this route yet.'
    : 'Open a prototype route to tweak knobs.'

  function handleDragPointerDown(event) {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    const clamped = clampKnobsPanelPosition(position, panelRef.current)
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: clamped.x,
      originY: clamped.y,
      latest: clamped,
    }
    setPosition(clamped)
    setDragging(true)
    event.currentTarget?.setPointerCapture?.(event.pointerId)
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      data-knobs-panel=""
      data-dragging={dragging ? 'true' : 'false'}
      role="dialog"
      aria-label="Prototype knobs"
      aria-hidden={open ? undefined : 'true'}
      hidden={!open}
      style={{ transform: `translate(${Math.round(position.x)}px, ${Math.round(position.y)}px)` }}
    >
      <header className={styles.header}>
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Drag knobs panel"
          onPointerDown={handleDragPointerDown}
        >
          <GripIcon />
        </button>
        <h2
          className={styles.title}
          onPointerDown={handleDragPointerDown}
        >
          {title}
        </h2>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close knobs panel"
          onClick={closeKnobsPanel}
        >
          ×
        </button>
      </header>
      <div className={styles.body}>
        <KnobsForm
          knobs={resolvedKnobs}
          route={routeInfo.route}
          emptyMessage={emptyMessage}
          className={resolvedKnobs.length === 0 ? styles.emptyState : undefined}
        />
      </div>
    </section>
  )
}
