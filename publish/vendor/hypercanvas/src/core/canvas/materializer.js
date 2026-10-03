/**
 * Canvas JSONL Materializer
 *
 * Pure, framework-agnostic module that replays a stream of canvas events
 * into a materialized canvas state object. Zero dependencies.
 *
 * Event types:
 *   canvas_created   — full initial state (first line)
 *   widget_added     — append a widget
 *   widget_updated   — patch widget props (may carry `prevProps` for undo)
 *   widget_moved     — update widget position (may carry `prevPosition` for undo)
 *   widget_removed   — remove a widget by id (carries `widget` for undo;
 *                      legacy events only had `widgetId`)
 *   settings_updated — patch canvas-level settings (may carry `prevSettings` for undo)
 *   source_updated   — replace the sources array (may carry `prevSources` for undo)
 *   widgets_replaced — replace the entire widgets array (compaction only, not undoable)
 *   connector_added  — append a connector between two widgets
 *   connector_removed — remove a connector by id (carries `connector` for undo;
 *                       legacy events only had `connectorId`)
 *   connectors_replaced — replace the entire connectors array (compaction only, not undoable)
 *   connector_waypoints_set     — set/replace manual routing waypoints (may carry `prevWaypoints`)
 *   connector_waypoints_cleared — drop manual routing (may carry `prevWaypoints`)
 *   connector_updated — patch connector anchors/meta (may carry `prevUpdates` for undo)
 *
 * Event metadata (all events):
 *   id        — short random id stamped by the server, used by undo/redo
 *               to target a specific event. Legacy events without an id are
 *               non-undoable but materialize normally.
 *   meta.kind — present on undo/redo emissions ('undo' | 'redo'). The
 *               materializer ignores meta; it's informational for tools
 *               and a future timeline UI.
 *   meta.of   — the id of the event this undo/redo targets.
 *
 * Undo model: the materializer never "skips" events. Undo is a normal
 * forward event (a real `widget_added`/`widget_removed`/`widget_updated`)
 * that happens to carry meta.kind === 'undo'. Folding is one pass, no
 * special cases. Inverse payloads (`prevProps`, `prevPosition`, full
 * `widget`/`connector` on removes, etc.) are read only by the server's
 * POST /undo and POST /redo endpoints when computing the inverse event.
 */

/**
 * Split a text blob into top-level JSON object snippets.
 * Supports strict JSONL and accidentally concatenated objects.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitJsonObjects(text) {
  const chunks = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }

    if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start >= 0) {
        chunks.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }

  return chunks
}

/**
 * Parse canvas event text into an array of event objects.
 * Blank lines and malformed JSON snippets are skipped.
 *
 * @param {string} text - Raw canvas event file contents
 * @returns {object[]} Parsed event objects
 */
export function parseCanvasJsonl(text) {
  const events = []
  for (const snippet of splitJsonObjects(text || '')) {
    try {
      events.push(JSON.parse(snippet))
    } catch {
      // Skip malformed snippets
    }
  }
  return events
}

/**
 * Apply a single event to a state object and return the next state.
 *
 * Pure helper — exported so the client can apply server-acknowledged
 * undo/redo events optimistically without waiting for an HMR push (which
 * would otherwise be ignored by the dirty-guard on CanvasPage).
 *
 * Returns the same `state` reference if the event was unknown or had no
 * effect, so callers can cheaply detect no-ops.
 *
 * @param {object} state - Current canvas state (widgets, connectors, sources, settings)
 * @param {object} evt - Canvas event object
 * @returns {object} Next state
 */
