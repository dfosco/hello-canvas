import { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import styles from './ConnectorLayer.module.css'
import { getConnectorDefaults, getConnectorConfig } from './widgets/widgetConfig.js'
import { getAnchorPoint, buildPath } from './connectorGeometry.js'

const connectorConfig = getConnectorDefaults()

const VALID_ENDPOINT_STYLES = new Set(['circle', 'arrow-start', 'arrow-end', 'none'])

/**
 * Resolve the effective endpoint style for a connector end.
 * Precedence: per-connector override → per-widget-type override → global default.
 *
 * @param {Object} conn — connector object
 * @param {string} widgetType — widget type at this end
 * @param {'start'|'end'} side — which end of the connector
 */
function getEndpointStyle(conn, widgetType, side) {
  const override = side === 'start' ? conn.startEndpoint : conn.endEndpoint
  if (VALID_ENDPOINT_STYLES.has(override)) return override
  const key = side === 'start' ? 'startEndpoint' : 'endEndpoint'
  const widgetConnectors = getConnectorConfig(widgetType)
  if (widgetConnectors.defaults?.[key]) return widgetConnectors.defaults[key]
  return connectorConfig[key]
}

/**
 * Convert a connector's `data` object ({ variant: 'dashed' }) into JSX-spreadable
 * data-* attributes ({ 'data-variant': 'dashed' }). Values are coerced to strings;
 * null/undefined keys are skipped.
 */
function toDataAttrs(data) {
  if (!data || typeof data !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue
    const key = k.startsWith('data-') ? k : `data-${k}`
    out[key] = typeof v === 'string' ? v : String(v)
  }
  return out
}

/**
 * Render an endpoint shape (circle, arrow-start, arrow-end, or none) at the given point.
 * - "circle" (default): filled dot
 * - "arrow-start": arrowhead pointing toward the start widget
 * - "arrow-end": arrowhead pointing toward the end widget
 * - "none": invisible drag target only
 *
 * @param {number} x,y — position of this endpoint
 * @param {Object} startPt — position of the connector's start endpoint
 * @param {Object} endPt — position of the connector's end endpoint
 */
const ENDPOINT_HIT_PADDING = 8

function EndpointShape({ x, y, startPt, endPt, style, onPointerDown }) {
  const passThrough = !onPointerDown ? { pointerEvents: 'none' } : {}
  const hitRadius = connectorConfig.endpointRadius + ENDPOINT_HIT_PADDING
  const hitTarget = onPointerDown ? (
    <circle cx={x} cy={y} r={hitRadius}
      className={styles.endpointHitArea}
      onPointerDown={onPointerDown}
    />
  ) : null
  if (style === 'none') {
    return (
      <>
        {hitTarget}
        <circle cx={x} cy={y} r={connectorConfig.endpointRadius}
          style={{ fill: 'transparent', stroke: 'none', ...(onPointerDown ? { pointerEvents: 'none' } : { pointerEvents: 'none' }) }}
        />
      </>
    )
  }
  if (style === 'arrow-start' || style === 'arrow-end') {
    const size = connectorConfig.endpointRadius * 2.2
    const target = style === 'arrow-start' ? startPt : endPt
    const dx = target.x - x
    const dy = target.y - y
    const rotation = (Math.atan2(dy, dx) * 180 / Math.PI) + 90
    return (
      <>
        {hitTarget}
        <polygon
          points={`0,${-size} ${size * 0.6},${size * 0.5} ${-size * 0.6},${size * 0.5}`}
          transform={`translate(${x},${y}) rotate(${rotation})`}
          className={styles.connectorEndpoint}
          style={passThrough}
        />
      </>
    )
  }
  return (
    <>
      {hitTarget}
      <circle cx={x} cy={y} r={connectorConfig.endpointRadius}
        className={styles.connectorEndpoint}
        style={passThrough}
      />
    </>
  )
}

/** Shared inline style for both SVG layers (CSS vars for connector theming). */
const svgLayerStyle = {
  width: '100000px',
  height: '100000px',
  '--connector-stroke': connectorConfig.stroke,
  '--connector-stroke-width': `${connectorConfig.strokeWidth}px`,
  '--connector-hover-stroke': connectorConfig.hoverStroke,
  '--connector-hover-stroke-width': `${connectorConfig.hoverStrokeWidth}px`,
  '--connector-endpoint-fill': connectorConfig.endpointFill,
  '--connector-endpoint-stroke': connectorConfig.endpointStroke,
  '--connector-endpoint-stroke-width': `${connectorConfig.endpointStrokeWidth}px`,
  '--connector-hit-area-width': `${connectorConfig.hitAreaStrokeWidth}px`,
  '--connector-drag-stroke': connectorConfig.dragStroke,
  '--connector-drag-stroke-width': `${connectorConfig.dragStrokeWidth}px`,
  '--connector-drag-dasharray': connectorConfig.dragDasharray,
  '--connector-drag-opacity': connectorConfig.dragOpacity,
}

/**
 * Two-layer SVG overlay for connector lines and endpoints.
 *
 * Stacking (bottom → top):
 *   connectorLayer  (z-index 1) — paths, hit areas, broadcast animations
 *   widgets         (z-index 2/3) — normal / selected
 *   endpointLayer   (z-index 4) — anchor dots & drag targets
 *
 * Must be placed inside the same zoom-transformed container as widgets.
 */
export default function ConnectorLayer({
  connectors = [],
  widgets = [],
  selectedWidgetIds,
  onRemove,
  onEndpointDrag,
  dragPreview,
  hidden = false,
}) {
  const widgetMap = useMemo(() => {
    const map = new Map()
    for (const w of widgets) {
      map.set(w.id, w)
    }
    return map
  }, [widgets])

  // Bumps when any widget's DOM bounds change so connector anchors re-resolve.
  // Without this, terminal/agent widgets (ghostty WASM, async-mounted terminal
  // sessions) anchor connectors to their initial small bounds — when the
  // widget grows to its final size, anchors render inside the widget chrome
  // until something else triggers a re-render (selection, drag, etc.).
  const [geometryVersion, setGeometryVersion] = useState(0)
  const rafRef = useRef(null)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const scheduleBump = () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        setGeometryVersion((v) => v + 1)
      })
    }
    const observer = new ResizeObserver(scheduleBump)
    const observed = []
    for (const w of widgets) {
      const wrapper = document.getElementById(w.id)
      if (!wrapper) continue
      const inner = wrapper.querySelector('[data-widget-id]') || wrapper.firstElementChild
      const target = inner || wrapper
      observer.observe(target)
      observed.push(target)
    }
    return () => {
      observer.disconnect()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      observed.length = 0
    }
  }, [widgets])

  const handleClick = useCallback((e, connectorId) => {
    e.stopPropagation()
    onRemove?.(connectorId)
  }, [onRemove])

  // Pre-compute connector geometry once, shared by both SVG layers
  const resolved = useMemo(() => connectors.map((conn) => {
    const startWidget = widgetMap.get(conn.start?.widgetId)
    const endWidget = widgetMap.get(conn.end?.widgetId)
    if (!startWidget || !endWidget) return null
    const startPt = getAnchorPoint(startWidget, conn.start.anchor)
    const endPt = getAnchorPoint(endWidget, conn.end.anchor)
    const d = buildPath(startPt, conn.start.anchor, endPt, conn.end.anchor)
    const startStyle = getEndpointStyle(conn, startWidget.type, 'start')
    const endStyle = getEndpointStyle(conn, endWidget.type, 'end')
    const isBroadcast = conn.meta?.messagingMode === 'two-way'
    const startSelected = selectedWidgetIds?.has(conn.start?.widgetId)
    const endSelected = selectedWidgetIds?.has(conn.end?.widgetId)
    const reverseAnim = endSelected && !startSelected
    // Per-connector presentational overrides authored in JSONL.
    const customClassName = typeof conn.className === 'string' ? conn.className : ''
    const customStyle = conn.style && typeof conn.style === 'object' ? conn.style : null
    const customDataAttrs = toDataAttrs(conn.data)
    return {
      conn, startPt, endPt, d, startStyle, endStyle, isBroadcast, reverseAnim,
      customClassName, customStyle, customDataAttrs,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }).filter(Boolean), [connectors, widgetMap, selectedWidgetIds, geometryVersion])

  const hiddenClass = hidden ? styles.connectorLayerHidden : ''

  return (
    <>
      {/* Back layer: connector paths (behind widgets) */}
      <svg
        className={`${styles.connectorLayer} ${hiddenClass}`}
        style={svgLayerStyle}
      >
        {resolved.map(({ conn, d, isBroadcast, reverseAnim, customClassName, customStyle, customDataAttrs }) => (
          <g
            key={conn.id}
            data-connector-id={conn.id}
            data-connector-type={conn.connectorType || 'default'}
            className={customClassName || undefined}
            style={customStyle || undefined}
            {...(customDataAttrs || {})}
          >
            <path d={d} className={styles.connectorPathHitArea}
              onClick={(e) => handleClick(e, conn.id)} />
            <path d={d}
              className={`${styles.connectorPath}${isBroadcast ? ` ${styles.connectorBroadcast}` : ''}`}
              onClick={(e) => handleClick(e, conn.id)} />
            {isBroadcast && (
              <path d={d}
                className={`${styles.broadcastFlow}${reverseAnim ? ` ${styles.broadcastFlowReverse}` : ''}`} />
            )}
          </g>
        ))}

        {dragPreview && (
          <path
            d={buildPath(
              dragPreview.startPt, dragPreview.startAnchor,
              dragPreview.endPt, dragPreview.endAnchor || dragPreview.startAnchor,
              !dragPreview.snapTarget,
            )}
            className={dragPreview.snapTarget ? styles.connectorPath : styles.dragPreviewPath}
          />
        )}
      </svg>

      {/* Front layer: endpoint anchors (above widgets) */}
      <svg
        className={`${styles.endpointLayer} ${hiddenClass}`}
        style={svgLayerStyle}
      >
        {resolved.map(({ conn, startPt, endPt, startStyle, endStyle, customClassName, customStyle, customDataAttrs }) => (
          <g
            key={conn.id}
            data-connector-id={conn.id}
            data-connector-type={conn.connectorType || 'default'}
            className={customClassName || undefined}
            style={customStyle || undefined}
            {...(customDataAttrs || {})}
          >
            <EndpointShape x={startPt.x} y={startPt.y} startPt={startPt} endPt={endPt} style={startStyle}
              onPointerDown={onEndpointDrag ? (e) => { e.stopPropagation(); e.preventDefault(); onEndpointDrag(conn, 'start', e) } : undefined} />
            <EndpointShape x={endPt.x} y={endPt.y} startPt={startPt} endPt={endPt} style={endStyle}
              onPointerDown={onEndpointDrag ? (e) => { e.stopPropagation(); e.preventDefault(); onEndpointDrag(conn, 'end', e) } : undefined} />
          </g>
        ))}

        {dragPreview?.snapTarget && (
          <EndpointShape x={dragPreview.endPt.x} y={dragPreview.endPt.y}
            startPt={dragPreview.startPt} endPt={dragPreview.endPt} style={connectorConfig.endEndpoint} />
        )}
      </svg>
    </>
  )
}

export { getAnchorPoint, buildPath }
