import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import notebookRoutesPlugin from './vite-routes-plugin.js'

const roots = []

function notebook() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-routes-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'prototypes', 'Landing'), { recursive: true })
  fs.writeFileSync(path.join(root, 'prototypes', 'Landing', 'index.jsx'), 'export default function Landing() {}')
  return root
}

afterEach(() => {
  delete process.env.HYPERCANVAS_NOTEBOOK_ROOT
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('notebook route Vite plugin', () => {
  it('maps external prototype modules to their router keys', () => {
    const root = notebook()
    process.env.HYPERCANVAS_NOTEBOOK_ROOT = root
    const plugin = notebookRoutesPlugin()
    const source = plugin.load('\0virtual:hypercanvas-notebook-routes')

    expect(source).toContain('"/src/prototypes/Landing/index.jsx"')
    expect(source).not.toContain('/src/prototypes/prototypes/')
    expect(source).toContain(path.join(root, 'prototypes', 'Landing', 'index.jsx'))
  })

  it('uses flow-declared routes for prototype index modules', () => {
    const root = notebook()
    fs.writeFileSync(path.join(root, 'prototypes', 'Landing', 'success.flow.json'), JSON.stringify({ route: '/StartupSignup' }))
    process.env.HYPERCANVAS_NOTEBOOK_ROOT = root
    const plugin = notebookRoutesPlugin()
    const source = plugin.load('\0virtual:hypercanvas-notebook-routes')

    expect(source).toContain('"/src/prototypes/StartupSignup/index.jsx"')
  })

  it('invalidates routes when the active Notebook changes', () => {
    const root = notebook()
    process.env.HYPERCANVAS_NOTEBOOK_ROOT = root
    const listeners = {}
    const server = {
      moduleGraph: { getModuleById: () => null },
      watcher: { on: (event, listener) => { listeners[event] = listener } },
      ws: { send: vi.fn() },
    }
    const plugin = notebookRoutesPlugin()
    plugin.configureServer(server)

    server.__hypercanvasNotebookRoutesReload()
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' })

    listeners.change(path.join(root, 'prototypes', 'Landing', 'index.jsx'))
    expect(server.ws.send).toHaveBeenCalledTimes(2)
  })
})
