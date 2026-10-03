import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureSiteFrame, readSiteCapture } from './capture.js'

describe('Site capture cache', () => {
  it('captures once and reuses the binding-revision keyed image', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-capture-'))
    let calls = 0
    const adapter = async () => { calls += 1; return Buffer.from('png') }
    const reference = { siteId: 'docs', route: 'guide', width: 800, height: 600 }
    const first = await captureSiteFrame({ notebookRoot: root, reference, developmentUrl: 'http://localhost:4311/guide', captureAdapter: adapter, bindingRevision: 1 })
    const second = await captureSiteFrame({ notebookRoot: root, reference, developmentUrl: 'http://localhost:4311/guide', captureAdapter: adapter, bindingRevision: 1 })
    expect(calls).toBe(1)
    expect(second.cached).toBe(true)
    expect((await readSiteCapture(root, reference, { bindingRevision: 1 })).dataUrl).toMatch(/^data:image\/png;base64,/) 
    expect(first.captureKey).toBe(second.captureKey)
  })

  it('rejects capture writes redirected through a Notebook runtime symlink', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-capture-root-'))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hypercanvas-capture-outside-'))
    try {
      await fs.symlink(outside, path.join(root, '.storyboard'), 'dir')
      const captureAdapter = async () => Buffer.from('png')

      await expect(captureSiteFrame({
        notebookRoot: root,
        reference: { siteId: 'docs', route: 'guide' },
        developmentUrl: 'http://localhost:4311/guide',
        captureAdapter,
      })).rejects.toThrow(/outside its filesystem root/)
      expect(await fs.readdir(outside)).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
