import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0, 0xa9, 0x51, 0xa4, 0x5a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  const state = { captures: [], contexts: [], png, gotoFailure: null, launches: 0 }
  const fakeBrowser = {
    async newContext(options) {
      const context = {
        options,
        closed: false,
        async newPage() {
          return {
            async goto(url) {
              state.captures.push({ url, colorScheme: options.colorScheme, viewport: options.viewport, deviceScaleFactor: options.deviceScaleFactor })
              if (state.gotoFailure) throw state.gotoFailure
            },
            async waitForLoadState() {},
            async evaluate() {},
            async waitForTimeout() {},
            async screenshot() { return state.png },
          }
        },
        async close() { context.closed = true },
      }
      state.contexts.push(context)
      return context
    },
    async close() { /* pooled browser */ },
  }
  const launch = vi.fn(async () => {
    state.launches += 1
    return fakeBrowser
  })
  return { state, launch }
})

vi.mock('playwright', () => ({ chromium: { launch: state.launch } }))

const { createFrameSnapshotCapture, closeFrameSnapshotBrowser } = await import('./frameSnapshotCapture.js')
const { frameSnapshotSourceKey, normalizeFrameSnapshotTarget } = await import('./frameSnapshotContract.js')

describe('Frame snapshot capture service', () => {
  let root

  afterEach(async () => {
    // Release the pooled browser between tests; the pool persists for the
    // module lifetime by design.
    await closeFrameSnapshotBrowser()
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
    state.state.captures.length = 0
    state.state.contexts.length = 0
    state.state.launches = 0
    state.state.gotoFailure = null
    vi.clearAllMocks()
  })

  function service(eventSender = null) {
    return createFrameSnapshotCapture({
      notebookRoot: root,
      eventSender,
      resolveSiteUrl: (siteId, route) => `http://127.0.0.1:4311/${siteId}/${route || ''}`,
    })
  }

  const target = { kind: 'site', siteId: 'docs', route: 'guide', width: 800, height: 600 }

  it('captures both themes with one browser, isolated contexts, and emits one event per target', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-capture-'))
    const events = []
    const snapshots = service(data => events.push(data))
    const descriptor = await snapshots.capture(target, { theme: 'both', identity: { widgetId: 'w1' } })
    expect(state.state.launches).toBe(1)
    expect(state.state.contexts).toHaveLength(2)
    expect(state.state.captures.map(capture => capture.colorScheme).sort()).toEqual(['dark', 'light'])
    for (const capture of state.state.captures) {
      expect(capture.viewport).toEqual({ width: 800, height: 563 })
      expect(capture.deviceScaleFactor).toBe(2)
    }
    expect(descriptor.status).toBe('ready')
    expect(descriptor.light.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(descriptor.dark.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(events).toEqual([
      { type: 'custom', event: 'storyboard:frame-snapshot:updated', data: { sourceKey: frameSnapshotSourceKey(normalizeFrameSnapshotTarget(target)), kind: 'site', widgetId: 'w1' } },
    ])
  })

  it('keeps a custom Frame viewport when the target is already normalized', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-wide-'))
    const target = normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'docs', route: 'guide', width: 1320, height: 840 })
    await service().capture(target, { theme: 'light' })

    expect(state.state.captures[0].viewport).toEqual({ width: 1320, height: 803 })
  })

  it('reuses the cached descriptor without launching a browser', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-cached-'))
    const snapshots = service()
    await snapshots.capture(target, { theme: 'light' })
    const cached = await snapshots.capture(target, { theme: 'light' })
    expect(cached.cached).toBe(true)
    expect(state.state.launches).toBe(1)
    expect(state.state.contexts).toHaveLength(1)
  })

  it('serializes concurrent captures of different targets and closes each context', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-queue-'))
    const snapshots = service()
    const other = { kind: 'site', siteId: 'docs', route: 'other', width: 800, height: 600 }
    const [first, second] = await Promise.all([
      snapshots.capture(target, { theme: 'light' }),
      snapshots.capture(other, { theme: 'light' }),
    ])
    expect(first.sourceKey).not.toBe(second.sourceKey)
    expect(state.state.contexts.filter(context => context.closed)).toHaveLength(state.state.contexts.length)
  })

  it('records navigation failures and retains the previously captured preview', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-fail-'))
    const snapshots = service()
    await snapshots.capture(target, { theme: 'light' })
    state.state.gotoFailure = new Error('net::ERR_CONNECTION_REFUSED at http://localhost/')
    await expect(snapshots.capture({ ...target, route: 'broken' }, { theme: 'light' }))
      .rejects.toMatchObject({ code: 'CAPTURE_NAVIGATION_FAILED' })
    state.state.gotoFailure = null
    // The earlier successful snapshot for the first target is untouched.
    const descriptor = await snapshots.read(target)
    expect(descriptor.status).toBe('ready')
    expect(descriptor.light.dataUrl).toMatch(/^data:image\/png;base64,/)
    const failures = JSON.parse(await fs.readFile(path.join(root, '.storyboard', 'frame-captures', `${frameSnapshotSourceKey(normalizeFrameSnapshotTarget({ ...target, route: 'broken' }))}.json`), 'utf8'))
    expect(failures.error.code).toBe('CAPTURE_NAVIGATION_FAILED')
  })

  it('refuses to capture remote or invalid URLs', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-remote-'))
    const snapshots = service()
    await expect(snapshots.capture({ kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600, captureUrl: 'https://example.com/x' }, { origin: 'http://localhost:5173' }))
      .rejects.toMatchObject({ code: 'FRAME_CAPTURE_URL_NOT_LOCAL' })
    await expect(snapshots.capture({ kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600, captureUrl: 'not a url' }, { origin: 'http://localhost:5173' }))
      .rejects.toMatchObject({ code: 'FRAME_CAPTURE_URL_INVALID' })
  })
})
