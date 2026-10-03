import { describe, it, expect } from 'vitest'
import { parseCanvasJsonl, materialize, materializeFromText, serializeEvent, applyEvent } from './materializer.js'

describe('parseCanvasJsonl', () => {
  it('parses multiple JSONL lines', () => {
    const text = '{"event":"canvas_created","title":"Test"}\n{"event":"widget_added","widget":{"id":"w1"}}\n'
    const events = parseCanvasJsonl(text)
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('canvas_created')
    expect(events[1].event).toBe('widget_added')
  })

  it('skips blank lines', () => {
    const text = '{"event":"canvas_created"}\n\n\n{"event":"widget_added","widget":{"id":"w1"}}\n'
    const events = parseCanvasJsonl(text)
    expect(events).toHaveLength(2)
  })

  it('skips malformed lines', () => {
    const text = '{"event":"canvas_created"}\nnot json\n{"event":"widget_added","widget":{"id":"w1"}}\n'
    const events = parseCanvasJsonl(text)
    expect(events).toHaveLength(2)
  })

  it('parses concatenated JSON objects on a single line', () => {
    const text = '{"event":"canvas_created","title":"Test"}{"event":"source_updated","sources":[]}'
    const events = parseCanvasJsonl(text)
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('canvas_created')
    expect(events[1].event).toBe('source_updated')
  })

  it('handles braces inside JSON strings', () => {
    const text = '{"event":"canvas_created","title":"A {title}"}{"event":"widget_added","widget":{"id":"w1","props":{"text":"x}"}}}'
    const events = parseCanvasJsonl(text)
    expect(events).toHaveLength(2)
    expect(events[0].title).toBe('A {title}')
    expect(events[1].widget.props.text).toBe('x}')
  })

  it('returns empty array for empty input', () => {
    expect(parseCanvasJsonl('')).toEqual([])
    expect(parseCanvasJsonl('\n\n')).toEqual([])
  })
})

