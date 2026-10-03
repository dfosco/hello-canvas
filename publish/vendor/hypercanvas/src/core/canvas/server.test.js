import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCanvasHandler } from './server.js'
import { serializeEvent } from './materializer.js'
import { initializeNotebook } from '../notebook/notebook.js'

const terminalInput = vi.hoisted(() => ({ submitTerminalText: vi.fn() }))

vi.mock('./terminal-runtime.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, submitTerminalText: terminalInput.submitTerminalText }
})

/**
 * Helper: create a minimal canvas handler wired to a temp directory.
 * Returns { handler, root, canvasDir, lastResponse }.
 */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-canvas-test-'))
  const canvasDir = path.join(root, 'src', 'canvas')
  fs.mkdirSync(canvasDir, { recursive: true })

  const lastResponse = { status: null, body: null, bytes: null, headers: null }

  const ctx = {
    root,
    workspaceIdResolver: async () => 'test-workspace',
    sendJson: (_res, status, body) => {
      lastResponse.status = status
      lastResponse.body = body
    },
  }

  const handler = createCanvasHandler(ctx)

  // Streaming mock for binary GET responses (image fetches). Records the
  // bytes + headers so tests can assert without coupling to real http.
  function makeRes() {
    let buf = Buffer.alloc(0)
    return {
      writeHead(status, headers) {
        lastResponse.status = status
        lastResponse.headers = headers
      },
      end(data) {
        if (data) buf = Buffer.concat([buf, Buffer.isBuffer(data) ? data : Buffer.from(data)])
        lastResponse.bytes = buf
      },
    }
  }

  const invoke = (routePath, method, body = {}) =>
    handler(null, makeRes(), { path: routePath, method, body })

  return { invoke, root, canvasDir, lastResponse }
}

/**
 * Helper: write a single-page canvas file at src/canvas/{name}.canvas.jsonl
 */
function writeCanvas(canvasDir, name, { title, author, description, jsx, widgets = [] } = {}) {
  const event = {
    event: 'canvas_created',
    timestamp: new Date().toISOString(),
    title: title || name,
    grid: true,
    gridSize: 24,
    colorMode: 'auto',
    widgets,
  }
  if (author) event.author = author
  if (description) event.description = description
  if (jsx) event.jsx = jsx
  const filePath = path.join(canvasDir, `${name}.canvas.jsonl`)
  fs.writeFileSync(filePath, serializeEvent(event) + '\n', 'utf-8')
  return filePath
}

