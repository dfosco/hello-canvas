import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFrameSnapshotRoutes } from './frameSnapshotRoutes.js'
import { createFrameSnapshotCapture } from './frameSnapshotCapture.js'
import { frameSnapshotSourceKey, normalizeFrameSnapshotTarget } from './frameSnapshotContract.js'
import { writeFrameSnapshot } from './frameSnapshotStore.js'
import { SiteStore } from '../site/site.js'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0, 0xa9, 0x51, 0xa4, 0x5a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

function respond(handler, { method, path, body = {}, url }) {
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status) { this.__status = status },
      end(payload) { resolve({ status: this.__status, body: JSON.parse(payload) }) },
    }
    handler({ url: url || `http://localhost${path}` }, res, { body, path, method }).catch(reject)
  })
}

describe('Frame snapshot routes', () => {
  it('reads descriptors without touching sources and adopts legacy site captures', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-routes-'))
    const siteStore = new SiteStore(root)
    siteStore.upsert({ id: 'docs', title: 'Docs' })
    siteStore.upsertBinding('docs', { source: 'url', developmentBaseUrl: 'http://127.0.0.1:4311/', revision: 3 })
    const legacyDir = path.join(root, '.storyboard', 'site-captures', 'docs')
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(path.join(legacyDir, 'legacy.png'), png)

    const sendJson = (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }
    const handler = createFrameSnapshotRoutes({ root, sendJson, capture: createFrameSnapshotCapture({ notebookRoot: root }), siteStore })

    // A never-captured prototype target reports missing without any capture.
    const missing = await respond(handler, { method: 'GET', path: '/read', url: 'http://localhost/frame-snapshot?kind=prototype&src=/missing&page&zoom=100&width=800&height=600' })
    expect(missing.status).toBe(200)
    expect(missing.body.snapshot.status).toBe('missing')

    // The legacy site capture is adopted for the current binding revision and theme.
    const { siteCaptureKey } = await import('../site/publish.js')
    const reference = { siteId: 'docs', route: 'guide', width: 800, height: 600 }
    await fs.writeFile(path.join(legacyDir, `${siteCaptureKey(reference, { bindingRevision: 3, theme: 'light' })}.png`), png)
    const adopted = await respond(handler, { method: 'GET', path: '/read', url: 'http://localhost/frame-snapshot?kind=site&siteId=docs&route=guide&width=800&height=600' })
    expect(adopted.body.snapshot.status).toBe('ready')
    expect(adopted.body.snapshot.light.stale).toBe(true)

    await fs.rm(root, { recursive: true, force: true })
  })

  it('captures through the shared service and echoes widget identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-routes-capture-'))
    const target = { kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600 }
    const events = []
    const capture = createFrameSnapshotCapture({
      notebookRoot: root,
      eventSender: data => events.push(data),
      resolveSiteUrl: () => { throw Object.assign(new Error('Site is not running: docs'), { code: 'SITE_NOT_RUNNING' }) },
    })
    // Seed the store directly to avoid launching a real browser here.
    await writeFrameSnapshot({ notebookRoot: root, sourceKey: frameSnapshotSourceKey({ kind: 'prototype', src: '/x', zoom: 100, viewport: { width: 800, height: 563 } }), target: { kind: 'prototype', src: '/x', zoom: 100, viewport: { width: 800, height: 563 } }, variant: 'light', image: png })
    const sendJson = (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }
    const handler = createFrameSnapshotRoutes({ root, sendJson, capture })
    const result = await respond(handler, { method: 'POST', path: '/capture', body: { ...target, widgetId: 'w-1', origin: 'http://localhost:5173', captureUrl: 'http://localhost:5173/x' } })
    expect(result.status).toBe(200)
    expect(result.body.snapshot.status).toBe('ready')
    expect(result.body.snapshot.identity).toEqual({ widgetId: 'w-1' })
    expect(result.body.snapshot.light.dataUrl).toMatch(/^data:image\/png;base64,/)

    // Stopped Site targets are refused with a stable code.
    const stopped = await respond(handler, { method: 'POST', path: '/capture', body: { kind: 'site', siteId: 'docs', route: '', width: 800, height: 600, theme: 'light', origin: 'http://localhost:5173' } })
    expect(stopped.status).toBe(409)
    expect(stopped.body.code).toBe('SITE_NOT_RUNNING')

    await fs.rm(root, { recursive: true, force: true })
  })

  it('forwards the raw captureUrl to the capture service after normalization', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-routes-captureurl-'))
    const seen = []
    const capture = {
      async capture(target, options) {
        seen.push({ target, options })
        return { sourceKey: 'k', kind: target.kind, target, status: 'missing', light: null, dark: null, updatedAt: null }
      },
    }
    const sendJson = (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }
    const handler = createFrameSnapshotRoutes({ root, sendJson, capture })

    const result = await respond(handler, {
      method: 'POST',
      path: '/',
      body: { kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600, captureUrl: 'http://localhost:5173/prototypes.html/x', origin: 'http://localhost:5173' },
    })
    expect(result.status).toBe(200)
    // The normalized target alone drops captureUrl; the service needs it to
    // resolve the document URL for prototype captures.
    expect(seen[0].target.captureUrl).toBe('http://localhost:5173/prototypes.html/x')
    expect(seen[0].target.src).toBe('/x')

    await fs.rm(root, { recursive: true, force: true })
  })

  it('preserves a custom content viewport through route and capture normalization', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-routes-viewport-'))
    let capturedTarget
    const capture = {
      async capture(target) {
        capturedTarget = normalizeFrameSnapshotTarget(target)
        return { status: 'missing', ...capturedTarget, light: null, dark: null }
      },
    }
    const sendJson = (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }
    const handler = createFrameSnapshotRoutes({ root, sendJson, capture })

    const result = await respond(handler, {
      method: 'POST',
      path: '/capture',
      body: { kind: 'site', siteId: 'docs', route: 'guide', width: 1280, height: 900 },
    })

    expect(result.status).toBe(200)
    expect(capturedTarget.viewport).toEqual({ width: 1280, height: 863 })
    expect(result.body.snapshot.viewport).toEqual({ width: 1280, height: 863 })
    await fs.rm(root, { recursive: true, force: true })
  })
})
