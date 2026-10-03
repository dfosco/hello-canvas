// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createArtifact, deleteArtifact, editArtifact } from './operations.js'
import { createArtifactRoutes } from './routes.js'
import { initializeNotebook } from '../notebook/notebook.js'
import { SiteStore } from '../site/site.js'

const roots = []
function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-artifact-'))
  roots.push(root)
  return root
}
function notebook(title) {
  const root = createRoot()
  initializeNotebook(root, { title })
  return root
}
afterEach(() => {
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
  delete globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__
})

describe('Notebook artifact ownership', () => {
  it('writes created artifacts to the Notebook content directories', () => {
    const root = notebook('Authoring')
    expect(createArtifact('canvas', { name: 'owned-canvas', title: 'Owned' }, root).success).toBe(true)
    expect(fs.existsSync(path.join(root, 'canvas/owned-canvas.canvas.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false)
  })
})

describe('artifact CRUD operations', () => {
  it('edits and deletes a prototype while reporting changed files', () => {
    const root = createRoot()
    expect(createArtifact('prototype', { name: 'demo', title: 'Demo' }, root).success).toBe(true)
    const edited = editArtifact('prototype', 'demo', { title: 'Updated' }, root)
    expect(edited.files).toEqual(['src/prototypes/demo/demo.prototype.json'])
    expect(deleteArtifact('prototype', 'demo', {}, root).files).toContain('src/prototypes/demo/demo.prototype.json')
  })

  it('updates and deletes canvases from root, page, and workspace layouts', () => {
    const root = createRoot()
    expect(createArtifact('canvas', { name: 'root-canvas' }, root).success).toBe(true)
    expect(createArtifact('canvas', { name: 'overview', folder: 'tour', folderKind: 'pages' }, root).success).toBe(true)
    expect(createArtifact('canvas', { name: 'landing', folder: 'marketing', folderKind: 'workspace', jsx: true }, root).success).toBe(true)
    expect(editArtifact('canvas', 'landing', { folder: 'marketing', title: 'Landing Page' }, root).success).toBe(true)
    for (const [name, folder] of [['root-canvas', undefined], ['overview', 'tour'], ['landing', 'marketing']]) {
      expect(deleteArtifact('canvas', name, { folder }, root).success).toBe(true)
    }
  })

  it('removes a Site local runtime binding on delete', () => {
    const root = createRoot()
    createArtifact('site', { name: 'docs', title: 'Docs', productionBaseUrl: 'https://docs.example' }, root)
    const store = new SiteStore(root)
    store.upsertBinding('docs', { source: 'managed', root, startCommand: 'npm run dev' })
    expect(deleteArtifact('site', 'docs', {}, root).success).toBe(true)
    expect(store.getBinding('docs')).toBeNull()
  })

  it('creates and edits Site description, local URL, run command, and deploy URL', () => {
    const root = createRoot()
    const created = createArtifact('site', {
      name: 'docs',
      title: 'Docs',
      description: 'Documentation',
      developmentBaseUrl: 'http://localhost:4317/docs',
      startCommand: 'npm run dev',
      productionBaseUrl: 'https://docs.example.com',
    }, root)
    expect(created).toMatchObject({
      success: true,
      site: {
        description: 'Documentation',
        deployments: { production: { baseUrl: 'https://docs.example.com/' } },
        binding: { source: 'url', developmentBaseUrl: 'http://localhost:4317/docs/', startCommand: 'npm run dev' },
      },
    })

    const updated = editArtifact('site', 'docs', {
      description: 'Updated documentation',
      developmentBaseUrl: 'http://127.0.0.1:4318/docs',
      startCommand: 'npm run preview',
      productionBaseUrl: 'https://docs.example.com/v2',
    }, root)
    expect(updated).toMatchObject({
      success: true,
      updated: {
        description: 'Updated documentation',
        deployments: { production: { baseUrl: 'https://docs.example.com/v2/' } },
        binding: { developmentBaseUrl: 'http://127.0.0.1:4318/docs/', startCommand: 'npm run preview' },
      },
    })
  })
})

describe('artifact routes', () => {
  it('delegates Site deletion to the lifecycle owner', async () => {
    const root = notebook('Sites')
    let response
    const deleteSite = vi.fn(async name => ({ success: true, deleted: name, files: ['.storyboard/sites.config.json'] }))
    const handler = createArtifactRoutes({
      root,
      sendJson: (_res, status, body) => { response = { status, body } },
      deleteSite,
    })

    await handler({ url: 'http://localhost/' }, null, {
      method: 'DELETE',
      path: '/',
      body: { type: 'site', name: 'docs' },
    })

    expect(deleteSite).toHaveBeenCalledWith('docs', {})
    expect(response).toEqual({
      status: 200,
      body: { success: true, deleted: 'docs', files: ['.storyboard/sites.config.json'] },
    })
  })

  it('notifies the data index after metadata updates and deletes', async () => {
    const root = createRoot()
    const notifications = []
    globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__ = (file, event) => notifications.push({ file: path.relative(root, file), event })
    let response
    const handler = createArtifactRoutes({ root, sendJson: (_res, status, body) => { response = { status, body } } })
    await handler({ url: 'http://localhost/' }, null, { method: 'POST', path: '/', body: { type: 'prototype', name: 'demo' } })
    await handler({ url: 'http://localhost/' }, null, { method: 'PATCH', path: '/', body: { type: 'prototype', name: 'demo', title: 'Updated' } })
    await handler({ url: 'http://localhost/' }, null, { method: 'DELETE', path: '/', body: { type: 'prototype', name: 'demo' } })
    expect(response.status).toBe(200)
    expect(notifications.map(item => item.event)).toEqual(expect.arrayContaining(['add', 'change', 'unlink']))
  })
})
