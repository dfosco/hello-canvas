import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { setupSelectedWidgets } from './selectedWidgets.js'

vi.mock('./identity.js', () => ({
  toCanvasId: vi.fn((file) => file.replace(/\.canvas\.jsonl$/, '').replace(/^src\/canvas\//, '')),
}))

function createMockServer() {
  const handlers = new Map()
  const clients = new Set()
  const unwatched = []
  let closeHandler = null

  return {
    hot: {
      on: vi.fn((event, handler) => {
        handlers.set(event, handler)
      }),
    },
    ws: {
      clients,
    },
    watcher: {
      unwatch: vi.fn((p) => unwatched.push(p)),
    },
    httpServer: {
      on: vi.fn((event, handler) => {
        if (event === 'close') closeHandler = handler
      }),
    },
    // Test helpers
    _handlers: handlers,
    _unwatched: unwatched,
    _triggerClose: () => closeHandler?.(),
    _addClient: (client) => clients.add(client),
    _removeClient: (client) => clients.delete(client),
  }
}

const ROOT = '/fake/project'
const STORYBOARD_DIR = path.join(ROOT, '.storyboard')
const SELECTED_FILE = path.join(STORYBOARD_DIR, '.selectedwidgets.json')
const TMP_FILE = SELECTED_FILE + '.tmp'

describe('selectedWidgets', () => {
  let server
  let spies

  beforeEach(() => {
    vi.clearAllMocks()

    spies = {
      readdirSync: vi.spyOn(fs, 'readdirSync').mockImplementation((dir) => {
        if (dir === ROOT) {
          return [
            { name: 'src', isDirectory: () => true },
            { name: 'node_modules', isDirectory: () => true },
          ]
        }
        if (dir === path.join(ROOT, 'src')) {
          return [{ name: 'canvas', isDirectory: () => true }]
        }
        if (dir === path.join(ROOT, 'src', 'canvas')) {
          return [
            { name: 'design.canvas.jsonl', isDirectory: () => false },
            { name: 'wireframe.canvas.jsonl', isDirectory: () => false },
          ]
        }
        return []
      }),
      writeFileSync: vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {}),
      renameSync: vi.spyOn(fs, 'renameSync').mockImplementation(() => {}),
      existsSync: vi.spyOn(fs, 'existsSync').mockReturnValue(false),
      unlinkSync: vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {}),
      mkdirSync: vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {}),
    }

    server = createMockServer()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers all three HMR event listeners', () => {
    setupSelectedWidgets(server, ROOT)

    expect(server.hot.on).toHaveBeenCalledWith('storyboard:canvas-focused', expect.any(Function))
    expect(server.hot.on).toHaveBeenCalledWith('storyboard:selection-changed', expect.any(Function))
    expect(server.hot.on).toHaveBeenCalledWith('storyboard:canvas-unfocused', expect.any(Function))
  })

  it('unwatches .storyboard directory to prevent HMR loops', () => {
    setupSelectedWidgets(server, ROOT)

    expect(server.watcher.unwatch).toHaveBeenCalledWith(STORYBOARD_DIR)
  })

  it('writes .selectedwidgets.json on canvas focus', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    const handler = server._handlers.get('storyboard:canvas-focused')
    handler(
      { tabId: 'tab1', canvasId: 'design', widgetIds: [], widgets: [] },
      client
    )

    expect(spies.writeFileSync).toHaveBeenCalledWith(
      TMP_FILE,
      expect.stringContaining('"canvasId": "design"'),
      'utf-8'
    )
    expect(spies.renameSync).toHaveBeenCalledWith(TMP_FILE, SELECTED_FILE)
  })

  it('resolves canvasFile from canvasId', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    const handler = server._handlers.get('storyboard:canvas-focused')
    handler(
      { tabId: 'tab1', canvasId: 'design', widgetIds: [], widgets: [] },
      client
    )

    const written = JSON.parse(spies.writeFileSync.mock.calls.at(-1)[1].trim())
    expect(written.canvasFile).toBe('src/canvas/design.canvas.jsonl')
  })

  it('updates selection when from active tab', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    // Focus first
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tab1', canvasId: 'design', widgetIds: [], widgets: [] },
      client
    )

    // Then select widgets
    server._handlers.get('storyboard:selection-changed')({
      tabId: 'tab1',
      canvasId: 'design',
      widgetIds: ['img-1', 'sticky-2'],
      widgets: [
        { id: 'img-1', type: 'image', props: { src: 'photo.png' } },
        { id: 'sticky-2', type: 'sticky-note', props: { text: 'Hello' } },
      ],
    })

    // Last write should have the updated selection
    const lastWrite = spies.writeFileSync.mock.calls.at(-1)
    const data = JSON.parse(lastWrite[1].trim())
    expect(data.selectedWidgetIds).toEqual(['img-1', 'sticky-2'])
    expect(data.widgets).toHaveLength(2)
    expect(data.widgets[0].type).toBe('image')
  })

  it('ignores selection changes from non-active tab', () => {
    setupSelectedWidgets(server, ROOT)

    const clientA = { id: 'a' }
    const clientB = { id: 'b' }
    server._addClient(clientA)
    server._addClient(clientB)

    // Tab A focuses
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tabA', canvasId: 'design', widgetIds: [], widgets: [] },
      clientA
    )

    const writeCountAfterFocus = spies.writeFileSync.mock.calls.length

    // Tab B sends selection (not active)
    server._handlers.get('storyboard:selection-changed')({
      tabId: 'tabB',
      canvasId: 'wireframe',
      widgetIds: ['w1'],
      widgets: [{ id: 'w1', type: 'sticky-note', props: {} }],
    })

    // No additional write should have happened
    expect(spies.writeFileSync.mock.calls.length).toBe(writeCountAfterFocus)
  })

  it('new tab focus replaces the active tab', () => {
    setupSelectedWidgets(server, ROOT)

    const clientA = { id: 'a' }
    const clientB = { id: 'b' }
    server._addClient(clientA)
    server._addClient(clientB)

    // Tab A focuses
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tabA', canvasId: 'design', widgetIds: ['w1'], widgets: [{ id: 'w1', type: 'image', props: {} }] },
      clientA
    )

    // Tab B focuses — replaces A
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tabB', canvasId: 'wireframe', widgetIds: [], widgets: [] },
      clientB
    )

    const lastWrite = spies.writeFileSync.mock.calls.at(-1)
    const data = JSON.parse(lastWrite[1].trim())
    expect(data.canvasId).toBe('wireframe')
    expect(data.selectedWidgetIds).toEqual([])
  })

  it('restores selection when tab regains focus', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    // Focus with existing selection (simulates tab regaining focus)
    server._handlers.get('storyboard:canvas-focused')(
      {
        tabId: 'tab1',
        canvasId: 'design',
        widgetIds: ['img-1', 'img-2'],
        widgets: [
          { id: 'img-1', type: 'image', props: { src: 'a.png' } },
          { id: 'img-2', type: 'image', props: { src: 'b.png' } },
        ],
      },
      client
    )

    const data = JSON.parse(spies.writeFileSync.mock.calls.at(-1)[1].trim())
    expect(data.selectedWidgetIds).toEqual(['img-1', 'img-2'])
    expect(data.widgets).toHaveLength(2)
  })

  it('clears file on canvas unfocus from active tab', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    // Focus
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tab1', canvasId: 'design', widgetIds: [], widgets: [] },
      client
    )

    // Unfocus
    spies.existsSync.mockReturnValue(true)
    server._handlers.get('storyboard:canvas-unfocused')({ tabId: 'tab1' })

    expect(spies.unlinkSync).toHaveBeenCalledWith(SELECTED_FILE)
  })

  it('does not clear file on unfocus from non-active tab', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    // Tab A focuses
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tabA', canvasId: 'design', widgetIds: [], widgets: [] },
      client
    )

    // Tab B unfocuses (was never active)
    server._handlers.get('storyboard:canvas-unfocused')({ tabId: 'tabB' })

    expect(spies.unlinkSync).not.toHaveBeenCalled()
  })

  it('ignores events with missing tabId or canvasId', () => {
    setupSelectedWidgets(server, ROOT)

    const handler = server._handlers.get('storyboard:canvas-focused')
    const client = {}

    const callsAfterSetup = spies.writeFileSync.mock.calls.length

    // Missing tabId
    handler({ canvasId: 'design', widgetIds: [], widgets: [] }, client)
    // Missing canvasId
    handler({ tabId: 'tab1', widgetIds: [], widgets: [] }, client)
    // Null data
    handler(null, client)

    // No additional writes beyond the initial scaffold
    expect(spies.writeFileSync.mock.calls.length).toBe(callsAfterSetup)
  })

  it('clears file on server shutdown', () => {
    setupSelectedWidgets(server, ROOT)

    const client = {}
    server._addClient(client)

    // Focus to create the file
    server._handlers.get('storyboard:canvas-focused')(
      { tabId: 'tab1', canvasId: 'design', widgetIds: [], widgets: [] },
      client
    )

    // Simulate server close
    spies.existsSync.mockReturnValue(true)
    server._triggerClose()

    expect(spies.unlinkSync).toHaveBeenCalledWith(SELECTED_FILE)
  })
})
