import { useCallback, useEffect, useRef, useState } from 'react'
import { connectorIntersectsRect } from './connectorGeometry.js'

/**
 * Returns the bounding-box list for all widgets on the canvas.
 * Each entry: { id, x, y, width, height }
 */
function getWidgetBounds(widgets, componentEntries, fallbackSizes) {
  const bounds = []
  for (const w of (widgets ?? [])) {
    const fb = fallbackSizes[w.type] || { width: 200, height: 150 }
    bounds.push({
      id: w.id,
      x: w?.position?.x ?? 0,
      y: w?.position?.y ?? 0,
      width: w.props?.width ?? fb.width,
      height: w.props?.height ?? fb.height,
    })
  }
  for (const entry of componentEntries) {
    const fb = fallbackSizes['component'] || { width: 200, height: 150 }
    bounds.push({
      id: `jsx-${entry.exportName}`,
      x: entry.sourceData?.position?.x ?? 0,
      y: entry.sourceData?.position?.y ?? 0,
      width: entry.sourceData?.width ?? fb.width,
      height: entry.sourceData?.height ?? fb.height,
    })
  }
  return bounds
}

/** Test whether two axis-aligned rectangles overlap. */
function rectsIntersect(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
}

/**
 * Hook that powers marquee (lasso) selection on the canvas.
 *
 * @param {Object} opts
 * @param {React.RefObject} opts.scrollRef    — ref to the scroll container
 * @param {React.RefObject} opts.zoomRef      — ref holding current zoom (number 25-200)
 * @param {Function} opts.setSelectedWidgetIds — state setter for selected IDs (Set)
 * @param {Array} opts.widgets                — current localWidgets array
 * @param {Array} opts.connectors             — current localConnectors array
 * @param {Array} opts.componentEntries       — current componentEntries array
 * @param {Object} opts.fallbackSizes         — WIDGET_FALLBACK_SIZES map
 * @param {boolean} opts.spaceHeld            — whether the space key is pressed (panning)
 * @param {boolean} opts.isLocalDev           — only enable in local dev
 *
 * @returns {{ marqueeScreenRect: {x,y,w,h}|null, handleMarqueeMouseDown: Function }}
 */