describe('POST /terminal/input', () => {
  let root, canvasDir, invoke, lastResponse

  beforeEach(async () => {
    terminalInput.submitTerminalText.mockReset()
    ;({ invoke, root, canvasDir, lastResponse } = setup())
    const { initRegistry } = await import('./terminal-registry.js')
    initRegistry(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('resolves a widget to its live session and reports runtime acceptance', async () => {
    writeCanvas(canvasDir, 'target-canvas', {
      widgets: [{ id: 'terminal-1', type: 'agent', props: {} }],
    })
    const { registerSession } = await import('./terminal-registry.js')
    const { entry } = registerSession({ branch: 'test-branch', canvasId: 'target-canvas', widgetId: 'terminal-1' })
    terminalInput.submitTerminalText.mockResolvedValue({ accepted: true, written: 5, submitted: false })

    await invoke('/terminal/input', 'POST', {
      widgetId: 'terminal-1', canvasId: 'target-canvas', text: 'hello',
    })

    expect(terminalInput.submitTerminalText).toHaveBeenCalledWith(entry.sessionId, 'hello', { submit: false })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body).toMatchObject({
      success: true, accepted: true, written: 5, submitted: false,
      sessionId: entry.sessionId, widgetId: 'terminal-1', canvasId: 'target-canvas',
    })
  })

  it('requires an explicit submit flag and passes it through to the runtime', async () => {
    terminalInput.submitTerminalText.mockResolvedValue({ accepted: true, written: 6, submitted: true })

    await invoke('/terminal/input', 'POST', { sessionId: 'raw-session', text: 'hello', submit: true })

    expect(terminalInput.submitTerminalText).toHaveBeenCalledWith('raw-session', 'hello', { submit: true })
    expect(lastResponse.body).toMatchObject({ success: true, accepted: true, submitted: true })
  })

  it('rejects a read-only terminal widget without writing to its PTY', async () => {
    writeCanvas(canvasDir, 'read-canvas', {
      widgets: [{ id: 'read-view', type: 'terminal-read', props: {} }],
    })

    await invoke('/terminal/input', 'POST', {
      widgetId: 'read-view', canvasId: 'read-canvas', text: 'hello',
    })

    expect(lastResponse.status).toBe(409)
    expect(lastResponse.body).toMatchObject({ code: 'TERMINAL_READ_ONLY' })
    expect(lastResponse.body.error).toContain('read-only')
    expect(terminalInput.submitTerminalText).not.toHaveBeenCalled()
  })

  it('returns a clear gone response when a registered session has exited', async () => {
    writeCanvas(canvasDir, 'target-canvas', {
      widgets: [{ id: 'terminal-1', type: 'terminal', props: {} }],
    })
    const { registerSession } = await import('./terminal-registry.js')
    registerSession({ branch: 'test-branch', canvasId: 'target-canvas', widgetId: 'terminal-1' })
    terminalInput.submitTerminalText.mockRejectedValue(Object.assign(new Error('not running'), { code: 'TERMINAL_NOT_RUNNING' }))

    await invoke('/terminal/input', 'POST', { widgetId: 'terminal-1', text: 'hello' })

    expect(lastResponse.status).toBe(410)
    expect(lastResponse.body.code).toBe('TERMINAL_EXITED')
  })

  it('rejects an ambiguous widget target instead of choosing a session', async () => {
    const { registerSession } = await import('./terminal-registry.js')
    registerSession({ branch: 'branch-one', canvasId: 'canvas-one', widgetId: 'shared-terminal' })
    registerSession({ branch: 'branch-two', canvasId: 'canvas-two', widgetId: 'shared-terminal' })

    await invoke('/terminal/input', 'POST', { widgetId: 'shared-terminal', text: 'hello' })

    expect(lastResponse.status).toBe(409)
    expect(lastResponse.body.code).toBe('AMBIGUOUS_TERMINAL_TARGET')
    expect(terminalInput.submitTerminalText).not.toHaveBeenCalled()
  })

  it('rejects malformed target and text values', async () => {
    await invoke('/terminal/input', 'POST', { text: 'hello' })
    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.code).toBe('INVALID_TERMINAL_TARGET')

    await invoke('/terminal/input', 'POST', { widgetId: 'terminal-1', text: 42 })
    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.code).toBe('INVALID_TERMINAL_TEXT')

    await invoke('/terminal/input', 'POST', { widgetId: 'terminal-1', sessionId: 'session-1', text: 'hello' })
    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.code).toBe('INVALID_TERMINAL_TARGET')

    await invoke('/terminal/input', 'POST', { sessionId: 'session-1', text: 'hello', submit: null })
    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.code).toBe('INVALID_SUBMIT_OPTION')
  })
})

