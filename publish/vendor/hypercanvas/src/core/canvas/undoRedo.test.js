import { describe, it, expect } from 'vitest'
import { buildInverseEvent } from './undoRedo.js'
import { materialize } from './materializer.js'

const widget = (overrides = {}) => ({
  id: 'sticky-1',
  type: 'sticky-note',
  position: { x: 10, y: 20 },
  props: { text: 'hello' },
  ...overrides,
})

describe('buildInverseEvent', () => {
  it('returns null for events without an id', () => {
    expect(buildInverseEvent({ event: 'widget_added', widget: widget() }, 'undo')).toBeNull()
  })

  it('returns null for non-undoable event types', () => {
    expect(buildInverseEvent({ id: 'x', event: 'widgets_replaced', widgets: [] }, 'undo')).toBeNull()
    expect(buildInverseEvent({ id: 'x', event: 'connectors_replaced', connectors: [] }, 'undo')).toBeNull()
    expect(buildInverseEvent({ id: 'x', event: 'canvas_created', widgets: [] }, 'undo')).toBeNull()
  })

  it('inverts widget_added into widget_removed carrying the widget', () => {
    const target = { id: 'evt_1', event: 'widget_added', widget: widget() }
    const inv = buildInverseEvent(target, 'undo')
    expect(inv).toEqual({
      event: 'widget_removed',
      widgetId: 'sticky-1',
      widget: widget(),
      meta: { kind: 'undo', of: 'evt_1' },
    })
  })

  it('inverts widget_removed into widget_added when the widget payload is present', () => {
    const target = { id: 'evt_2', event: 'widget_removed', widgetId: 'sticky-1', widget: widget() }
    const inv = buildInverseEvent(target, 'undo')
    expect(inv).toEqual({
      event: 'widget_added',
      widget: widget(),
      meta: { kind: 'undo', of: 'evt_2' },
    })
  })

  it('returns null for legacy widget_removed events that lack the full widget payload', () => {
    const target = { id: 'evt_old', event: 'widget_removed', widgetId: 'sticky-1' }
    expect(buildInverseEvent(target, 'undo')).toBeNull()
  })

  it('inverts widget_updated using prevProps and mirrors current props for redo', () => {
    const target = {
      id: 'evt_3',
      event: 'widget_updated',
      widgetId: 'sticky-1',
      props: { text: 'new', color: 'red' },
      prevProps: { text: 'old', color: undefined },
    }
    const inv = buildInverseEvent(target, 'undo')
    expect(inv).toEqual({
      event: 'widget_updated',
      widgetId: 'sticky-1',
      props: { text: 'old', color: undefined },
      prevProps: { text: 'new', color: 'red' },
      meta: { kind: 'undo', of: 'evt_3' },
    })
  })

  it('inverts widget_moved using prevPosition', () => {
    const target = {
      id: 'evt_4',
      event: 'widget_moved',
      widgetId: 'sticky-1',
      position: { x: 200, y: 200 },
      prevPosition: { x: 10, y: 20 },
    }
    const inv = buildInverseEvent(target, 'undo')
    expect(inv).toEqual({
      event: 'widget_moved',
      widgetId: 'sticky-1',
      position: { x: 10, y: 20 },
      prevPosition: { x: 200, y: 200 },
      meta: { kind: 'undo', of: 'evt_4' },
    })
  })

  it('inverts connector_added into connector_removed', () => {
    const connector = {
      id: 'connector-1',
      type: 'connector',
      connectorType: 'default',
      start: { widgetId: 'sticky-1', anchor: 'right' },
      end: { widgetId: 'sticky-2', anchor: 'left' },
      meta: {},
    }
    const inv = buildInverseEvent({ id: 'evt_5', event: 'connector_added', connector }, 'undo')
    expect(inv).toEqual({
      event: 'connector_removed',
      connectorId: 'connector-1',
      connector,
      meta: { kind: 'undo', of: 'evt_5' },
    })
  })

  it('inverts connector_removed into connector_added', () => {
    const connector = {
      id: 'connector-1',
      type: 'connector',
      connectorType: 'default',
      start: { widgetId: 'sticky-1', anchor: 'right' },
      end: { widgetId: 'sticky-2', anchor: 'left' },
      meta: {},
    }
    const inv = buildInverseEvent({ id: 'evt_6', event: 'connector_removed', connectorId: 'connector-1', connector }, 'undo')
    expect(inv).toEqual({
      event: 'connector_added',
      connector,
      meta: { kind: 'undo', of: 'evt_6' },
    })
  })

  it('inverts connector_waypoints_set into connector_waypoints_cleared when there were no prior waypoints', () => {
    const target = {
      id: 'evt_7',
      event: 'connector_waypoints_set',
      connectorId: 'connector-1',
      waypoints: [{ dx: 10, dy: 10 }],
      prevWaypoints: null,
    }
    const inv = buildInverseEvent(target, 'undo')
    expect(inv).toEqual({
      event: 'connector_waypoints_cleared',
      connectorId: 'connector-1',
      prevWaypoints: [{ dx: 10, dy: 10 }],
      meta: { kind: 'undo', of: 'evt_7' },
    })
  })

  it('inverts source_updated using prevSources', () => {
    const target = {
      id: 'evt_8',
      event: 'source_updated',
      sources: [{ export: 'B', position: { x: 0, y: 0 } }],
      prevSources: [{ export: 'A', position: { x: 1, y: 1 } }],
    }
    const inv = buildInverseEvent(target, 'undo')
    expect(inv).toEqual({
      event: 'source_updated',
      sources: [{ export: 'A', position: { x: 1, y: 1 } }],
      prevSources: [{ export: 'B', position: { x: 0, y: 0 } }],
      meta: { kind: 'undo', of: 'evt_8' },
    })
  })

  it('tags redo emissions with meta.kind="redo"', () => {
    const target = { id: 'evt_9', event: 'widget_added', widget: widget() }
    const inv = buildInverseEvent(target, 'redo')
    expect(inv?.meta).toEqual({ kind: 'redo', of: 'evt_9' })
  })
})

