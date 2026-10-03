import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAvailabilityTracker, shouldReloadNotebookFile } from './vite-runtime-plugin.js'

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notebook-availability-'))
}

function writeManifest(folder, id) {
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'hypercanvas.notebook.json'), JSON.stringify({ formatVersion: 1, id, title: 'T', pages: [] }))
}

function activeStatus(root, id = 'nb_test') {
  return { active: true, root, notebook: { manifest: { id } } }
}

describe('Notebook runtime reload paths', () => {
  it('reloads ordinary Notebook assets and Site metadata but not canvas documents', () => {
    const root = tempRoot()
    const assets = path.join(root, 'assets')
    const siteConfig = path.join(root, '.storyboard', 'sites.config.json')
    const watchedPaths = [assets, siteConfig]

    expect(shouldReloadNotebookFile(path.join(assets, 'static', 'logo.png'), watchedPaths)).toBe(true)
    expect(shouldReloadNotebookFile(siteConfig, watchedPaths)).toBe(true)
    expect(shouldReloadNotebookFile(path.join(root, 'canvas', 'demo.canvas.jsonl'), [root])).toBe(false)
  })
})

describe('notebook availability tracker', () => {
  it('reports available while the notebook folder exists', () => {
    const root = tempRoot()
    writeManifest(root, 'nb_test')
    const tracker = createAvailabilityTracker()
    expect(tracker(activeStatus(root))).toEqual({ available: true })
  })

  it('reports missing when the folder is deleted', () => {
    const root = tempRoot()
    writeManifest(root, 'nb_missing_test')
    const tracker = createAvailabilityTracker()
    tracker(activeStatus(root, 'nb_missing_test'))
    fs.rmSync(root, { recursive: true })
    expect(tracker(activeStatus(root, 'nb_missing_test'))).toEqual({ available: false, reason: 'missing' })
  })

  it('tracks a rename within the parent by matching the notebook id', () => {
    const parent = tempRoot()
    const root = path.join(parent, 'demo')
    writeManifest(root, 'nb_move_test')
    const tracker = createAvailabilityTracker()
    tracker(activeStatus(root, 'nb_move_test'))

    const renamed = path.join(parent, 'demo-renamed')
    fs.renameSync(root, renamed)

    expect(tracker(activeStatus(root, 'nb_move_test'))).toEqual({
      available: false,
      reason: 'moved',
      movedTo: renamed,
    })
  })

  it('reports missing when the folder moved outside the parent', () => {
    const parent = tempRoot()
    const root = path.join(parent, 'demo')
    writeManifest(root, 'nb_move_away')
    const tracker = createAvailabilityTracker()
    tracker(activeStatus(root, 'nb_move_away'))

    const elsewhere = tempRoot()
    fs.renameSync(root, path.join(elsewhere, 'demo'))

    expect(tracker(activeStatus(root, 'nb_move_away'))).toEqual({ available: false, reason: 'missing' })
  })

  it('reports no-notebook when the runtime has no active notebook', () => {
    const tracker = createAvailabilityTracker()
    expect(tracker({ active: false, root: null })).toEqual({ available: false, reason: 'no-notebook' })
  })

  it('recovers to available when the folder returns', () => {
    const root = tempRoot()
    writeManifest(root, 'nb_recover')
    const tracker = createAvailabilityTracker()
    tracker(activeStatus(root, 'nb_recover'))
    fs.rmSync(root, { recursive: true })
    expect(tracker(activeStatus(root, 'nb_recover')).available).toBe(false)
    writeManifest(root, 'nb_recover')
    expect(tracker(activeStatus(root, 'nb_recover'))).toEqual({ available: true })
  })
})
