/**
 * Canvas undo/redo: build inverse forward events.
 *
 * Pure module — given a target canvas event (with inverse payload `prev*`
 * fields or full `widget`/`connector` objects on removes), returns the
 * inverse event that, when appended to the JSONL and materialized, restores
 * the state to what it was before the target event was applied.
 *
 * The inverse events are real, valid forward events (widget_added,
 * widget_removed, widget_updated, etc.) — the materializer folds them with
 * no special handling. We tag them with `meta.kind = 'undo' | 'redo'` and
 * `meta.of = <targetEventId>` purely for human readability and DX.
 */

/**
 * Compute the inverse forward event for a given canvas event.
 *
 * @param {object} targetEvent — the event being undone/redone (must have id)
 * @param {'undo'|'redo'} kind — meta.kind to stamp on the returned event
 * @returns {object|null} the inverse event (without timestamp/id — the
 *   caller stamps those via appendEvent), or null if the event is not
 *   undoable (legacy events without inverse payloads, widgets_replaced,
 *   connectors_replaced, canvas_created, etc.).
 */
export function buildInverseEvent(targetEvent, kind) {
  if (!targetEvent || typeof targetEvent !== 'object') return null
  if (!targetEvent.id) return null

  const meta = { kind, of: targetEvent.id }

  switch (targetEvent.event) {
    case 'widget_added': {
      const widgetId = targetEvent.widget?.id
      if (!widgetId) return null
      // Inverse of add is remove. Carry the full widget so the inverse
      // event itself is undoable (redo-of-undo brings it back).
      return {
        event: 'widget_removed',
        widgetId,
        widget: targetEvent.widget,
        meta,
      }
    }

    case 'widget_removed': {
      // Inverse of remove is add. Requires the full widget payload.
      const widget = targetEvent.widget
      if (!widget || !widget.id) return null
      return {
        event: 'widget_added',
        widget,
        meta,
      }
    }

    case 'widget_updated': {
      if (!targetEvent.widgetId || !targetEvent.prevProps) return null
      return {
        event: 'widget_updated',
        widgetId: targetEvent.widgetId,
        props: targetEvent.prevProps,
        // The inverse of the inverse is the original — capture so redo works.
        prevProps: targetEvent.props,
        meta,
      }
    }

    case 'widget_moved': {
      if (!targetEvent.widgetId || !targetEvent.prevPosition) return null
      return {
        event: 'widget_moved',
        widgetId: targetEvent.widgetId,
        position: targetEvent.prevPosition,
        prevPosition: targetEvent.position,
        meta,
      }
    }

    case 'connector_added': {
      const connectorId = targetEvent.connector?.id
      if (!connectorId) return null
      return {
        event: 'connector_removed',
        connectorId,
        connector: targetEvent.connector,
        meta,
      }
    }

    case 'connector_removed': {
      const connector = targetEvent.connector
      if (!connector || !connector.id) return null
      return {
        event: 'connector_added',
        connector,
        meta,
      }
    }

    case 'connector_updated': {
      if (!targetEvent.connectorId || !targetEvent.prevUpdates) return null
      return {
        event: 'connector_updated',
        connectorId: targetEvent.connectorId,
        updates: targetEvent.prevUpdates,
        prevUpdates: targetEvent.updates,
        meta,
      }
    }

    case 'connector_waypoints_set': {
      if (!targetEvent.connectorId) return null
      const prev = targetEvent.prevWaypoints
      // prevWaypoints null means there were no manual waypoints before —
      // inverse is `cleared` (which itself carries the current waypoints
      // as prevWaypoints so redo can re-set them).
      if (prev === null) {
        return {
          event: 'connector_waypoints_cleared',
          connectorId: targetEvent.connectorId,
          prevWaypoints: targetEvent.waypoints,
          meta,
        }
      }
      if (!Array.isArray(prev)) return null
      return {
        event: 'connector_waypoints_set',
        connectorId: targetEvent.connectorId,
        waypoints: prev,
        prevWaypoints: targetEvent.waypoints,
        meta,
      }
    }

    case 'connector_waypoints_cleared': {
      if (!targetEvent.connectorId) return null
      // Clearing had no prior manual routing: there's nothing to restore.
      const prev = targetEvent.prevWaypoints
      if (!Array.isArray(prev)) return null
      return {
        event: 'connector_waypoints_set',
        connectorId: targetEvent.connectorId,
        waypoints: prev,
        prevWaypoints: null,
        meta,
      }
    }

    case 'source_updated': {
      if (!Array.isArray(targetEvent.prevSources)) return null
      return {
        event: 'source_updated',
        sources: targetEvent.prevSources,
        prevSources: targetEvent.sources,
        meta,
      }
    }

    case 'settings_updated': {
      if (!targetEvent.prevSettings || typeof targetEvent.prevSettings !== 'object') return null
      return {
        event: 'settings_updated',
        settings: targetEvent.prevSettings,
        prevSettings: targetEvent.settings,
        meta,
      }
    }

    // widgets_replaced, connectors_replaced, canvas_created are compaction
    // / baseline events and intentionally not undoable.
    default:
      return null
  }
}