describe('POST /create with convertFrom', () => {
  let root, canvasDir, invoke, lastResponse

  beforeEach(() => {
    ({ invoke, root, canvasDir, lastResponse } = setup())
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('converts a single-page canvas to a multi-page folder', async () => {
    writeCanvas(canvasDir, 'my-canvas', { title: 'My Canvas', author: 'test' })

    await invoke('/create', 'POST', { name: 'new-page', convertFrom: 'my-canvas' })

    expect(lastResponse.status).toBe(201)
    expect(lastResponse.body.converted).toBe(true)
    expect(lastResponse.body.name).toBe('my-canvas/new-page')
    expect(lastResponse.body.route).toBe('/canvas/my-canvas/new-page')

    // Original file should be moved into the folder
    expect(fs.existsSync(path.join(canvasDir, 'my-canvas.canvas.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(canvasDir, 'my-canvas', 'my-canvas.canvas.jsonl'))).toBe(true)

    // New page should exist
    expect(fs.existsSync(path.join(canvasDir, 'my-canvas', 'new-page.canvas.jsonl'))).toBe(true)

    // Meta file should exist with correct content
    const metaPath = path.join(canvasDir, 'my-canvas', 'my-canvas.meta.json')
    expect(fs.existsSync(metaPath)).toBe(true)
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    expect(meta.title).toBe('My Canvas')
    expect(meta.author).toBe('test')
  })

  it('preserves description in meta.json', async () => {
    writeCanvas(canvasDir, 'noted', { title: 'Noted', description: 'A described canvas' })

    await invoke('/create', 'POST', { name: 'page-two', convertFrom: 'noted' })

    expect(lastResponse.status).toBe(201)
    const meta = JSON.parse(fs.readFileSync(path.join(canvasDir, 'noted', 'noted.meta.json'), 'utf-8'))
    expect(meta.description).toBe('A described canvas')
  })

  it('rejects convertFrom with path segments', async () => {
    await invoke('/create', 'POST', { name: 'page', convertFrom: 'folder/canvas' })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toContain('flat root canvases')
  })

  it('rejects convertFrom with proto: prefix', async () => {
    await invoke('/create', 'POST', { name: 'page', convertFrom: 'proto:MyApp/board' })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toContain('flat root canvases')
  })

  it('returns 404 when convertFrom canvas does not exist', async () => {
    await invoke('/create', 'POST', { name: 'page', convertFrom: 'nonexistent' })

    expect(lastResponse.status).toBe(404)
  })

  it('rejects when target directory already exists', async () => {
    writeCanvas(canvasDir, 'taken')
    fs.mkdirSync(path.join(canvasDir, 'taken'))

    await invoke('/create', 'POST', { name: 'page', convertFrom: 'taken' })

    expect(lastResponse.status).toBe(409)
    expect(lastResponse.body.error).toContain('already exists')
  })

  it('rejects when new page name collides with existing canvas filename', async () => {
    writeCanvas(canvasDir, 'solo')

    await invoke('/create', 'POST', { name: 'solo', convertFrom: 'solo' })

    expect(lastResponse.status).toBe(409)
    expect(lastResponse.body.error).toContain('collides')
  })
})

describe('external Notebook canvas identity', () => {
  it('writes a widget to a Notebook canvas using its route ID', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notebook-canvas-test-'))
    const canvasDir = path.join(root, 'canvas')
    const response = { status: null, body: null }
    initializeNotebook(root, { title: 'External' })
    writeCanvas(canvasDir, 'welcome')
    const handler = createCanvasHandler({
      root,
      sendJson: (_res, status, body) => Object.assign(response, { status, body }),
    })

    await handler(null, {}, { path: '/widget', method: 'POST', body: { name: 'welcome', type: 'sticky-note' } })

    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)
    expect(fs.readFileSync(path.join(canvasDir, 'welcome.canvas.jsonl'), 'utf8')).toContain('widget_added')
    fs.rmSync(root, { recursive: true, force: true })
  })
})

// ──────────────────────────────────────────────────
// POST /batch
// ──────────────────────────────────────────────────

describe('POST /batch', () => {
  let root, canvasDir, invoke, lastResponse

  beforeEach(() => {
    ({ invoke, root, canvasDir, lastResponse } = setup())
    writeCanvas(canvasDir, 'test-canvas')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('creates multiple widgets in one batch', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', props: { text: 'A' } },
        { op: 'create-widget', type: 'sticky-note', props: { text: 'B' } },
        { op: 'create-widget', type: 'sticky-note', props: { text: 'C' } },
      ],
    })

    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.results).toHaveLength(3)
    expect(lastResponse.body.results[0].widget.props.text).toBe('A')
    expect(lastResponse.body.results[1].widget.props.text).toBe('B')
    expect(lastResponse.body.results[2].widget.props.text).toBe('C')
  })

  it('auto-assigns index refs ($0, $1, ...)', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', props: { text: 'first' } },
        { op: 'create-widget', type: 'sticky-note', props: { text: 'second' } },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    const { refs } = lastResponse.body
    expect(refs['0']).toBe(lastResponse.body.results[0].widgetId)
    expect(refs['1']).toBe(lastResponse.body.results[1].widgetId)
  })

  it('supports named refs alongside index refs', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', ref: 'header', props: { text: 'H' } },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    const { refs } = lastResponse.body
    const widgetId = lastResponse.body.results[0].widgetId
    expect(refs['0']).toBe(widgetId)
    expect(refs['header']).toBe(widgetId)
  })

  it('resolves $index refs in create-connector', async () => {
    // First create a widget to act as the "existing" terminal widget
    await invoke('/widget', 'POST', { name: 'test-canvas', type: 'terminal', props: {} })
    const terminalId = lastResponse.body.widget.id
    const terminalConfig = JSON.parse(fs.readFileSync(path.join(root, '.storyboard', 'terminals', `${terminalId}.json`), 'utf8'))
    expect(terminalConfig.workspaceId).toBe('test-workspace')

    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', props: { text: 'target' } },
        { op: 'create-connector', startWidgetId: terminalId, endWidgetId: '$0', startAnchor: 'right', endAnchor: 'left' },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.results).toHaveLength(2)
    expect(lastResponse.body.results[1].op).toBe('create-connector')
    expect(lastResponse.body.results[1].connectorId).toBeTruthy()
  })

  it('resolves $named refs in update-widget', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', ref: 'note', props: { text: 'before' } },
        { op: 'update-widget', widgetId: '$note', props: { text: 'after' } },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.results[1].op).toBe('update-widget')
    expect(lastResponse.body.results[1].success).toBe(true)
  })

  it('supports move-widget with ref resolution', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', position: { x: 0, y: 0 }, props: { text: 'X' } },
        { op: 'move-widget', widgetId: '$0', position: { x: 500, y: 300 } },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.results[1].op).toBe('move-widget')
    expect(lastResponse.body.results[1].success).toBe(true)
  })

  it('supports delete-widget with ref resolution', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', props: { text: 'temp' } },
        { op: 'delete-widget', widgetId: '$0' },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.results[1].op).toBe('delete-widget')
    expect(lastResponse.body.results[1].success).toBe(true)
  })

  it('fails fast on unknown ref', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', props: { text: 'ok' } },
        { op: 'update-widget', widgetId: '$nonexistent', props: { text: 'fail' } },
      ],
    })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.success).toBe(false)
    expect(lastResponse.body.failedAt).toBe(1)
    expect(lastResponse.body.error).toContain('Unknown ref')
    // First operation's result should still be returned
    expect(lastResponse.body.results).toHaveLength(1)
    expect(lastResponse.body.results[0].op).toBe('create-widget')
  })

  it('fails fast on unknown operation type', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'explode-widget' },
      ],
    })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.success).toBe(false)
    expect(lastResponse.body.failedAt).toBe(0)
    expect(lastResponse.body.error).toContain('Unknown operation')
  })

  it('rejects empty operations array', async () => {
    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [],
    })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toContain('non-empty')
  })

  it('rejects missing canvas name', async () => {
    await invoke('/batch', 'POST', {
      operations: [{ op: 'create-widget', type: 'sticky-note' }],
    })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toContain('Canvas name')
  })

  it('rejects batch exceeding 200 operations', async () => {
    const ops = Array.from({ length: 201 }, (_, i) => ({
      op: 'create-widget', type: 'sticky-note', props: { text: `#${i}` },
    }))

    await invoke('/batch', 'POST', { name: 'test-canvas', operations: ops })

    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toContain('200')
  })

  it('returns 404 for unknown canvas', async () => {
    await invoke('/batch', 'POST', {
      name: 'nonexistent',
      operations: [{ op: 'create-widget', type: 'sticky-note' }],
    })

    expect(lastResponse.status).toBe(404)
  })

  it('supports full create-update-move-connect workflow', async () => {
    // Create a pre-existing terminal widget for connectors
    await invoke('/widget', 'POST', { name: 'test-canvas', type: 'terminal', props: {} })
    const termId = lastResponse.body.widget.id

    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', position: { x: 100, y: 100 }, props: { text: 'Draft' } },
        { op: 'update-widget', widgetId: '$0', props: { text: 'Final', color: 'blue' } },
        { op: 'move-widget', widgetId: '$0', position: { x: 500, y: 300 } },
        { op: 'create-connector', startWidgetId: termId, endWidgetId: '$0', startAnchor: 'right', endAnchor: 'left' },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.results).toHaveLength(4)
    expect(lastResponse.body.results[0].op).toBe('create-widget')
    expect(lastResponse.body.results[1].op).toBe('update-widget')
    expect(lastResponse.body.results[2].op).toBe('move-widget')
    expect(lastResponse.body.results[3].op).toBe('create-connector')
  })

  it('connector refs also get index refs', async () => {
    await invoke('/widget', 'POST', { name: 'test-canvas', type: 'terminal', props: {} })
    const termId = lastResponse.body.widget.id

    await invoke('/batch', 'POST', {
      name: 'test-canvas',
      operations: [
        { op: 'create-widget', type: 'sticky-note', props: { text: 'A' } },
        { op: 'create-connector', startWidgetId: termId, endWidgetId: '$0', startAnchor: 'right', endAnchor: 'left' },
      ],
    })

    expect(lastResponse.body.success).toBe(true)
    const { refs } = lastResponse.body
    // Op 0 = widget, Op 1 = connector — both get index refs
    expect(refs['0']).toMatch(/^sticky-note-/)
    expect(refs['1']).toMatch(/^connector-/)
  })
})