describe('materialize', () => {
  it('materializes a canvas_created event', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', grid: true, gridSize: 24, widgets: [] },
    ]
    const state = materialize(events)
    expect(state.title).toBe('Test')
    expect(state.grid).toBe(true)
    expect(state.gridSize).toBe(24)
    expect(state.widgets).toEqual([])
    // event metadata should be stripped
    expect(state.event).toBeUndefined()
    expect(state.timestamp).toBeUndefined()
  })

  it('applies widget_added events', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', widgets: [] },
      { event: 'widget_added', timestamp: '2026-01-02', widget: { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { text: 'Hello', color: 'yellow' } } },
      { event: 'widget_added', timestamp: '2026-01-03', widget: { id: 'w2', type: 'markdown', position: { x: 100, y: 100 }, props: { content: '# Test' } } },
    ]
    const state = materialize(events)
    expect(state.widgets).toHaveLength(2)
    expect(state.widgets[0].id).toBe('w1')
    expect(state.widgets[1].id).toBe('w2')
  })

  it('applies widget_updated events', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', widgets: [
        { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { text: 'Original', color: 'yellow' } },
      ] },
      { event: 'widget_updated', timestamp: '2026-01-02', widgetId: 'w1', props: { text: 'Updated' } },
    ]
    const state = materialize(events)
    expect(state.widgets[0].props.text).toBe('Updated')
    expect(state.widgets[0].props.color).toBe('yellow') // unchanged props preserved
  })

  it('applies widget_moved events', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', widgets: [
        { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} },
      ] },
      { event: 'widget_moved', timestamp: '2026-01-02', widgetId: 'w1', position: { x: 300, y: 400 } },
    ]
    const state = materialize(events)
    expect(state.widgets[0].position).toEqual({ x: 300, y: 400 })
  })

  it('applies widget_removed events', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', widgets: [
        { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} },
        { id: 'w2', type: 'markdown', position: { x: 100, y: 100 }, props: {} },
      ] },
      { event: 'widget_removed', timestamp: '2026-01-02', widgetId: 'w1' },
    ]
    const state = materialize(events)
    expect(state.widgets).toHaveLength(1)
    expect(state.widgets[0].id).toBe('w2')
  })

  it('applies settings_updated events', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', grid: true, gridSize: 24, widgets: [] },
      { event: 'settings_updated', timestamp: '2026-01-02', settings: { gridSize: 12, title: 'Updated Title' } },
    ]
    const state = materialize(events)
    expect(state.gridSize).toBe(12)
    expect(state.title).toBe('Updated Title')
    expect(state.grid).toBe(true) // unchanged setting preserved
  })

  it('applies source_updated events', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', sources: [{ export: 'A' }], widgets: [] },
      { event: 'source_updated', timestamp: '2026-01-02', sources: [{ export: 'B' }, { export: 'C' }] },
    ]
    const state = materialize(events)
    expect(state.sources).toEqual([{ export: 'B' }, { export: 'C' }])
  })

  it('applies widgets_replaced events (bulk update)', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', widgets: [
        { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} },
      ] },
      { event: 'widgets_replaced', timestamp: '2026-01-02', widgets: [
        { id: 'w1', type: 'sticky-note', position: { x: 50, y: 50 }, props: {} },
        { id: 'w3', type: 'markdown', position: { x: 200, y: 200 }, props: {} },
      ] },
    ]
    const state = materialize(events)
    expect(state.widgets).toHaveLength(2)
    expect(state.widgets[0].position).toEqual({ x: 50, y: 50 })
    expect(state.widgets[1].id).toBe('w3')
  })

  it('returns empty object for empty event stream', () => {
    expect(materialize([])).toEqual({})
  })

  it('silently ignores unknown event types', () => {
    const events = [
      { event: 'canvas_created', timestamp: '2026-01-01', title: 'Test', widgets: [] },
      { event: 'future_event', timestamp: '2026-01-02', data: 'whatever' },
    ]
    const state = materialize(events)
    expect(state.title).toBe('Test')
  })

  it('handles a full lifecycle: create, add, update, move, remove', () => {
    const events = [
      { event: 'canvas_created', timestamp: '1', title: 'Canvas', grid: true, gridSize: 24, colorMode: 'auto', widgets: [] },
      { event: 'widget_added', timestamp: '2', widget: { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { text: 'Hello', color: 'yellow' } } },
      { event: 'widget_added', timestamp: '3', widget: { id: 'w2', type: 'markdown', position: { x: 100, y: 0 }, props: { content: '# Title' } } },
      { event: 'widget_updated', timestamp: '4', widgetId: 'w1', props: { text: 'Updated hello' } },
      { event: 'widget_moved', timestamp: '5', widgetId: 'w2', position: { x: 200, y: 300 } },
      { event: 'widget_added', timestamp: '6', widget: { id: 'w3', type: 'sticky-note', position: { x: 400, y: 0 }, props: { text: 'Temp', color: 'red' } } },
      { event: 'widget_removed', timestamp: '7', widgetId: 'w3' },
      { event: 'settings_updated', timestamp: '8', settings: { gridSize: 12 } },
    ]
    const state = materialize(events)
    expect(state.title).toBe('Canvas')
    expect(state.gridSize).toBe(12)
    expect(state.widgets).toHaveLength(2)
    expect(state.widgets[0]).toEqual({ id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: { text: 'Updated hello', color: 'yellow' } })
    expect(state.widgets[1]).toEqual({ id: 'w2', type: 'markdown', position: { x: 200, y: 300 }, props: { content: '# Title' } })
  })
})

