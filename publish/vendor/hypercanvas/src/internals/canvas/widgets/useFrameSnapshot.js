/**
 * Client-side Frame snapshot hook: reads the persisted preview for a Frame
 * target from Core, schedules a capture when it is missing or stale, and
 * refreshes when the capture service announces an update for this widget.
 *
 * The descriptor carries data URLs (never base64 in canvas JSONL) and keeps
 * the last successful preview visible through refreshes and failures.
 *
 * State is stored keyed by the target identity it was read for; the visible
 * snapshot is derived during render, so a target change never shows another
 * route's preview and no state is written synchronously inside effects.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { frameTargetIdentityKey } from '../../../core/canvas/frameSnapshotViewport.js'

const CAPTURE_DEBOUNCE_MS = 500
const EVENT_NAME = 'storyboard:frame-snapshot:updated'

function apiBase() {
  return (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
}

function serializeTarget(target) {
  const params = {}
  for (const [key, value] of Object.entries(target || {})) {
    if (value !== undefined && value !== null && value !== '') params[key] = String(value)
  }
  return params
}

/** Side-effect-free descriptor read. Returns null when unavailable. */
export async function readFrameSnapshotApi(target, { theme } = {}) {
  const params = new URLSearchParams(serializeTarget(target))
  if (theme) params.set('theme', theme)
  const response = await fetch(`${apiBase()}/_storyboard/frame-snapshot?${params}`)
  if (!response.ok) return null
  const { snapshot } = await response.json().catch(() => ({ snapshot: null }))
  return snapshot || null
}

/** Request a capture. Throws a coded error when capture is not possible. */
export async function captureFrameSnapshotApi(target, { theme = 'light', force = false, widgetId, origin } = {}) {
  const response = await fetch(`${apiBase()}/_storyboard/frame-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...serializeTarget(target),
      theme,
      force,
      ...(widgetId ? { widgetId } : {}),
      origin: origin ?? (typeof window !== 'undefined' ? window.location.origin : undefined),
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error || 'Frame capture failed'), { code: payload?.code })
  }
  return payload?.snapshot || null
}

/**
 * Subscribe to persisted Frame snapshots for one target.
 *
 * Returns `{ snapshot, reload }` where `snapshot` is
 * `{ status, light, dark, sourceKey, stale?, error? }` or null while loading
 * or for a target without a descriptor. When only the viewport changes (same
 * logical route), the previous preview is carried over and marked stale
 * instead of leaving the Frame blank.
 */
export function useFrameSnapshot({ target, theme, captureTheme = null, autoCapture = true, widgetId = null } = {}) {
  const [entry, setEntry] = useState({ key: null, descriptor: null })
  const requestToken = useRef(0)
  const debounceTimer = useRef(null)
  const lastReadyRef = useRef(null) // { identityKey, descriptor }

  // A failed capture retains any visible preview; without one, it surfaces
  // the actionable error instead of leaving an eternal capture indicator.
  const recordCaptureFailure = useCallback((token, key, identityKey, cause) => {
    if (token !== requestToken.current) return
    const ready = lastReadyRef.current
    if (ready?.identityKey === identityKey && ready?.descriptor) return
    setEntry({ key, descriptor: { status: 'error', light: null, dark: null, error: { code: cause?.code || 'FRAME_CAPTURE_FAILED', message: cause?.message || 'Frame capture failed' } } })
  }, [])

  const currentKey = target ? `${frameTargetIdentityKey(target)}|${theme || ''}` : null
  // initializing: a target exists but no descriptor response has arrived for
  // it yet. `snapshot` is derived, so a target change never shows another
  // route's preview and no state is written synchronously inside effects.
  const initializing = Boolean(target) && entry.key !== currentKey
  const snapshot = entry.key !== null && entry.key === currentKey ? entry.descriptor : null

  const load = useCallback(async ({ capture = false, force = false } = {}) => {
    if (!target) {
      setEntry({ key: null, descriptor: null })
      return
    }
    const token = ++requestToken.current
    const key = `${frameTargetIdentityKey(target)}|${theme || ''}`
    let next = null
    let readError = null
    try {
      next = await readFrameSnapshotApi(target, { theme })
    } catch (cause) { readError = cause }
    if (token !== requestToken.current) return
    const identityKey = frameTargetIdentityKey(target)
    const lastReady = lastReadyRef.current
    const carried = (next || readError) && lastReady?.identityKey === identityKey && lastReady?.descriptor && (next ? (next.status === 'missing' || next.status === 'error') : true)
      ? { ...lastReady.descriptor, status: 'stale', stale: true }
      : null
    // An unreadable snapshot service (missing routes on an older server
    // process, Core unavailable) must surface as an error state, not an
    // eternal capture indicator.
    const failure = !next && !carried
      ? { status: 'error', light: null, dark: null, error: { code: 'FRAME_SNAPSHOT_UNAVAILABLE', message: 'Preview service unavailable — restart Hypercanvas and reload' } }
      : null
    const display = carried || next || failure
    setEntry({ key, descriptor: display })
    if (display && !carried && display.light?.dataUrl && display.status !== 'stale') {
      lastReadyRef.current = { identityKey, descriptor: display }
    }
    if (capture && force) {
      // Explicit refresh — recapture immediately.
      try {
        const fresh = await captureFrameSnapshotApi(target, { theme: captureTheme || theme || 'light', force: true, widgetId })
        if (token !== requestToken.current || !fresh) return
        setEntry({ key, descriptor: fresh })
        if (fresh.light?.dataUrl) lastReadyRef.current = { identityKey, descriptor: fresh }
      } catch (cause) {
        recordCaptureFailure(token, key, identityKey, cause)
      }
      return
    }
    if (!autoCapture) return
    if (display.status !== 'missing' && display.status !== 'stale') return
    // Missing or stale preview — schedule a debounced recapture.
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      void (async () => {
        const captureToken = requestToken.current
        try {
          const fresh = await captureFrameSnapshotApi(target, { theme: captureTheme || theme || 'light', widgetId })
          if (captureToken !== requestToken.current || !fresh) return
          setEntry({ key, descriptor: fresh })
          if (fresh.light?.dataUrl) lastReadyRef.current = { identityKey, descriptor: fresh }
        } catch (cause) {
          recordCaptureFailure(captureToken, key, identityKey, cause)
        }
      })()
    }, CAPTURE_DEBOUNCE_MS)
  }, [autoCapture, captureTheme, recordCaptureFailure, target, theme, widgetId])

  // Load whenever the target or theme changes.
  useEffect(() => {
    requestToken.current += 1
    if (!target) return undefined
    // load()'s state writes all happen asynchronously after the descriptor
    // fetch; the synchronous effect body only invalidates and subscribes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [load, target])

  // Follow capture-service updates for this widget.
  useEffect(() => {
    function handleUpdate(event) {
      const data = event?.detail
      if (!data) return
      const current = lastReadyRef.current?.descriptor
      const matches = (current?.sourceKey && data.sourceKey === current.sourceKey)
        || (widgetId && data.widgetId === widgetId)
      if (matches) void load()
    }
    window.addEventListener(EVENT_NAME, handleUpdate)
    return () => window.removeEventListener(EVENT_NAME, handleUpdate)
  }, [load, widgetId])

  useEffect(() => () => {
    requestToken.current += 1
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
  }, [])

  const reload = useCallback((options = {}) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    return load(options)
  }, [load])

  return { snapshot, initializing, reload }
}