describe('materialize folds undo events like normal forward events', () => {
  it('a widget_removed undo emission as widget_added re-introduces the widget', () => {
    const w = widget()
    const events = [
      { event: 'canvas_created', timestamp: '1', widgets: [] },
      { id: 'evt_add', event: 'widget_added', timestamp: '2', widget: w },
      { id: 'evt_del', event: 'widget_removed', timestamp: '3', widgetId: w.id, widget: w },
      {
        id: 'evt_undo',
        event: 'widget_added',
        timestamp: '4',
        widget: w,
        meta: { kind: 'undo', of: 'evt_del' },
      },
    ]
    const state = materialize(events)
    expect(state.widgets).toHaveLength(1)
    expect(state.widgets[0].id).toBe(w.id)
  })

  it('back-compat: legacy widget_removed event with only widgetId still removes', () => {
    const w = widget()
    const events = [
      { event: 'canvas_created', timestamp: '1', widgets: [w] },
      { event: 'widget_removed', timestamp: '2', widgetId: w.id },
    ]
    const state = materialize(events)
    expect(state.widgets).toEqual([])
  })

  it('back-compat: legacy connector_removed event with only connectorId still removes', () => {
    const connector = {
      id: 'connector-1',
      type: 'connector',
      connectorType: 'default',
      start: { widgetId: 'a', anchor: 'right' },
      end: { widgetId: 'b', anchor: 'left' },
    }
    const events = [
      { event: 'canvas_created', timestamp: '1', widgets: [], connectors: [connector] },
      { event: 'connector_removed', timestamp: '2', connectorId: connector.id },
    ]
    const state = materialize(events)
    expect(state.connectors).toEqual([])
  })
})

describe('end-to-end: cq-enablement bug scenario', () => {
  it('deleting 5 widgets then undoing once only restores the most recent delete', () => {
    // Reproduces the rollback bug. In the old model an undo emitted a
    // widgets_replaced event that resurrected ALL deleted widgets. In the
    // new model the undo targets the most recent widget_removed event and
    // re-adds only that widget.
    const widgets = [
      widget({ id: 'a' }),
      widget({ id: 'b' }),
      widget({ id: 'c' }),
      widget({ id: 'd' }),
      widget({ id: 'e' }),
    ]
    const removeEvents = widgets.map((w, i) => ({
      id: `evt_del_${i}`,
      event: 'widget_removed',
      timestamp: `${10 + i}`,
      widgetId: w.id,
      widget: w,
    }))

    const events = [
      { event: 'canvas_created', timestamp: '1', widgets },
      ...removeEvents,
    ]

    // Sanity: after all 5 deletes, the canvas is empty.
    expect(materialize(events).widgets).toEqual([])

    // Undo the LAST delete only (evt_del_4).
    const inverse = buildInverseEvent(removeEvents[4], 'undo')
    expect(inverse?.event).toBe('widget_added')
    expect(inverse?.widget?.id).toBe('e')

    const undoneEvents = [...events, { ...inverse, id: 'evt_undo_1', timestamp: '20' }]
    const undoneState = materialize(undoneEvents)

    // Only widget 'e' is restored — a, b, c, d remain deleted.
    expect(undoneState.widgets).toHaveLength(1)
    expect(undoneState.widgets[0].id).toBe('e')
  })
})

