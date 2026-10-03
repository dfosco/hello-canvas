/**
 * Stoppable-area drop router for native (Tauri) and browser file drags.
 *
 * Desktop: the webview intercepts OS file drags and emits `tauri://drag-*`
 * window events instead of HTML5 drop events. The router listens once, converts
 * physical-pixel positions to CSS pixels, hit-tests registered stoppable areas
 * at the cursor, and delivers each drop to exactly one area — the innermost
 * enabled area under the point whose `accepts(drop)` passes. A claimed drop
 * stops surrounding surfaces from reacting. Unclaimed drops are ignored.
 *
 * Browser: Tauri events are unavailable, so each area attaches HTML5 drag
 * listeners to its own element (see useDropArea) and claims drops with the
 * same innermost-wins semantics via bubbling + stopPropagation.
 */

import { isTauriAvailable, listen } from '../../core/notebook/tauri-bridge.js'

function devlog(message, details = {}) {
  console.debug('[devlog][drop-router]', message, details)
}

const areas = new Map()
let areaSeq = 0
let unlisteners = null
let starting = false
const session = { active: false, paths: [], hoveredId: null }

function nativeClientPoints(position) {
  const raw = { x: Number(position?.x) || 0, y: Number(position?.y) || 0 }
  const ratio = window.devicePixelRatio || 1
  const scaled = { x: raw.x / ratio, y: raw.y / ratio }

  // Wry's macOS drag handler reports NSPoint coordinates even though the
  // shared Tauri payload is typed as a physical position. Other platforms
  // generally report physical pixels, so retain both conventions and use the
  // platform-specific one first.
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '')
  return isMac ? [raw, scaled] : [scaled, raw]
}

function isEnabled(area) {
  return area.disabled ? !area.disabled() : true
}

function acceptsDrop(area, drop) {
  try {
    return area.accepts ? area.accepts(drop) !== false : true
  } catch {
    return false
  }
}

/** Innermost enabled area whose element contains the hit and accepts the drop. */
function claimFor(points, drop) {
  for (const point of points) {
    const area = claimForPoint(point, drop)
    if (area) return area
  }
  return null
}

function claimForPoint(point, drop) {
  const hit = document.elementFromPoint(point.x, point.y)
  if (!hit) return null
  let best = null
  let bestElement = null
  for (const area of areas.values()) {
    const element = area.getElement?.()
    if (!element || !isEnabled(area) || !element.contains(hit)) continue
    if (!acceptsDrop(area, drop)) continue
    // Both elements contain the hit, so one must contain the other: keep the
    // existing area when it is the deeper (inner) one, i.e. when the new
    // element is an ancestor of it.
    if (bestElement && element.contains(bestElement)) continue
    best = area
    bestElement = element
  }
  return best
}

function setHovered(nextId, paths) {
  if (session.hoveredId === nextId) return
  if (session.hoveredId) {
    try { areas.get(session.hoveredId)?.onDragStateChange?.({ isOver: false, paths }) } catch { /* area callback */ }
  }
  session.hoveredId = nextId
  if (nextId) {
    try { areas.get(nextId)?.onDragStateChange?.({ isOver: true, paths }) } catch { /* area callback */ }
  }
}

function resetSession() {
  setHovered(null)
  session.active = false
  session.paths = []
}

function pathsFrom(payload) {
  const paths = payload?.paths
  return Array.isArray(paths) ? paths : []
}

function handleEnter(payload) {
  devlog('drag-enter', payload)
  const paths = pathsFrom(payload)
  session.active = true
  session.paths = paths
  const area = claimFor(nativeClientPoints(payload?.position), { paths, files: null })
  setHovered(area ? area.id : null, paths)
}

function handleOver(payload) {
  devlog('drag-over', payload)
  if (!session.active) session.active = true
  const area = claimFor(nativeClientPoints(payload?.position), { paths: session.paths, files: null })
  setHovered(area ? area.id : null, session.paths)
}

function handleDrop(payload) {
  devlog('drag-drop', payload)
  const paths = pathsFrom(payload)
  const points = nativeClientPoints(payload?.position)
  const area = claimFor(points, { paths, files: null })
  const point = points[0]
  const claimedId = area ? area.id : null
  resetSession()
  if (!area) {
    devlog('drop unclaimed', { point, paths })
    return null
  }
  devlog('drop claimed', { area: claimedId, point, paths })
  try {
    area.onDrop?.({ paths, files: null, position: point })
  } catch (error) {
    console.error('[storyboard] Drop area ingestion failed:', error)
  }
  return claimedId
}

/**
 * Register a stoppable drop area.
 *
 * `area` shape:
 * - `getElement()` — the claim hit-box (DOM element), read lazily
 * - `accepts(drop)` — optional predicate; `drop` is `{ paths, files }`
 *   (`files` is null on the native path, `paths` null in browser fallbacks)
 * - `onDrop(drop)` — ingestion callback; `drop` also carries `position` (CSS px)
 *   on the native path
 * - `onDragStateChange({ isOver, paths })` — optional hover notifications
 * - `disabled()` — optional gate, checked at event time
 *
 * Returns an unregister function.
 */
export function registerDropArea(area) {
  const id = `drop-area-${++areaSeq}`
  const registered = { ...area, id }
  areas.set(id, registered)
  devlog('area registered', { id, areaCount: areas.size })
  ensureRouter()
  return function unregister() {
    devlog('area unregistered', { id })
    if (areas.get(id) === registered) areas.delete(id)
    if (session.hoveredId === id) setHovered(null)
  }
}

async function ensureRouter() {
  const available = isTauriAvailable()
  devlog('ensure router', { hasListeners: Boolean(unlisteners), starting, available })
  if (unlisteners || starting || !available) return
  starting = true
  try {
    const remove = []
    remove.push(await listen('tauri://drag-enter', event => handleEnter(event.payload)))
    remove.push(await listen('tauri://drag-over', event => handleOver(event.payload)))
    remove.push(await listen('tauri://drag-drop', event => handleDrop(event.payload)))
    remove.push(await listen('tauri://drag-leave', () => resetSession()))
    unlisteners = remove
  } catch (error) {
    devlog('native drag listener setup failed', { message: error?.message, error })
    console.warn('[storyboard] Native drag events unavailable:', error)
  } finally {
    starting = false
  }
}

/** Test hook: tear down router state between tests. */
export function __resetDropRouter() {
  for (const unlisten of unlisteners ?? []) {
    try { unlisten() } catch { /* already gone */ }
  }
  unlisteners = null
  starting = false
  areas.clear()
  areaSeq = 0
  resetSession()
}