export function applyEvent(state, evt) {
  if (!evt || typeof evt !== 'object') return state

  switch (evt.event) {
    case 'canvas_created': {
      const initial = { ...evt }
      delete initial.event
      delete initial.timestamp
      if (!initial.connectors) initial.connectors = []
      return initial
    }

    case 'widget_added': {
      const widgets = state.widgets || []
      return { ...state, widgets: [...widgets, evt.widget] }
    }

    case 'widget_updated': {
      return {
        ...state,
        widgets: (state.widgets || []).map((w) =>
          w.id === evt.widgetId
            ? { ...w, props: { ...w.props, ...evt.props } }
            : w,
        ),
      }
    }

    case 'widget_moved': {
      return {
        ...state,
        widgets: (state.widgets || []).map((w) =>
          w.id === evt.widgetId ? { ...w, position: evt.position } : w,
        ),
      }
    }

    case 'widget_removed': {
      const removedId = evt.widget?.id ?? evt.widgetId
      const next = {
        ...state,
        widgets: (state.widgets || []).filter((w) => w.id !== removedId),
      }
      if (state.connectors?.length) {
        next.connectors = state.connectors.filter(
          (c) => c.start.widgetId !== removedId && c.end.widgetId !== removedId,
        )
      }
      return next
    }

    case 'settings_updated': {
      if (!evt.settings) return state
      return { ...state, ...evt.settings }
    }

    case 'source_updated': {
      return { ...state, sources: evt.sources }
    }

    case 'widgets_replaced': {
      const next = { ...state, widgets: evt.widgets }
      if (state.connectors?.length) {
        const widgetIds = new Set((evt.widgets || []).map((w) => w.id))
        next.connectors = state.connectors.filter(
          (c) => widgetIds.has(c.start.widgetId) && widgetIds.has(c.end.widgetId),
        )
      }
      return next
    }

    case 'connector_added': {
      const connectors = state.connectors || []
      return { ...state, connectors: [...connectors, evt.connector] }
    }

    case 'connector_removed': {
      const removedId = evt.connector?.id ?? evt.connectorId
      return {
        ...state,
        connectors: (state.connectors || []).filter((c) => c.id !== removedId),
      }
    }

    case 'connectors_replaced': {
      return { ...state, connectors: evt.connectors || [] }
    }

    case 'connector_waypoints_set': {
      return {
        ...state,
        connectors: (state.connectors || []).map((c) => {
          if (c.id !== evt.connectorId) return c
          const waypoints = Array.isArray(evt.waypoints) ? evt.waypoints : []
          return { ...c, waypoints }
        }),
      }
    }

    case 'connector_waypoints_cleared': {
      return {
        ...state,
        connectors: (state.connectors || []).map((c) => {
          if (c.id !== evt.connectorId) return c
          const { waypoints, ...rest } = c // eslint-disable-line no-unused-vars
          return rest
        }),
      }
    }

    case 'connector_updated': {
      return {
        ...state,
        connectors: (state.connectors || []).map((c) => {
          if (c.id !== evt.connectorId) return c
          const { startAnchor, endAnchor, meta, style, data, className, ...rest } = evt.updates || {}
          const mergedMeta = { ...(c.meta || {}), ...(meta || {}) }
          if (meta?.messaging) {
            mergedMeta.messaging = { ...(c.meta?.messaging || {}), ...meta.messaging }
          }
          if (meta && meta.messagingMode === null) {
            delete mergedMeta.messagingMode
          }
          const start = startAnchor
            ? { ...c.start, anchor: startAnchor }
            : c.start
          const end = endAnchor
            ? { ...c.end, anchor: endAnchor }
            : c.end
          const next = { ...c, ...rest, meta: mergedMeta, id: c.id, start, end }
          if (style === null) delete next.style
          else if (style && typeof style === 'object') next.style = { ...(c.style || {}), ...style }
          if (data === null) delete next.data
          else if (data && typeof data === 'object') next.data = { ...(c.data || {}), ...data }
          if (className === null) delete next.className
          else if (typeof className === 'string') next.className = className
          return next
        }),
      }
    }

    default:
      // Unknown events are silently ignored (forward compatibility)
      return state
  }
}

/**
 * Materialize a canvas state from an ordered array of events.
 *
 * @param {object[]} events - Array of event objects (first should be canvas_created)
 * @returns {object} Materialized canvas state
 */
export function materialize(events) {
  let state = {}

  for (const evt of events) {
    state = applyEvent(state, evt)
  }

  // Derive connectorIds on widgets from the connectors array
  if (state.connectors?.length && state.widgets?.length) {
    // Build a map: widgetId → Set of connectorIds
    const widgetConnMap = new Map()
    for (const conn of state.connectors) {
      for (const endpoint of [conn.start, conn.end]) {
        if (!widgetConnMap.has(endpoint.widgetId)) {
          widgetConnMap.set(endpoint.widgetId, new Set())
        }
        widgetConnMap.get(endpoint.widgetId).add(conn.id)
      }
    }
    state.widgets = state.widgets.map((w) => {
      const ids = widgetConnMap.get(w.id)
      return ids ? { ...w, connectorIds: [...ids] } : w
    })
  }

  return state
}

/**
 * Convenience: parse JSONL text and materialize in one step.
 *
 * @param {string} text - Raw JSONL file contents
 * @returns {object} Materialized canvas state
 */
export function materializeFromText(text) {
  return materialize(parseCanvasJsonl(text))
}

/**
 * Serialize a single event object to a JSONL line (no trailing newline).
 *
 * @param {object} event - Event object
 * @returns {string} Single-line JSON string
 */
export function serializeEvent(event) {
  return JSON.stringify(event)
}