describe('connectors', () => {
  const baseEvents = [
    { event: 'canvas_created', timestamp: '1', title: 'Test', widgets: [
      { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} },
      { id: 'w2', type: 'markdown', position: { x: 200, y: 0 }, props: {} },
      { id: 'w3', type: 'sticky-note', position: { x: 400, y: 0 }, props: {} },
    ] },
  ]

  const connector = {
    id: 'connector-001',
    type: 'connector',
    connectorType: 'default',
    start: { widgetId: 'w1', anchor: 'right' },
    end: { widgetId: 'w2', anchor: 'left' },
    meta: {},
  }

  it('materializes connector_added events into connectors array', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
    ])
    expect(state.connectors).toHaveLength(1)
    expect(state.connectors[0].id).toBe('connector-001')
  })

  it('derives connectorIds on widgets from connectors', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
    ])
    expect(state.widgets.find((w) => w.id === 'w1').connectorIds).toEqual(['connector-001'])
    expect(state.widgets.find((w) => w.id === 'w2').connectorIds).toEqual(['connector-001'])
    expect(state.widgets.find((w) => w.id === 'w3').connectorIds).toBeUndefined()
  })

  it('removes connectors with connector_removed', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_removed', timestamp: '3', connectorId: 'connector-001' },
    ])
    expect(state.connectors).toHaveLength(0)
    // connectorIds should not appear on widgets when no connectors reference them
    expect(state.widgets.find((w) => w.id === 'w1').connectorIds).toBeUndefined()
  })

  it('cascades connector removal when widget is removed', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'widget_removed', timestamp: '3', widgetId: 'w1' },
    ])
    expect(state.connectors).toHaveLength(0)
    expect(state.widgets).toHaveLength(2)
  })

  it('cleans orphaned connectors on widgets_replaced', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'widgets_replaced', timestamp: '3', widgets: [
        { id: 'w2', type: 'markdown', position: { x: 200, y: 0 }, props: {} },
        { id: 'w3', type: 'sticky-note', position: { x: 400, y: 0 }, props: {} },
      ] },
    ])
    // w1 removed by replacement, so connector referencing w1 is orphaned
    expect(state.connectors).toHaveLength(0)
  })

  it('supports multiple connectors on the same widget', () => {
    const conn2 = {
      id: 'connector-002',
      type: 'connector',
      connectorType: 'default',
      start: { widgetId: 'w2', anchor: 'right' },
      end: { widgetId: 'w3', anchor: 'left' },
      meta: {},
    }
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_added', timestamp: '3', connector: conn2 },
    ])
    expect(state.connectors).toHaveLength(2)
    expect(state.widgets.find((w) => w.id === 'w2').connectorIds).toEqual(
      expect.arrayContaining(['connector-001', 'connector-002']),
    )
    expect(state.widgets.find((w) => w.id === 'w2').connectorIds).toHaveLength(2)
  })

  it('initializes connectors array when none existed', () => {
    const state = materialize([
      { event: 'canvas_created', timestamp: '1', title: 'Empty', widgets: [
        { id: 'w1', type: 'sticky-note', position: { x: 0, y: 0 }, props: {} },
        { id: 'w2', type: 'sticky-note', position: { x: 100, y: 0 }, props: {} },
      ] },
      { event: 'connector_added', timestamp: '2', connector },
    ])
    expect(state.connectors).toHaveLength(1)
  })

  it('updates connector anchors in-place via connector_updated', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: {
        startAnchor: 'bottom',
        endAnchor: 'top',
      } },
    ])
    expect(state.connectors).toHaveLength(1)
    expect(state.connectors[0].start.widgetId).toBe('w1')
    expect(state.connectors[0].start.anchor).toBe('bottom')
    expect(state.connectors[0].end.widgetId).toBe('w2')
    expect(state.connectors[0].end.anchor).toBe('top')
  })

  it('updates only startAnchor when endAnchor is omitted', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: {
        startAnchor: 'top',
      } },
    ])
    expect(state.connectors[0].start.anchor).toBe('top')
    expect(state.connectors[0].end.anchor).toBe('left')
  })

  it('does not leak startAnchor/endAnchor as top-level connector properties', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: {
        startAnchor: 'bottom',
        endAnchor: 'top',
      } },
    ])
    expect(state.connectors[0]).not.toHaveProperty('startAnchor')
    expect(state.connectors[0]).not.toHaveProperty('endAnchor')
  })

  it('preserves meta when updating anchors', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: {
        meta: { messagingMode: 'two-way' },
      } },
      { event: 'connector_updated', timestamp: '4', connectorId: 'connector-001', updates: {
        startAnchor: 'bottom',
      } },
    ])
    expect(state.connectors[0].start.anchor).toBe('bottom')
    expect(state.connectors[0].meta.messagingMode).toBe('two-way')
  })

  describe('presentational fields (className/style/data/endpoint overrides)', () => {
    it('preserves className/style/data/endpoint overrides set at creation time', () => {
      const styledConnector = {
        ...connector,
        className: 'demo-arrow important',
        style: { '--connector-stroke': '#ff00ff', '--connector-stroke-width': '3px' },
        data: { variant: 'dashed', color: 'fuchsia' },
        startEndpoint: 'none',
        endEndpoint: 'arrow-end',
      }
      const state = materialize([
        ...baseEvents,
        { event: 'connector_added', timestamp: '2', connector: styledConnector },
      ])
      expect(state.connectors[0].className).toBe('demo-arrow important')
      expect(state.connectors[0].style['--connector-stroke']).toBe('#ff00ff')
      expect(state.connectors[0].data.variant).toBe('dashed')
      expect(state.connectors[0].startEndpoint).toBe('none')
      expect(state.connectors[0].endEndpoint).toBe('arrow-end')
    })

    it('shallow-merges style and data across multiple connector_updated events', () => {
      const state = materialize([
        ...baseEvents,
        { event: 'connector_added', timestamp: '2', connector },
        { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: {
          style: { '--connector-stroke': '#ff00ff' },
          data: { variant: 'dashed' },
        } },
        { event: 'connector_updated', timestamp: '4', connectorId: 'connector-001', updates: {
          style: { '--connector-stroke-width': '2px' },
          data: { color: 'fuchsia' },
        } },
      ])
      expect(state.connectors[0].style).toEqual({
        '--connector-stroke': '#ff00ff',
        '--connector-stroke-width': '2px',
      })
      expect(state.connectors[0].data).toEqual({ variant: 'dashed', color: 'fuchsia' })
    })

    it('replaces className wholesale when string-valued and clears on null', () => {
      const state = materialize([
        ...baseEvents,
        { event: 'connector_added', timestamp: '2', connector: { ...connector, className: 'old' } },
        { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: { className: 'new bold' } },
      ])
      expect(state.connectors[0].className).toBe('new bold')

      const cleared = materialize([
        ...baseEvents,
        { event: 'connector_added', timestamp: '2', connector: { ...connector, className: 'old' } },
        { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: { className: null } },
      ])
      expect(cleared.connectors[0]).not.toHaveProperty('className')
    })

    it('clears style/data entirely when explicit null is passed', () => {
      const state = materialize([
        ...baseEvents,
        { event: 'connector_added', timestamp: '2', connector: {
          ...connector,
          style: { '--connector-stroke': '#f00' },
          data: { variant: 'dashed' },
        } },
        { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: { style: null, data: null } },
      ])
      expect(state.connectors[0]).not.toHaveProperty('style')
      expect(state.connectors[0]).not.toHaveProperty('data')
    })

    it('updates endpoint shape overrides via connector_updated', () => {
      const state = materialize([
        ...baseEvents,
        { event: 'connector_added', timestamp: '2', connector },
        { event: 'connector_updated', timestamp: '3', connectorId: 'connector-001', updates: {
          startEndpoint: 'arrow-start',
          endEndpoint: 'arrow-end',
        } },
      ])
      expect(state.connectors[0].startEndpoint).toBe('arrow-start')
      expect(state.connectors[0].endEndpoint).toBe('arrow-end')
    })
  })

  it('sets manual waypoints via connector_waypoints_set', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_waypoints_set', timestamp: '3', connectorId: 'connector-001', waypoints: [
        { dx: 100, dy: 0, tHint: 0.33 },
        { dx: 100, dy: 200, tHint: 0.66 },
      ] },
    ])
    expect(state.connectors[0].waypoints).toHaveLength(2)
    expect(state.connectors[0].waypoints[0]).toEqual({ dx: 100, dy: 0, tHint: 0.33 })
    expect(state.connectors[0].waypoints[1]).toEqual({ dx: 100, dy: 200, tHint: 0.66 })
  })

  it('replaces existing waypoints on subsequent connector_waypoints_set', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_waypoints_set', timestamp: '3', connectorId: 'connector-001', waypoints: [{ dx: 50, dy: 0 }] },
      { event: 'connector_waypoints_set', timestamp: '4', connectorId: 'connector-001', waypoints: [{ dx: 75, dy: 25 }, { dx: 100, dy: 50 }] },
    ])
    expect(state.connectors[0].waypoints).toHaveLength(2)
    expect(state.connectors[0].waypoints[0].dx).toBe(75)
  })

  it('drops waypoints via connector_waypoints_cleared', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_waypoints_set', timestamp: '3', connectorId: 'connector-001', waypoints: [{ dx: 100, dy: 0 }] },
      { event: 'connector_waypoints_cleared', timestamp: '4', connectorId: 'connector-001' },
    ])
    expect(state.connectors[0].waypoints).toBeUndefined()
  })

  it('connector_waypoints_set on missing connector is a no-op', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_waypoints_set', timestamp: '3', connectorId: 'does-not-exist', waypoints: [{ dx: 100, dy: 0 }] },
    ])
    expect(state.connectors[0].waypoints).toBeUndefined()
  })

  it('coerces non-array waypoints payload to empty array', () => {
    const state = materialize([
      ...baseEvents,
      { event: 'connector_added', timestamp: '2', connector },
      { event: 'connector_waypoints_set', timestamp: '3', connectorId: 'connector-001', waypoints: null },
    ])
    expect(state.connectors[0].waypoints).toEqual([])
  })
})