describe('POST /undo and POST /redo (event-id targeting)', () => {
  let root, canvasDir, invoke, lastResponse

  beforeEach(() => {
    ({ invoke, root, canvasDir, lastResponse } = setup())
    writeCanvas(canvasDir, 'undo-canvas', { title: 'Undo Canvas' })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function addSticky(text) {
    await invoke('/widget', 'POST', {
      name: 'undo-canvas',
      type: 'sticky-note',
      props: { text },
      position: { x: 0, y: 0 },
    })
    return { widgetId: lastResponse.body.widget.id, eventId: lastResponse.body.eventId }
  }

  async function readState() {
    await invoke('/read?name=undo-canvas', 'GET', {})
    return lastResponse.body
  }

  it('appends an event id on every mutation', async () => {
    const { eventId } = await addSticky('a')
    expect(eventId).toMatch(/^evt_/)
  })

  it('reproduces the cq-enablement scenario: 3 deletes + undo restores only the most recent', async () => {
    const a = await addSticky('a')
    const b = await addSticky('b')
    const c = await addSticky('c')

    await invoke('/widget', 'DELETE', { name: 'undo-canvas', widgetId: a.widgetId })
    const delAEventId = lastResponse.body.eventId
    await invoke('/widget', 'DELETE', { name: 'undo-canvas', widgetId: b.widgetId })
    const delBEventId = lastResponse.body.eventId
    await invoke('/widget', 'DELETE', { name: 'undo-canvas', widgetId: c.widgetId })
    const delCEventId = lastResponse.body.eventId

    expect((await readState()).widgets).toEqual([])

    // Undo only the LAST delete (c).
    await invoke('/undo', 'POST', { name: 'undo-canvas', eventId: delCEventId })
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.inverseEvent.event).toBe('widget_added')
    expect(lastResponse.body.inverseEvent.meta).toEqual({ kind: 'undo', of: delCEventId })

    const after = await readState()
    expect(after.widgets).toHaveLength(1)
    expect(after.widgets[0].id).toBe(c.widgetId)
    // a and b stay deleted — the bug class would have resurrected them too.
    expect(after.widgets.map((w) => w.id)).not.toContain(a.widgetId)
    expect(after.widgets.map((w) => w.id)).not.toContain(b.widgetId)

    // Tracking that we don't leave delAEventId / delBEventId mentioned.
    void delAEventId
    void delBEventId
  })

  it('undo of widget_updated reverts the props using prevProps', async () => {
    const { widgetId } = await addSticky('original')

    await invoke('/widget', 'PATCH', {
      name: 'undo-canvas',
      widgetId,
      props: { text: 'edited' },
    })
    const editEventId = lastResponse.body.eventIds[0]

    let state = await readState()
    expect(state.widgets[0].props.text).toBe('edited')

    await invoke('/undo', 'POST', { name: 'undo-canvas', eventId: editEventId })
    state = await readState()
    expect(state.widgets[0].props.text).toBe('original')
  })

  it('undo of widget_moved reverts the position using prevPosition', async () => {
    const { widgetId } = await addSticky('a')

    await invoke('/widget', 'PATCH', {
      name: 'undo-canvas',
      widgetId,
      position: { x: 500, y: 600 },
    })
    const moveEventId = lastResponse.body.eventIds[0]

    let state = await readState()
    expect(state.widgets[0].position).toEqual({ x: 500, y: 600 })

    await invoke('/undo', 'POST', { name: 'undo-canvas', eventId: moveEventId })
    state = await readState()
    expect(state.widgets[0].position).toEqual({ x: 0, y: 0 })
  })

  it('redo of an undone delete re-removes the widget', async () => {
    const { widgetId } = await addSticky('a')
    await invoke('/widget', 'DELETE', { name: 'undo-canvas', widgetId })
    const delEventId = lastResponse.body.eventId

    await invoke('/undo', 'POST', { name: 'undo-canvas', eventId: delEventId })
    const undoEventId = lastResponse.body.eventId
    expect((await readState()).widgets).toHaveLength(1)

    // Redo with the undo event id — server emits the inverse of the undo,
    // which is a fresh widget_removed.
    await invoke('/redo', 'POST', { name: 'undo-canvas', eventId: undoEventId })
    expect(lastResponse.body.inverseEvent.event).toBe('widget_removed')
    expect(lastResponse.body.inverseEvent.meta).toEqual({ kind: 'redo', of: undoEventId })

    expect((await readState()).widgets).toEqual([])
  })

  it('rejects undo on an unknown event id with 404', async () => {
    await invoke('/undo', 'POST', { name: 'undo-canvas', eventId: 'evt_does_not_exist' })
    expect(lastResponse.status).toBe(404)
  })

  it('rejects undo on a non-undoable event (widgets_replaced) with 400', async () => {
    // Trigger a widgets_replaced via PUT /update with replaceAll
    await invoke('/update', 'PUT', {
      name: 'undo-canvas',
      widgets: [],
      replaceAll: true,
    })
    // Read the file to get the event id of the widgets_replaced event.
    const filePath = path.join(canvasDir, 'undo-canvas.canvas.jsonl')
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    const replacedEvt = lines.find((l) => l.event === 'widgets_replaced')
    expect(replacedEvt?.id).toBeTruthy()

    await invoke('/undo', 'POST', { name: 'undo-canvas', eventId: replacedEvt.id })
    expect(lastResponse.status).toBe(400)
    expect(lastResponse.body.error).toMatch(/cannot be undone/i)
  })
})

describe('runaway-session hard ceiling compaction', () => {
  let root, canvasDir, invoke, lastResponse

  beforeEach(() => {
    ({ invoke, root, canvasDir, lastResponse } = setup())
    writeCanvas(canvasDir, 'big-canvas', { title: 'Big Canvas' })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  // setImmediate-based test helper
  function flushSetImmediate() {
    return new Promise((resolve) => setImmediate(resolve))
  }

  it('does not compact a small file (under the 2 MB threshold)', async () => {
    const filePath = path.join(canvasDir, 'big-canvas.canvas.jsonl')
    await invoke('/widget', 'POST', {
      name: 'big-canvas',
      type: 'sticky-note',
      props: { text: 'hello' },
      position: { x: 0, y: 0 },
    })
    await flushSetImmediate()
    const sizeAfter = fs.statSync(filePath).size
    expect(sizeAfter).toBeLessThan(2 * 1024 * 1024)
    // File should still contain both canvas_created + widget_added events.
    const events = fs.readFileSync(filePath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    expect(events.length).toBe(2)
    expect(events[0].event).toBe('canvas_created')
    expect(events[1].event).toBe('widget_added')
  })

  it('compacts the file once it exceeds the runaway threshold', async () => {
    const filePath = path.join(canvasDir, 'big-canvas.canvas.jsonl')

    // Pre-bloat the file past 2 MB by appending raw garbage events. Each
    // event has a unique id so the materializer treats it as valid.
    const padding = 'x'.repeat(4000)
    const bloatLines = []
    for (let i = 0; i < 600; i++) {
      bloatLines.push(JSON.stringify({
        id: `evt_bloat_${i}`,
        event: 'widget_added',
        timestamp: '2026-01-01',
        widget: { id: `bloat-${i}`, type: 'sticky-note', position: { x: 0, y: 0 }, props: { text: padding } },
      }))
    }
    fs.appendFileSync(filePath, bloatLines.join('\n') + '\n')
    const sizeBefore = fs.statSync(filePath).size
    expect(sizeBefore).toBeGreaterThan(2 * 1024 * 1024)

    // Trigger appendEvent — this should detect the runaway size and kick
    // off a compaction.
    await invoke('/widget', 'POST', {
      name: 'big-canvas',
      type: 'sticky-note',
      props: { text: 'trigger' },
      position: { x: 0, y: 0 },
    })
    // Compaction runs on setImmediate; flush it.
    await flushSetImmediate()
    await flushSetImmediate()

    const sizeAfter = fs.statSync(filePath).size
    expect(sizeAfter).toBeLessThan(sizeBefore)

    // After compaction, file should be a single canvas_created event
    // containing all the materialized widgets.
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(1)
    const baseline = JSON.parse(lines[0])
    expect(baseline.event).toBe('canvas_created')
    // 600 bloat widgets + 1 from the triggering append = 601.
    expect(baseline.widgets.length).toBe(601)
    // Sanity: state still reads cleanly via the normal /read endpoint.
    await invoke('/read?name=big-canvas', 'GET', {})
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.widgets.length).toBe(601)
  })
})

describe('image routes — drafts/ subdirectory privacy layer', () => {
  // Minimal 1x1 PNG (base64) for upload tests.
  const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='

  it('routes a draft-canvas upload into images/drafts/ and returns the drafts/ prefix', async () => {
    const { invoke, root, lastResponse } = setup()

    await invoke('/image', 'POST', { dataUrl: PNG_DATA_URL, canvasName: 'drafts/storyboarding' })

    expect(lastResponse.status).toBe(201)
    expect(lastResponse.body.success).toBe(true)
    expect(lastResponse.body.filename).toMatch(/^drafts\//)
    const filename = lastResponse.body.filename
    const basename = filename.slice('drafts/'.length)
    const draftFile = path.join(root, 'assets', 'canvas', 'images', 'drafts', basename)
    const publicFile = path.join(root, 'assets', 'canvas', 'images', basename)
    expect(fs.existsSync(draftFile)).toBe(true)
    expect(fs.existsSync(publicFile)).toBe(false)
  })

  it('routes a non-draft-canvas upload into images/ as before', async () => {
    const { invoke, root, lastResponse } = setup()

    await invoke('/image', 'POST', { dataUrl: PNG_DATA_URL, canvasName: 'storyboarding' })

    expect(lastResponse.status).toBe(201)
    expect(lastResponse.body.filename).not.toMatch(/^drafts\//)
    const filename = lastResponse.body.filename
    const publicFile = path.join(root, 'assets', 'canvas', 'images', filename)
    expect(fs.existsSync(publicFile)).toBe(true)
  })

  it('treats a canvas with `drafts` anywhere in its segments as draft', async () => {
    const { invoke, root, lastResponse } = setup()

    await invoke('/image', 'POST', { dataUrl: PNG_DATA_URL, canvasName: 'widget/drafts/v6' })

    expect(lastResponse.status).toBe(201)
    expect(lastResponse.body.filename).toMatch(/^drafts\//)
    const draftFile = path.join(root, 'assets', 'canvas', 'images', 'drafts',
      lastResponse.body.filename.slice('drafts/'.length))
    expect(fs.existsSync(draftFile)).toBe(true)
  })

  it('GET /images/drafts/<basename> serves a draft image', async () => {
    const { invoke, root, lastResponse } = setup()
    const draftsDir = path.join(root, 'assets', 'canvas', 'images', 'drafts')
    fs.mkdirSync(draftsDir, { recursive: true })
    const payload = Buffer.from([1, 2, 3])
    fs.writeFileSync(path.join(draftsDir, 'hello.png'), payload)

    await invoke('/images/drafts/hello.png', 'GET', {})
    expect(lastResponse.status).toBe(200)
    expect(lastResponse.bytes).toEqual(payload)
  })

  it('GET /images/<basename> does NOT fall back to drafts/', async () => {
    const { invoke, root, lastResponse } = setup()
    const draftsDir = path.join(root, 'assets', 'canvas', 'images', 'drafts')
    fs.mkdirSync(draftsDir, { recursive: true })
    fs.writeFileSync(path.join(draftsDir, 'leak.png'), Buffer.from([1, 2, 3]))

    await invoke('/images/leak.png', 'GET', {})
    expect(lastResponse.status).toBe(404)
  })

  it('GET rejects deeper paths than one optional drafts/ segment', async () => {
    const { invoke, lastResponse } = setup()

    await invoke('/images/drafts/sub/foo.png', 'GET', {})
    expect(lastResponse.status).toBe(400)
  })

  it('GET rejects path traversal even with drafts prefix', async () => {
    const { invoke, lastResponse } = setup()

    await invoke('/images/drafts/../etc.png', 'GET', {})
    expect(lastResponse.status).toBe(400)
  })

  it('toggle-private preserves drafts/ prefix in returned filename', async () => {
    const { invoke, root, lastResponse } = setup()
    const draftsDir = path.join(root, 'assets', 'canvas', 'images', 'drafts')
    fs.mkdirSync(draftsDir, { recursive: true })
    fs.writeFileSync(path.join(draftsDir, 'foo.png'), Buffer.from([1, 2, 3]))

    await invoke('/image/toggle-private', 'POST', { filename: 'drafts/foo.png' })

    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body).toEqual({ success: true, filename: 'drafts/~foo.png', private: true })
    expect(fs.existsSync(path.join(draftsDir, '~foo.png'))).toBe(true)
    expect(fs.existsSync(path.join(draftsDir, 'foo.png'))).toBe(false)
  })

  it('toggle-private still works on bare basenames in images/', async () => {
    const { invoke, root, lastResponse } = setup()
    const imagesDir = path.join(root, 'assets', 'canvas', 'images')
    fs.mkdirSync(imagesDir, { recursive: true })
    fs.writeFileSync(path.join(imagesDir, 'bar.png'), Buffer.from([1, 2, 3]))

    await invoke('/image/toggle-private', 'POST', { filename: 'bar.png' })

    expect(lastResponse.status).toBe(200)
    expect(lastResponse.body.filename).toBe('~bar.png')
    expect(fs.existsSync(path.join(imagesDir, '~bar.png'))).toBe(true)
  })

  it('duplicate preserves drafts/ prefix', async () => {
    const { invoke, root, lastResponse } = setup()
    const draftsDir = path.join(root, 'assets', 'canvas', 'images', 'drafts')
    fs.mkdirSync(draftsDir, { recursive: true })
    fs.writeFileSync(path.join(draftsDir, 'storyboarding--2026-01-01--12-00-00.png'), Buffer.from([1, 2, 3]))

    await invoke('/image/duplicate', 'POST', { filename: 'drafts/storyboarding--2026-01-01--12-00-00.png' })

    expect(lastResponse.status).toBe(201)
    expect(lastResponse.body.filename).toMatch(/^drafts\/storyboarding--/)
  })
})

describe('GET /folders and POST /create with folderKind', () => {
  let root, canvasDir, invoke, lastResponse

  beforeEach(() => {
    ({ invoke, root, canvasDir, lastResponse } = setup())
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('GET /folders returns tagged entries distinguishing workspace from pages', async () => {
    // Workspace folder (`.folder/` suffix) containing one canvas
    fs.mkdirSync(path.join(canvasDir, 'marketing.folder'), { recursive: true })
    writeCanvas(path.join(canvasDir, 'marketing.folder'), 'landing')
    // Plain dir (multi-page canvas group) containing two canvases
    fs.mkdirSync(path.join(canvasDir, 'tour'), { recursive: true })
    writeCanvas(path.join(canvasDir, 'tour'), 'overview')
    writeCanvas(path.join(canvasDir, 'tour'), 'detail')

    await invoke('/folders', 'GET')

    expect(lastResponse.status).toBe(200)
    // Legacy flat list still present for back-compat
    expect(lastResponse.body.folders).toContain('marketing')
    expect(lastResponse.body.folders).toContain('tour')
    // New tagged entries carry the kind
    const entries = lastResponse.body.entries
    expect(entries).toEqual(expect.arrayContaining([
      { name: 'marketing', kind: 'workspace' },
      { name: 'tour',      kind: 'pages' },
    ]))
  })

  it('POST /create with folderKind:"workspace" creates a new .folder/ dir', async () => {
    await invoke('/create', 'POST', {
      name: 'landing',
      folder: 'marketing',
      folderKind: 'workspace',
      title: 'Landing',
    })

    expect(lastResponse.status).toBe(201)
    expect(fs.existsSync(path.join(canvasDir, 'marketing.folder', 'landing.canvas.jsonl'))).toBe(true)
    // Plain dir must NOT have been created
    expect(fs.existsSync(path.join(canvasDir, 'marketing'))).toBe(false)
  })

  it('POST /create with folderKind:"pages" (or omitted) creates a plain dir', async () => {
    await invoke('/create', 'POST', {
      name: 'overview',
      folder: 'tour',
      folderKind: 'pages',
      title: 'Overview',
    })

    expect(lastResponse.status).toBe(201)
    expect(fs.existsSync(path.join(canvasDir, 'tour', 'overview.canvas.jsonl'))).toBe(true)
    // .folder/ variant must NOT have been created
    expect(fs.existsSync(path.join(canvasDir, 'tour.folder'))).toBe(false)
  })

  it('POST /create defaults to plain dir when folderKind is omitted (backward compat)', async () => {
    await invoke('/create', 'POST', {
      name: 'overview',
      folder: 'tour',
      title: 'Overview',
    })

    expect(lastResponse.status).toBe(201)
    expect(fs.existsSync(path.join(canvasDir, 'tour', 'overview.canvas.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(canvasDir, 'tour.folder'))).toBe(false)
  })

  it('POST /create reuses existing .folder/ regardless of folderKind', async () => {
    fs.mkdirSync(path.join(canvasDir, 'marketing.folder'), { recursive: true })

    // Even with folderKind:"pages", the existing .folder/ wins (filesystem
    // truth beats a hint).
    await invoke('/create', 'POST', {
      name: 'landing',
      folder: 'marketing',
      folderKind: 'pages',
      title: 'Landing',
    })

    expect(lastResponse.status).toBe(201)
    expect(fs.existsSync(path.join(canvasDir, 'marketing.folder', 'landing.canvas.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(canvasDir, 'marketing'))).toBe(false)
  })

  it('POST /create reuses existing plain dir regardless of folderKind', async () => {
    fs.mkdirSync(path.join(canvasDir, 'tour'), { recursive: true })

    await invoke('/create', 'POST', {
      name: 'overview',
      folder: 'tour',
      folderKind: 'workspace',
      title: 'Overview',
    })

    expect(lastResponse.status).toBe(201)
    expect(fs.existsSync(path.join(canvasDir, 'tour', 'overview.canvas.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(canvasDir, 'tour.folder'))).toBe(false)
  })
})
