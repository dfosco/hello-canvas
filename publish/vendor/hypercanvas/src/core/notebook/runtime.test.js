import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemGrants } from '../system/filesystem-grants.js'
import { initializeNotebook } from './notebook.js'
import { createNotebookRuntime, resolveNotebookRuntimePath } from './runtime.js'
import notebookRuntimePlugin from './vite-runtime-plugin.js'

const temporary = []
function notebook(title) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-runtime-'))
  temporary.push(root)
  initializeNotebook(root, { title })
  return root
}
afterEach(() => temporary.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

describe('Notebook runtime adapter', () => {
  it('scaffolds an empty folder when it is added as a Notebook', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-empty-'))
    temporary.push(root)
    const runtime = createNotebookRuntime()

    runtime.open(root)

    expect(runtime.status().notebook.manifest.title).toBe('Notebook')
    expect(fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'storyboard.canvas.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'canvas'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'prototypes'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'assets'))).toBe(true)
    expect(fs.existsSync(path.join(root, '.storyboard'))).toBe(true)
  })

  it('adopts an existing folder and preserves its content when it is added as a Notebook', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-existing-'))
    temporary.push(root)
    fs.writeFileSync(path.join(root, 'notes.txt'), 'existing content')

    const runtime = createNotebookRuntime()
    runtime.open(root)

    expect(runtime.status().active).toBe(true)
    expect(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8')).toBe('existing content')
    expect(fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'storyboard.config.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'canvas'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'prototypes'))).toBe(true)
  })

  it('repairs missing Notebook layout before activation', () => {
    const root = notebook('Repairable')
    fs.rmSync(path.join(root, 'canvas'), { recursive: true })
    fs.rmSync(path.join(root, 'storyboard.canvas.json'))

    createNotebookRuntime().open(root)

    expect(fs.existsSync(path.join(root, 'canvas'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'storyboard.canvas.json'))).toBe(true)
  })

  it('atomically switches validated roots and writes only Notebook content', () => {
    const first = notebook('First')
    const second = notebook('Second')
    const runtime = createNotebookRuntime(first)

    runtime.write('prototypes/first/index.jsx', 'export default null')
    expect(runtime.read('prototypes/first/index.jsx')).toBe('export default null')

    runtime.open(second)
    expect(runtime.status().notebook.manifest.title).toBe('Second')
    const activeRoot = runtime.status().root
    expect(runtime.watchPaths()).toContain(path.join(activeRoot, 'prototypes'))
    expect(runtime.watchPaths()).not.toContain(path.join(first, 'prototypes'))
    expect(runtime.watchPaths()).not.toContain(path.join(activeRoot, 'sites'))
    expect(() => runtime.read('prototypes/first/index.jsx')).toThrow(/ENOENT/)
    expect(() => runtime.write('../outside.txt', 'no')).toThrow(/content/)
  })

  it('persists recent Notebook roots outside Notebook content and closes only the active binding', () => {
    const first = notebook('First')
    const second = notebook('Second')
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-state-'))
    temporary.push(stateDirectory)
    const runtime = createNotebookRuntime({ stateDirectory })
    runtime.open(first)
    runtime.open(second)

    const recents = runtime.recent()
    expect(recents.map(entry => entry.root)).toEqual([fs.realpathSync.native(second), fs.realpathSync.native(first)])
    expect(recents[0]).toMatchObject({ title: 'Second', available: true })
    expect(fs.existsSync(path.join(stateDirectory, 'notebooks.json'))).toBe(true)
    expect(fs.existsSync(path.join(second, '.storyboard', 'notebooks.json'))).toBe(false)

    const restored = createNotebookRuntime({ stateDirectory })
    expect(restored.recent().map(entry => entry.title)).toEqual(['Second', 'First'])
    expect(runtime.close()).toMatchObject({ active: false, root: null })
    expect(runtime.recent()).toHaveLength(2)

    const createdRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-created-parent-')), 'Created')
    temporary.push(path.dirname(createdRoot))
    expect(runtime.create(createdRoot, { title: 'Created', id: 'created-1' }).notebook.manifest)
      .toMatchObject({ id: 'created-1', title: 'Created' })
    expect(runtime.recent()[0]).toMatchObject({ root: fs.realpathSync.native(createdRoot), title: 'Created' })
    expect(() => runtime.create(createdRoot, { title: 'Duplicate' })).toThrow(/already contains a Notebook/)
  })

  it('keeps Vite bootable when its initial Notebook is invalid', () => {
    const plugin = notebookRuntimePlugin({ initialRoot: path.join(os.tmpdir(), 'missing-notebook') })
    expect(plugin.name).toBe('hypercanvas-notebook-runtime')
  })

  it('switches watcher roots and exposes serialized restart recovery', async () => {
    const first = notebook('First')
    const second = notebook('Second')
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-runtime-state-'))
    temporary.push(stateDirectory)
    const listeners = {}
    const watcher = {
      on: (event, listener) => { listeners[event] = listener },
      add: vi.fn(),
      unwatch: vi.fn(),
    }
    const server = {
      watcher,
      moduleGraph: { getModuleById: () => null },
      ws: { send: vi.fn() },
      middlewares: { use: vi.fn() },
      httpServer: { once: vi.fn() },
      restart: vi.fn().mockResolvedValue(undefined),
      config: { server: { fs: { allow: [first] } } },
    }
    const runtime = createNotebookRuntime({ initialRoot: first, stateDirectory })
    const previousNotebookRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT
    process.env.HYPERCANVAS_NOTEBOOK_ROOT = first
    const plugin = notebookRuntimePlugin({ initialRoot: first, runtime })
    plugin.configureServer(server)
    const middleware = server.middlewares.use.mock.calls[0][1]
    const response = () => ({
      setHeader: vi.fn(),
      end: vi.fn(),
    })
    const request = (url, method, body = '') => ({
      url,
      method,
      headers: { 'user-agent': 'node' },
      async *[Symbol.asyncIterator]() { yield body },
    })

    const openResponse = response()
    await middleware(request('/open', 'POST', JSON.stringify({ root: second })), openResponse, vi.fn())
    const openPayload = JSON.parse(openResponse.end.mock.calls[0][0])
    expect(openPayload.root).toBe(fs.realpathSync.native(second))
    expect(openPayload.restarting).toBe(true)
    expect(watcher.unwatch).toHaveBeenCalledWith(expect.arrayContaining([path.join(fs.realpathSync.native(first), 'prototypes')]))
    expect(watcher.add).toHaveBeenCalledWith(expect.arrayContaining([path.join(fs.realpathSync.native(second), 'prototypes')]))
    expect(server.config.server.fs.allow).toContain(fs.realpathSync.native(second))
    expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' })

    server.ws.send.mockClear()
    listeners.change(path.join(fs.realpathSync.native(second), 'canvas', 'updated.canvas.jsonl'))
    expect(server.ws.send).not.toHaveBeenCalled()
    listeners.change(path.join(fs.realpathSync.native(second), 'hypercanvas.notebook.json'))
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' })

    const restartResponse = response()
    await middleware(request('/restart', 'POST'), restartResponse, vi.fn())
    expect(restartResponse.end).toHaveBeenCalled()
    await Promise.resolve()
    expect(server.restart).toHaveBeenCalledTimes(1)
    expect(listeners.change).toBeTypeOf('function')

    const recentResponse = response()
    await middleware(request('/recent', 'GET'), recentResponse, vi.fn())
    expect(JSON.parse(recentResponse.end.mock.calls[0][0]).notebooks.map(entry => entry.root))
      .toEqual([fs.realpathSync.native(second), fs.realpathSync.native(first)])

    const closeResponse = response()
    await middleware(request('/close', 'POST'), closeResponse, vi.fn())
    expect(JSON.parse(closeResponse.end.mock.calls[0][0])).toMatchObject({ active: false, restarting: true })
    expect(runtime.status().active).toBe(false)
    expect(runtime.recent()).toHaveLength(2)
    expect(process.env.HYPERCANVAS_NOTEBOOK_ROOT).toBe('')
    const newNotebookRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-created-parent-')), 'Created')
    temporary.push(path.dirname(newNotebookRoot))
    const createResponse = response()
    await middleware(request('/create', 'POST', JSON.stringify({ root: newNotebookRoot, title: 'Created', id: 'created-1' })), createResponse, vi.fn())
    expect(JSON.parse(createResponse.end.mock.calls[0][0])).toMatchObject({
      root: fs.realpathSync.native(newNotebookRoot),
      restarting: true,
      notebook: { manifest: { id: 'created-1', title: 'Created' } },
    })
    if (previousNotebookRoot === undefined) delete process.env.HYPERCANVAS_NOTEBOOK_ROOT
    else process.env.HYPERCANVAS_NOTEBOOK_ROOT = previousNotebookRoot
  })

  it('requires a Core picker grant before browser Notebook paths can be opened', async () => {
    const activeRoot = notebook('Active')
    const selectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-browser-selected-'))
    temporary.push(selectedRoot)
    const origin = 'http://127.0.0.1:4317'
    const browserRequest = root => ({
      url: '/open',
      method: 'POST',
      headers: { host: '127.0.0.1:4317', origin, 'sec-fetch-site': 'same-origin' },
      async *[Symbol.asyncIterator]() { yield JSON.stringify({ root }) },
    })
    const grants = createFilesystemGrants()
    grants.registerBrowserOrigin(origin)
    const runtime = createNotebookRuntime({ initialRoot: activeRoot })
    const plugin = notebookRuntimePlugin({ runtime })
    const server = {
      __hypercanvasFilesystemGrants: grants,
      watcher: { on: vi.fn(), add: vi.fn(), unwatch: vi.fn() },
      moduleGraph: { getModuleById: () => null },
      ws: { send: vi.fn() },
      middlewares: { use: vi.fn() },
      httpServer: { once: vi.fn() },
      restart: vi.fn().mockResolvedValue(undefined),
      config: { server: { fs: { allow: [activeRoot] } } },
    }
    plugin.configureServer(server)
    const middleware = server.middlewares.use.mock.calls[0][1]
    const response = () => ({ statusCode: 200, setHeader: vi.fn(), end: vi.fn() })
    const blocked = response()

    await middleware(browserRequest(selectedRoot), blocked, vi.fn())

    expect(blocked.statusCode).toBe(403)
    expect(JSON.parse(blocked.end.mock.calls[0][0]).error.code).toBe('FILESYSTEM_GRANT_REQUIRED')
    expect(fs.existsSync(path.join(selectedRoot, 'hypercanvas.notebook.json'))).toBe(false)

    grants.grantDirectory(selectedRoot, { purpose: 'notebook', request: browserRequest(selectedRoot) })
    const allowed = response()
    await middleware(browserRequest(selectedRoot), allowed, vi.fn())
    expect(allowed.statusCode).toBe(200)
    expect(JSON.parse(allowed.end.mock.calls[0][0]).root).toBe(fs.realpathSync.native(selectedRoot))
  })

  it('rejects content symlinks that escape the Notebook root', () => {
    const root = notebook('Safe')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-outside-'))
    temporary.push(outside)
    fs.symlinkSync(outside, path.join(root, 'assets', 'linked'))
    expect(() => createNotebookRuntime(root).read('assets/linked/secret.txt')).toThrow(/outside/)
  })

  it('rejects hidden Notebook runtime state redirected outside the root', () => {
    const root = notebook('Runtime containment')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-runtime-outside-'))
    temporary.push(outside)
    fs.rmSync(path.join(root, '.storyboard'), { recursive: true, force: true })
    fs.symlinkSync(outside, path.join(root, '.storyboard'), 'dir')

    expect(() => resolveNotebookRuntimePath(root, 'publishing.json')).toThrow(/outside/)
  })

  it('fails closed without a Notebook and limits application defaults to reads', () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-app-'))
    temporary.push(appRoot)
    fs.writeFileSync(path.join(appRoot, 'terminal.config.json'), '{}')
    const runtime = createNotebookRuntime({ applicationRoot: appRoot })

    expect(() => runtime.read('assets/file.txt')).toThrow(/No Notebook is active/)
    expect(runtime.resolve('terminal.config.json', { scope: 'application-default' })).toBe(path.join(fs.realpathSync.native(appRoot), 'terminal.config.json'))
    expect(() => runtime.resolve('package.json', { scope: 'application-default' })).toThrow(/contract/)
    expect(() => runtime.resolve('terminal.config.json', { scope: 'application-default', access: 'write' })).toThrow(/read-only/)
  })

  it('requires an explicit capability for global filesystem access', () => {
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-global-'))
    temporary.push(globalRoot)
    fs.writeFileSync(path.join(globalRoot, 'state.json'), '{}')
    const runtime = createNotebookRuntime({ applicationRoot: globalRoot })

    expect(() => runtime.resolve('state.json', { scope: 'global', globalRoot })).toThrow(/not allowlisted/)
    const allowlisted = createNotebookRuntime({
      applicationRoot: globalRoot,
      globalRoots: [{ root: globalRoot, access: ['read'] }],
    })
    expect(allowlisted.resolve('state.json', { scope: 'global', globalRoot })).toBe(path.join(fs.realpathSync.native(globalRoot), 'state.json'))
    expect(() => allowlisted.resolve('state.json', { scope: 'global', globalRoot, access: 'write' })).toThrow(/not allowlisted/)
  })

  it('notifies subscribers with a generation when the Notebook changes', () => {
    const first = notebook('First')
    const second = notebook('Second')
    const runtime = createNotebookRuntime(first)
    const transitions = []
    const unsubscribe = runtime.subscribe(transition => transitions.push(transition))

    runtime.open(second)
    unsubscribe()

    expect(transitions).toHaveLength(1)
    expect(transitions[0].previous.root).toBe(fs.realpathSync.native(first))
    expect(transitions[0].current.root).toBe(fs.realpathSync.native(second))
    expect(transitions[0].current.generation).toBeGreaterThan(transitions[0].previous.generation)
  })
})
