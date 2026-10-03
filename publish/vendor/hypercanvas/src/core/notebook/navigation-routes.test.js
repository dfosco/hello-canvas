import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initializeNotebook, inspectNotebook, NOTEBOOK_MANIFEST_FILE } from './notebook.js'
import { createNotebookNavigationRoutes } from './navigation-routes.js'

const roots = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-navigation-api-'))
  roots.push(root)
  const canvas = path.join(root, 'canvas', 'overview.canvas.jsonl')
  fs.mkdirSync(path.dirname(canvas), { recursive: true })
  fs.writeFileSync(canvas, '{}\n')
  initializeNotebook(root, { id: 'notebook-api', title: 'Navigation API' })
  const manifestPath = path.join(root, NOTEBOOK_MANIFEST_FILE)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.pages = [{ id: 'overview', type: 'canvas', title: 'Overview', path: 'canvas/overview.canvas.jsonl' }]
  manifest.navigation = {
    ...manifest.navigation,
    type: { ...manifest.navigation.type, order: { ...manifest.navigation.type.order, canvas: ['overview'] } },
    files: { ...manifest.navigation.files, flatOrder: ['overview'], entries: [{ type: 'page', pageId: 'overview' }] },
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const runtime = {
    status: () => ({ active: true, root, notebook: inspectNotebook(root), generation: 7 }),
    refreshNotebook: vi.fn(),
  }
  const events = []
  const routes = createNotebookNavigationRoutes({
    runtime,
    sendJson: (res, status, data) => { res.result = { status, data } },
    eventSender: event => events.push(event),
  })
  const call = async (method, route, body = {}) => {
    const res = {}
    await routes({}, res, { method, path: route, body })
    return res.result
  }
  return { root, runtime, routes, events, call }
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

describe('Notebook navigation routes', () => {
  it('serves the normalized page catalog and current persisted layout revision', async () => {
    const app = fixture()
    const pages = await app.call('GET', '/pages')
    const navigation = await app.call('GET', '/navigation')

    expect(pages.status).toBe(200)
    expect(pages.data).toMatchObject({ title: 'Navigation API', notebookId: 'notebook-api', generation: 7, pages: [{ id: 'overview', route: '/canvas/overview', available: true }] })
    expect(navigation.status).toBe(200)
    expect(navigation.data).toMatchObject({
      title: 'Navigation API',
      notebookId: pages.data.notebookId,
      generation: pages.data.generation,
      revision: pages.data.revision,
      navigation: { mode: 'type', files: { flatOrder: ['overview'] } },
    })
  })

  it('persists a valid layout operation atomically and refreshes the runtime snapshot', async () => {
    const app = fixture()
    const initial = await app.call('GET', '/navigation')
    const updated = await app.call('POST', '/navigation', {
      notebookId: initial.data.notebookId,
      generation: initial.data.generation,
      expectedRevision: initial.data.revision,
      operation: { type: 'setMode', mode: 'files' },
    })

    expect(updated.status).toBe(200)
    expect(updated.data.navigation.mode).toBe('files')
    expect(updated.data.revision).not.toBe(initial.data.revision)
    expect(app.runtime.refreshNotebook).toHaveBeenCalledOnce()
    expect(app.events[0]).toMatchObject({
      type: 'custom',
      event: 'storyboard:notebook-layout-updated',
      data: { notebookId: 'notebook-api', generation: 7 },
    })
    expect((await app.call('GET', '/navigation')).data.navigation.mode).toBe('files')
  })

  it('returns current state for an outdated content-derived manifest revision', async () => {
    const app = fixture()
    const initial = await app.call('GET', '/navigation')
    const file = path.join(app.root, NOTEBOOK_MANIFEST_FILE)
    fs.appendFileSync(file, '\n')

    const stale = await app.call('POST', '/navigation', {
      notebookId: initial.data.notebookId,
      generation: initial.data.generation,
      expectedRevision: initial.data.revision,
      operation: { type: 'setMode', mode: 'files' },
    })
    expect(stale.status).toBe(409)
    expect(stale.data.error.code).toBe('STALE_NOTEBOOK_REVISION')
    expect(stale.data.current.revision).not.toBe(initial.data.revision)
  })

  it('rejects writes when the active Notebook identity or generation changed', async () => {
    const app = fixture()
    const initial = await app.call('GET', '/navigation')
    const changed = await app.call('POST', '/navigation', {
      notebookId: initial.data.notebookId,
      generation: 6,
      expectedRevision: initial.data.revision,
      operation: { type: 'setMode', mode: 'files' },
    })
    expect(changed.status).toBe(409)
    expect(changed.data.error.code).toBe('NOTEBOOK_SCOPE_CONFLICT')
  })

  it('serializes two writes from one revision so only the first can commit', async () => {
    const app = fixture()
    const initial = await app.call('GET', '/navigation')
    const requestBody = mode => ({
      notebookId: initial.data.notebookId,
      generation: initial.data.generation,
      expectedRevision: initial.data.revision,
      operation: { type: 'setMode', mode },
    })
    const results = await Promise.all([
      app.call('POST', '/navigation', requestBody('files')),
      app.call('POST', '/navigation', requestBody('type')),
    ])
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    expect((await app.call('GET', '/navigation')).data.revision).not.toBe(initial.data.revision)
  })

  it('rejects requests without scope and revision fields', async () => {
    const app = fixture()
    const response = await app.call('POST', '/navigation', { operation: { type: 'setMode', mode: 'files' } })
    expect(response.status).toBe(400)
    expect(response.data.error.code).toBe('INVALID_NAVIGATION_REQUEST')
  })
})
