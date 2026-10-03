import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  adoptLegacySiteCapture,
  readFrameSnapshot,
  writeFrameSnapshot,
} from './frameSnapshotStore.js'
import { frameSnapshotSourceKey, normalizeFrameSnapshotTarget } from './frameSnapshotContract.js'

// Minimal valid 2x3 red PNG.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAACsQa3EAAAAEElEQVR4nGP8z0AsQIaAGQACHgEJ/8ZJnAAAAABJRU5ErkJggg==', 'base64')

describe('Frame snapshot store', () => {
  it('writes and reads theme variants atomically', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-store-'))
    const target = normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'docs', route: 'guide', width: 800, height: 600 })
    const sourceKey = frameSnapshotSourceKey(target)
    await writeFrameSnapshot({ notebookRoot: root, sourceKey, target, variant: 'light', image: PNG_BYTES })
    const missing = await readFrameSnapshot(root, frameSnapshotSourceKey(normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'other', route: '' })))
    expect(missing.status).toBe('missing')
    const descriptor = await readFrameSnapshot(root, sourceKey)
    expect(descriptor.status).toBe('ready')
    expect(descriptor.light.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(descriptor.dark).toBeNull()
    expect(descriptor.target).toEqual(target)
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets', 'canvas', 'snapshots', 'frames', sourceKey, 'manifest.json'), 'utf8'))
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.images.light.width).toBe(2)
  })

  it('rejects invalid images and never publishes them in the manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-invalid-'))
    const target = normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600 })
    const sourceKey = frameSnapshotSourceKey(target)
    await expect(writeFrameSnapshot({ notebookRoot: root, sourceKey, target, variant: 'light', image: Buffer.from('not png') }))
      .rejects.toThrow(/valid PNG/)
    expect(await readFrameSnapshot(root, sourceKey)).toMatchObject({ status: 'missing' })
  })

  it('retains the previous preview when a replacement write fails mid-way', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-atomic-'))
    const target = normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600 })
    const sourceKey = frameSnapshotSourceKey(target)
    await writeFrameSnapshot({ notebookRoot: root, sourceKey, target, variant: 'light', image: PNG_BYTES })
    await expect(writeFrameSnapshot({ notebookRoot: root, sourceKey, target, variant: 'dark', image: Buffer.from('broken') }))
      .rejects.toThrow(/valid PNG/)
    const descriptor = await readFrameSnapshot(root, sourceKey)
    expect(descriptor.light.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(descriptor.dark).toBeNull()
  })

  it('adopts legacy site captures as stale last-good previews', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-legacy-'))
    const legacyDir = path.join(root, '.storyboard', 'site-captures', 'docs')
    await fs.mkdir(legacyDir, { recursive: true })
    const legacyPath = path.join(legacyDir, 'abc123.png')
    await fs.writeFile(legacyPath, PNG_BYTES)
    const target = normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'docs', route: 'guide', width: 800, height: 600 })
    const adopted = await adoptLegacySiteCapture({ notebookRoot: root, sourceKey: frameSnapshotSourceKey(target), target, variant: 'light', legacyPath })
    expect(adopted).toBe(true)
    const descriptor = await readFrameSnapshot(root, frameSnapshotSourceKey(target))
    expect(descriptor.status).toBe('ready')
    expect(descriptor.light.stale).toBe(true)
    // The original legacy file is retained.
    expect(await fs.readFile(legacyPath)).toBeTruthy()
  })

  it('refuses snapshot writes that escape the Notebook filesystem root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-outside-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-frame-outside-real-'))
    try {
      await fs.symlink(outside, path.join(root, 'assets'), 'dir')
      const target = normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600 })
      await expect(writeFrameSnapshot({
        notebookRoot: root,
        sourceKey: frameSnapshotSourceKey(target),
        target,
        variant: 'light',
        image: PNG_BYTES,
      })).rejects.toThrow(/outside its filesystem root/)
      expect(await fs.readdir(outside)).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
