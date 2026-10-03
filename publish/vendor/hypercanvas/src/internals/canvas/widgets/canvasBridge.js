/**
 * Canvas bridge — small helpers around `window.__storyboardCanvasBridgeState`,
 * the shared snapshot of canvas widgets + connectors published by CanvasPage.
 *
 * Used by widgets that need to react to their own connectors (KnobsWidget
 * resolves its targets here; PrototypeEmbed asks "is any knobs widget
 * connected to me?" so it can flip a URL flag on its iframe src).
 */
import { useEffect, useState } from 'react'

export function readCanvasBridge() {
  if (typeof window === 'undefined') return { widgets: [], connectors: [] }
  const bridge = window.__storyboardCanvasBridgeState
  return {
    widgets: Array.isArray(bridge?.widgets) ? bridge.widgets : [],
    connectors: Array.isArray(bridge?.connectors) ? bridge.connectors : [],
  }
}

export function useCanvasBridge() {
  const [bridge, setBridge] = useState(() => readCanvasBridge())

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const sync = () => setBridge(readCanvasBridge())
    sync()
    document.addEventListener('storyboard:canvas:bridge-updated', sync)
    return () => document.removeEventListener('storyboard:canvas:bridge-updated', sync)
  }, [])

  return bridge
}

export function connectorEndpoint(connector, side) {
  if (!connector) return null
  if (side === 'start') {
    return connector.start?.widgetId ?? connector.from ?? connector.source?.widgetId ?? connector.source ?? null
  }
  return connector.end?.widgetId ?? connector.to ?? connector.target?.widgetId ?? connector.target ?? null
}

/**
 * Return widget ids connected to `widgetId` (either direction).
 */
export function connectedWidgetIds(widgetId, connectors) {
  const result = new Set()
  for (const connector of connectors || []) {
    const startId = connectorEndpoint(connector, 'start')
    const endId = connectorEndpoint(connector, 'end')
    if (startId === widgetId && endId) result.add(endId)
    else if (endId === widgetId && startId) result.add(startId)
  }
  return result
}

/**
 * Returns true when at least one connected widget has `type === 'knobs'`.
 * PrototypeEmbed uses this to add `?sb_knobs=1` to its iframe src so the
 * embedded prototype's `installKnobsHighlight` activates the in-page
 * outline + label badge for `[data-knob-id]` elements.
 */
export function hasConnectedKnobsWidget(widgetId, widgets, connectors) {
  const widgetMap = new Map((widgets || []).map(w => [w.id, w]))
  for (const id of connectedWidgetIds(widgetId, connectors)) {
    if (widgetMap.get(id)?.type === 'knobs') return true
  }
  return false
}