export default function useMarqueeSelect({
  scrollRef,
  zoomRef,
  setSelectedWidgetIds,
  widgets,
  connectors,
  componentEntries,
  fallbackSizes,
  spaceHeld,
  isLocalDev,
}) {
  const [marqueeScreenRect, setMarqueeScreenRect] = useState(null)
  const marqueeState = useRef(null) // { startCanvasX, startCanvasY, startClientX, startClientY }

  /** Convert a client (screen) point to canvas-space coords. */
  const clientToCanvas = useCallback((clientX, clientY) => {
    const el = scrollRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const scale = (zoomRef.current ?? 100) / 100
    return {
      x: (el.scrollLeft + (clientX - rect.left)) / scale,
      y: (el.scrollTop + (clientY - rect.top)) / scale,
    }
  }, [scrollRef, zoomRef])

  // Ref to track active drag listeners for cleanup on unmount
  const cleanupRef = useRef(null)

  const handleMarqueeMouseDown = useCallback((e) => {
    if (!isLocalDev) return
    if (spaceHeld) return
    // Only start on direct background click (not on a widget)
    if (e.button !== 0) return
    if (e.target.closest('[data-tc-x]')) return

    const canvasStart = clientToCanvas(e.clientX, e.clientY)
    marqueeState.current = {
      startCanvasX: canvasStart.x,
      startCanvasY: canvasStart.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    }

    // Minimum drag distance before showing the marquee (avoids flicker on clicks)
    const MIN_DRAG = 4

    function handleMove(ev) {
      const ms = marqueeState.current
      if (!ms) return

      const dx = ev.clientX - ms.startClientX
      const dy = ev.clientY - ms.startClientY
      if (Math.abs(dx) < MIN_DRAG && Math.abs(dy) < MIN_DRAG) return

      const el = scrollRef.current
      if (!el) return
      const containerRect = el.getBoundingClientRect()

      // Content-space rectangle (accounts for scroll offset)
      const sx = Math.min(ms.startClientX, ev.clientX) - containerRect.left + el.scrollLeft
      const sy = Math.min(ms.startClientY, ev.clientY) - containerRect.top + el.scrollTop
      const sw = Math.abs(dx)
      const sh = Math.abs(dy)

      setMarqueeScreenRect({ x: sx, y: sy, w: sw, h: sh })
    }

    function removeListeners() {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      window.removeEventListener('blur', handleCancel)
      cleanupRef.current = null
    }

    function handleCancel() {
      removeListeners()
      marqueeState.current = null
      setMarqueeScreenRect(null)
    }

    function handleUp(ev) {
      removeListeners()

      const ms = marqueeState.current
      marqueeState.current = null
      setMarqueeScreenRect(null)

      if (!ms) return

      // If the user barely moved, treat as a deselect click (unless shift held)
      const dx = ev.clientX - ms.startClientX
      const dy = ev.clientY - ms.startClientY
      if (Math.abs(dx) < MIN_DRAG && Math.abs(dy) < MIN_DRAG) {
        if (!ms.shiftKey) setSelectedWidgetIds(new Set())
        return
      }

      // Compute the selection rect in canvas space
      const canvasEnd = clientToCanvas(ev.clientX, ev.clientY)
      const selRect = {
        x: Math.min(ms.startCanvasX, canvasEnd.x),
        y: Math.min(ms.startCanvasY, canvasEnd.y),
        width: Math.abs(canvasEnd.x - ms.startCanvasX),
        height: Math.abs(canvasEnd.y - ms.startCanvasY),
      }

      // Find intersecting widgets
      const allBounds = getWidgetBounds(widgets, componentEntries, fallbackSizes)
      const selected = new Set()
      for (const wb of allBounds) {
        if (rectsIntersect(selRect, wb)) {
          selected.add(wb.id)
        }
      }

      // Option+marquee: selecting a connector selects its complete connected
      // component, not just the two endpoints touched by the marquee.
      if (ms.altKey && connectors?.length) {
        const widgetMap = new Map()
        for (const w of (widgets ?? [])) widgetMap.set(w.id, w)
        for (const conn of connectors) {
          if (connectorIntersectsRect(conn, widgetMap, selRect)) {
            if (conn.start?.widgetId) selected.add(conn.start.widgetId)
            if (conn.end?.widgetId) selected.add(conn.end.widgetId)
          }
        }
        for (const id of getConnectedWidgetIds(connectors, selected)) selected.add(id)
      }

      // Shift+marquee merges with existing selection; plain marquee replaces it
      if (ms.shiftKey) {
        setSelectedWidgetIds((prev) => {
          const merged = new Set(prev)
          for (const id of selected) merged.add(id)
          return merged
        })
      } else {
        setSelectedWidgetIds(selected)
      }
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    window.addEventListener('blur', handleCancel)
    cleanupRef.current = removeListeners
  }, [isLocalDev, spaceHeld, clientToCanvas, scrollRef, setSelectedWidgetIds, widgets, connectors, componentEntries, fallbackSizes])

  // Clean up listeners if component unmounts mid-drag
  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])

  return { marqueeScreenRect, handleMarqueeMouseDown }
}

export { getWidgetBounds, rectsIntersect }

/** Return every widget reachable from the supplied connector endpoints. */
export function getConnectedWidgetIds(connectors, seedIds) {
  const connected = new Set(seedIds)
  const queue = [...connected]
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    for (const conn of connectors ?? []) {
      const startId = conn.start?.widgetId
      const endId = conn.end?.widgetId
      if (startId === id && endId && !connected.has(endId)) {
        connected.add(endId)
        queue.push(endId)
      } else if (endId === id && startId && !connected.has(startId)) {
        connected.add(startId)
        queue.push(startId)
      }
    }
  }
  return connected
}