describe('materializeFromText', () => {
  it('parses and materializes in one step', () => {
    const text = '{"event":"canvas_created","timestamp":"2026-01-01","title":"Test","widgets":[]}\n{"event":"widget_added","timestamp":"2026-01-02","widget":{"id":"w1","type":"sticky-note","position":{"x":0,"y":0},"props":{"text":"Hello"}}}\n'
    const state = materializeFromText(text)
    expect(state.title).toBe('Test')
    expect(state.widgets).toHaveLength(1)
    expect(state.widgets[0].props.text).toBe('Hello')
  })
})

describe('serializeEvent', () => {
  it('serializes an event to a single line', () => {
    const event = { event: 'widget_added', timestamp: '2026-01-01', widget: { id: 'w1' } }
    const line = serializeEvent(event)
    expect(line).not.toContain('\n')
    expect(JSON.parse(line)).toEqual(event)
  })
})

describe('applyEvent (single-event applier for client-side optimistic undo/redo)', () => {
  it('widget_added: appends to widgets, leaves other arrays alone', () => {
    const before = { widgets: [{ id: 'a' }], connectors: [], sources: [{ export: 's' }] }
    const after = applyEvent(before, { event: 'widget_added', widget: { id: 'b' } })
    expect(after.widgets).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(after.connectors).toBe(before.connectors)
    expect(after.sources).toBe(before.sources)
  })

  it('widget_moved: replaces position on the matching widget only', () => {
    const before = { widgets: [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 10, y: 10 } }], connectors: [] }
    const after = applyEvent(before, { event: 'widget_moved', widgetId: 'a', position: { x: 5, y: 5 } })
    expect(after.widgets[0]).toEqual({ id: 'a', position: { x: 5, y: 5 } })
    expect(after.widgets[1]).toBe(before.widgets[1])
  })

  it('widget_updated: merges props on the matching widget only', () => {
    const before = { widgets: [{ id: 'a', props: { color: 'pink', text: 'hi' } }], connectors: [] }
    const after = applyEvent(before, { event: 'widget_updated', widgetId: 'a', props: { color: 'green' } })
    expect(after.widgets[0].props).toEqual({ color: 'green', text: 'hi' })
  })

  it('widget_removed: drops the widget and cascades to dependent connectors', () => {
    const before = {
      widgets: [{ id: 'a' }, { id: 'b' }],
      connectors: [
        { id: 'c1', start: { widgetId: 'a' }, end: { widgetId: 'b' } },
        { id: 'c2', start: { widgetId: 'b' }, end: { widgetId: 'b' } },
      ],
    }
    const after = applyEvent(before, { event: 'widget_removed', widgetId: 'a' })
    expect(after.widgets).toEqual([{ id: 'b' }])
    expect(after.connectors).toEqual([{ id: 'c2', start: { widgetId: 'b' }, end: { widgetId: 'b' } }])
  })

  it('connector_added / connector_removed: round-trip is identity', () => {
    const start = { widgets: [], connectors: [{ id: 'c1', start: { widgetId: 'a' }, end: { widgetId: 'b' } }] }
    const added = applyEvent(start, { event: 'connector_added', connector: { id: 'c2', start: { widgetId: 'b' }, end: { widgetId: 'a' } } })
    expect(added.connectors).toHaveLength(2)
    const removed = applyEvent(added, { event: 'connector_removed', connectorId: 'c2' })
    expect(removed.connectors).toEqual(start.connectors)
  })

  it('source_updated: replaces sources, returns new state ref', () => {
    const before = { widgets: [], connectors: [], sources: [{ export: 'A' }] }
    const after = applyEvent(before, { event: 'source_updated', sources: [{ export: 'B' }] })
    expect(after.sources).toEqual([{ export: 'B' }])
    expect(after).not.toBe(before)
  })

  it('unknown events return the same state reference (cheap no-op detection)', () => {
    const before = { widgets: [{ id: 'a' }], connectors: [] }
    const after = applyEvent(before, { event: 'mystery_event', payload: 42 })
    expect(after).toBe(before)
  })

  it('matches materialize() when folding a sequence event-by-event', () => {
    const events = [
      { event: 'canvas_created', widgets: [{ id: 'a', position: { x: 0, y: 0 } }], connectors: [] },
      { event: 'widget_moved', widgetId: 'a', position: { x: 10, y: 10 } },
      { event: 'widget_added', widget: { id: 'b' } },
      { event: 'widget_removed', widgetId: 'a' },
    ]
    let stepwise = {}
    for (const evt of events) stepwise = applyEvent(stepwise, evt)
    const full = materialize(events)
    expect(stepwise.widgets).toEqual(full.widgets)
    expect(stepwise.connectors).toEqual(full.connectors)
  })

  it('applies an undo inverse event (widget_moved with prevPosition swapped) correctly', () => {
    // Simulate what POST /undo returns: a forward widget_moved that swaps
    // position ↔ prevPosition, tagged with meta.kind = 'undo'.
    const before = { widgets: [{ id: 'a', position: { x: 100, y: 100 } }], connectors: [] }
    const inverseEvent = {
      event: 'widget_moved',
      widgetId: 'a',
      position: { x: 0, y: 0 },
      prevPosition: { x: 100, y: 100 },
      meta: { kind: 'undo', of: 'evt_xxx' },
    }
    const after = applyEvent(before, inverseEvent)
    expect(after.widgets[0].position).toEqual({ x: 0, y: 0 })
  })
})
