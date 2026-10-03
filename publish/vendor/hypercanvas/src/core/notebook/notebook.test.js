import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SiteStore, SITE_CONFIG_FILE } from '../site/site.js'
import {
  NOTEBOOK_CANVAS_CONFIG_FILE,
  NOTEBOOK_CONFIG_FILES,
  NOTEBOOK_DIRECTORIES,
  NOTEBOOK_MANIFEST_FILE,
  NOTEBOOK_RUNTIME_DIR,
  initializeNotebook,
  inspectNotebook,
  notebookPaths,
  openNotebook,
} from './notebook.js'

const roots = []

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-notebook-'))
  roots.push(root)
  return root
}

function copyFixture(name) {
  const source = path.resolve('fixtures', 'notebooks', name)
  const destination = tempRoot()
  fs.cpSync(source, destination, { recursive: true })
  return destination
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

describe('initializeNotebook', () => {
  it('creates a content-only empty Notebook skeleton', () => {
    const root = tempRoot()
    const result = initializeNotebook(root, { id: 'notebook-empty', title: 'Empty Notebook' })
    const paths = notebookPaths(root)

    expect(result.status).toBe('valid')
    expect(result.manifest).toMatchObject({
      formatVersion: 2,
      id: 'notebook-empty',
      title: 'Empty Notebook',
      pages: [],
      navigation: {
        mode: 'type',
        sectionsEnabled: true,
        type: {
          groups: ['prototype', 'canvas', 'site'],
          order: { prototype: [], canvas: [], site: [] },
        },
        files: { flatOrder: [], entries: [], sections: [] },
      },
    })
    expect(fs.existsSync(paths.canvases)).toBe(true)
    expect(fs.existsSync(paths.prototypes)).toBe(true)
    expect(fs.existsSync(paths.components)).toBe(true)
    expect(fs.existsSync(paths.data)).toBe(true)
    expect(fs.existsSync(paths.assets)).toBe(true)
    expect(fs.existsSync(path.join(root, 'sites'))).toBe(false)
    expect(paths).not.toHaveProperty('sites')
    expect(fs.existsSync(paths.runtime)).toBe(true)
    expect(fs.existsSync(paths.canvasConfig)).toBe(true)
    for (const filename of NOTEBOOK_CONFIG_FILES) {
      expect(fs.existsSync(path.join(root, filename))).toBe(true)
    }
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'vite.config.js'))).toBe(false)
    expect(fs.readdirSync(root).sort()).toEqual([
      NOTEBOOK_CANVAS_CONFIG_FILE,
      NOTEBOOK_MANIFEST_FILE,
      NOTEBOOK_RUNTIME_DIR,
      ...NOTEBOOK_CONFIG_FILES,
      NOTEBOOK_DIRECTORIES.assets,
      NOTEBOOK_DIRECTORIES.canvases,
      NOTEBOOK_DIRECTORIES.components,
      NOTEBOOK_DIRECTORIES.data,
      NOTEBOOK_DIRECTORIES.prototypes,
    ].sort())
  })

  it('refuses initialization when the runtime directory escapes through a symlink', () => {
    const root = tempRoot()
    const outside = tempRoot()
    fs.symlinkSync(outside, path.join(root, NOTEBOOK_RUNTIME_DIR), 'dir')

    expect(() => initializeNotebook(root)).toThrow(/runtime directory resolves outside/)
    expect(fs.readdirSync(outside)).toEqual([])
    expect(fs.existsSync(path.join(root, NOTEBOOK_MANIFEST_FILE))).toBe(false)
  })

  it('is idempotent for an existing valid Notebook', () => {
    const root = tempRoot()
    const first = initializeNotebook(root, { id: 'stable', title: 'Stable' })
    const second = initializeNotebook(root, { id: 'different', title: 'Do not replace' })

    expect(second.manifest).toEqual(first.manifest)
  })

  it('lists Sites from the unified ignored Site config file', () => {
    const root = tempRoot()
    initializeNotebook(root, { id: 'sites', title: 'Sites' })
    new SiteStore(root).upsert({ id: 'docs', title: 'Docs' })

    expect(inspectNotebook(root).sites).toEqual([{ id: 'docs', path: SITE_CONFIG_FILE }])
  })

  it('repairs missing config without overwriting Notebook-owned config', () => {
    const root = tempRoot()
    initializeNotebook(root, { id: 'configured', title: 'Configured' })
    fs.writeFileSync(path.join(root, 'terminal.config.json'), '{"agents":{"custom":{}}}\n')
    fs.rmSync(path.join(root, 'toolbar.config.json'))

    initializeNotebook(root)

    expect(fs.readFileSync(path.join(root, 'terminal.config.json'), 'utf8')).toBe('{"agents":{"custom":{}}}\n')
    expect(fs.existsSync(path.join(root, 'toolbar.config.json'))).toBe(true)
  })

  it('restores missing required layout for an existing valid Notebook', () => {
    const root = tempRoot()
    const first = initializeNotebook(root, { id: 'stable', title: 'Stable' })
    const paths = notebookPaths(root)
    fs.rmSync(paths.canvases, { recursive: true })
    fs.rmSync(paths.prototypes, { recursive: true })
    fs.rmSync(paths.assets, { recursive: true })
    fs.rmSync(paths.runtime, { recursive: true })
    fs.rmSync(paths.canvasConfig)

    const repaired = initializeNotebook(root)

    expect(repaired.manifest).toEqual(first.manifest)
    expect(fs.existsSync(paths.canvases)).toBe(true)
    expect(fs.existsSync(paths.prototypes)).toBe(true)
    expect(fs.existsSync(paths.assets)).toBe(true)
    expect(fs.existsSync(paths.runtime)).toBe(true)
    expect(JSON.parse(fs.readFileSync(paths.canvasConfig, 'utf8'))).toEqual({
      version: 1,
      canvasDirectory: 'canvas',
      prototypeDirectory: 'prototypes',
      assetsDirectory: 'assets',
    })
  })

  it('adopts a non-empty folder and preserves its existing content', () => {
    const root = tempRoot()
    fs.writeFileSync(path.join(root, 'notes.txt'), 'user content')

    const result = initializeNotebook(root, { title: 'Existing Folder' })

    expect(result.status).toBe('valid')
    expect(result.manifest.title).toBe('Existing Folder')
    expect(fs.existsSync(path.join(root, NOTEBOOK_MANIFEST_FILE))).toBe(true)
    expect(fs.existsSync(path.join(root, 'notes.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8')).toBe('user content')
    expect(fs.existsSync(path.join(root, NOTEBOOK_DIRECTORIES.canvases))).toBe(true)
    expect(fs.existsSync(path.join(root, NOTEBOOK_DIRECTORIES.prototypes))).toBe(true)
    expect(fs.existsSync(path.join(root, NOTEBOOK_DIRECTORIES.assets))).toBe(true)
  })

  it('discovers external pages and persists them without replacing saved layout', () => {
    const root = tempRoot()
    initializeNotebook(root, { id: 'discovery', title: 'Discovery' })
    const canvasPath = path.join(root, 'canvas', 'board.canvas.jsonl')
    fs.writeFileSync(canvasPath, '{"event":"canvas_created","title":"Board"}\n')
    const prototypeDir = path.join(root, 'prototypes', 'legacy.folder', 'checkout')
    fs.mkdirSync(prototypeDir, { recursive: true })
    fs.writeFileSync(path.join(prototypeDir, 'checkout.prototype.json'), '{"meta":{"title":"Checkout"}}\n')
    fs.writeFileSync(path.join(prototypeDir, 'index.jsx'), 'export default function Checkout() { return null }\n')
    new SiteStore(root).upsert({ id: 'docs', title: 'Docs' })

    const discovered = inspectNotebook(root)
    expect(discovered.needsPageRegistration).toBe(true)
    expect(discovered.pages.map(page => page.type)).toEqual(['canvas', 'prototype', 'site'])
    expect(discovered.pages.map(page => page.title)).toEqual(['Board', 'Checkout', 'Docs'])
    const discoveredIds = discovered.pages.map(page => page.id)
    const persisted = initializeNotebook(root)

    expect(persisted.needsPageRegistration).toBe(false)
    expect(persisted.pages.map(page => page.id)).toEqual(discoveredIds)
    expect(persisted.manifest.navigation.files.flatOrder).toEqual(discoveredIds)
    expect(persisted.manifest.pages[1].path).toBe('prototypes/legacy.folder/checkout')
  })
})

describe('inspectNotebook', () => {
  it('lists canvas and prototype folders in manifest order', () => {
    const result = inspectNotebook(copyFixture('mixed-notebook'))

    expect(result.status).toBe('valid')
    expect(result.pages.map(page => page.id)).toEqual([
      'canvas-overview',
      'prototype-landing',
      'canvas-research',
      'prototype-checkout',
    ])
    expect(result.pages.every(page => page.available)).toBe(true)
    expect(result.pages.map(page => page.type)).toEqual(['canvas', 'prototype', 'canvas', 'prototype'])
  })

  it('keeps a page unavailable when its payload is deleted', () => {
    const root = copyFixture('rename-delete-notebook')
    fs.rmSync(path.join(root, 'canvas', 'overview.canvas.jsonl'))

    const result = inspectNotebook(root)
    const page = result.pages.find(entry => entry.id === 'canvas-overview')

    expect(result.status).toBe('valid')
    expect(page.available).toBe(false)
    expect(page.diagnostics.map(item => item.code)).toContain('MISSING_PAGE_PAYLOAD')
    expect(result.pages.find(entry => entry.id === 'canvas-secondary').available).toBe(true)
  })

  it('uses an externally changed Canvas title in the registered page catalog', () => {
    const root = copyFixture('rename-delete-notebook')
    const canvasPath = path.join(root, 'canvas', 'overview.canvas.jsonl')
    const event = JSON.parse(fs.readFileSync(canvasPath, 'utf8'))
    event.title = 'External rename'
    fs.writeFileSync(canvasPath, `${JSON.stringify(event)}\n`)

    const result = inspectNotebook(root)
    expect(result.pages.find(page => page.id === 'canvas-overview').title).toBe('External rename')
  })

  it('reports a deleted prototype folder without hiding other pages', () => {
    const root = copyFixture('rename-delete-notebook')
    fs.rmSync(path.join(root, 'prototypes', 'landing'), { recursive: true })

    const result = inspectNotebook(root)
    const page = result.pages.find(entry => entry.id === 'prototype-landing')

    expect(page.available).toBe(false)
    expect(page.diagnostics.map(item => item.code)).toContain('MISSING_PAGE_PAYLOAD')
    expect(result.pages.find(entry => entry.id === 'prototype-secondary').available).toBe(true)
  })

  it('migrates v1 IDs and paths once and registers Site descriptors', () => {
    const root = tempRoot()
    fs.mkdirSync(path.join(root, 'canvas'), { recursive: true })
    fs.mkdirSync(path.join(root, 'prototypes', 'main.folder', 'landing'), { recursive: true })
    fs.writeFileSync(path.join(root, 'canvas', 'overview.canvas.jsonl'), '{}\n')
    const legacy = {
      formatVersion: 1,
      id: 'legacy-notebook',
      title: 'Legacy Notebook',
      pages: [
        { id: 'canvas-existing', type: 'canvas', title: 'Overview', path: 'canvas/overview.canvas.jsonl' },
        { id: 'proto-existing', type: 'prototype', title: 'Landing', path: 'prototypes/main.folder/landing' },
      ],
    }
    fs.writeFileSync(path.join(root, NOTEBOOK_MANIFEST_FILE), `${JSON.stringify(legacy, null, 2)}\n`)
    new SiteStore(root).upsert({
      id: 'docs',
      title: 'Docs',
      deployments: { production: { baseUrl: 'https://docs.example.test' } },
    })

    const inspected = inspectNotebook(root)
    expect(inspected.status).toBe('valid')
    expect(inspected.needsMigration).toBe(true)
    expect(inspected.manifest.formatVersion).toBe(2)
    expect(inspected.pages.map(page => page.id)).toEqual(['canvas-existing', 'proto-existing', expect.stringMatching(/^site-/)])
    expect(inspected.pages[0]).toMatchObject({ path: 'canvas/overview.canvas.jsonl', available: true })
    expect(inspected.pages[2]).toMatchObject({ type: 'site', siteId: 'docs', title: 'Docs', productionUrl: 'https://docs.example.test/' })
    expect(JSON.parse(fs.readFileSync(path.join(root, NOTEBOOK_MANIFEST_FILE), 'utf8')).formatVersion).toBe(1)

    const migrated = initializeNotebook(root)
    const migratedContents = fs.readFileSync(path.join(root, NOTEBOOK_MANIFEST_FILE), 'utf8')
    expect(migrated.status).toBe('valid')
    expect(migrated.manifest.formatVersion).toBe(2)
    expect(migrated.needsMigration).toBe(false)
    expect(fs.existsSync(path.join(root, '.storyboard', 'migrations', 'hypercanvas.notebook.v1.json'))).toBe(true)
    initializeNotebook(root)
    expect(fs.readFileSync(path.join(root, NOTEBOOK_MANIFEST_FILE), 'utf8')).toBe(migratedContents)
  })

  it('keeps draft route collisions in the catalog as unavailable diagnostic pages', () => {
    const root = tempRoot()
    fs.mkdirSync(path.join(root, 'canvas', 'drafts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'canvas', 'guide.canvas.jsonl'), '{}\n')
    fs.writeFileSync(path.join(root, 'canvas', 'drafts', 'guide.canvas.jsonl'), '{}\n')
    fs.writeFileSync(path.join(root, NOTEBOOK_MANIFEST_FILE), JSON.stringify({
      formatVersion: 1,
      id: 'collision-notebook',
      title: 'Collision Notebook',
      pages: [
        { id: 'guide', type: 'canvas', title: 'Guide', path: 'canvas/guide.canvas.jsonl' },
        { id: 'draft-guide', type: 'canvas', title: 'Draft guide', path: 'canvas/drafts/guide.canvas.jsonl' },
      ],
    }))

    const result = inspectNotebook(root)
    expect(result.status).toBe('valid')
    expect(result.pages.map(page => page.route)).toEqual(['/canvas/guide', '/canvas/guide'])
    expect(result.pages.every(page => page.available === false)).toBe(true)
    expect(result.pages.every(page => page.diagnostics.some(item => item.code === 'PAGE_ROUTE_CONFLICT'))).toBe(true)
  })

  it('keeps conflicting Prototype data scopes visible and unavailable', () => {
    const root = tempRoot()
    const prototypePaths = ['prototypes/landing', 'prototypes/drafts/landing']
    for (const relative of prototypePaths) {
      const directory = path.join(root, relative)
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, 'index.jsx'), 'export default function Landing() { return null }\n')
      fs.writeFileSync(path.join(directory, 'default.object.json'), JSON.stringify({ source: relative }))
    }
    initializeNotebook(root, { id: 'data-scope-collision', title: 'Data scope collision' })

    const result = inspectNotebook(root)
    const prototypes = result.pages.filter(page => page.type === 'prototype')

    expect(result.status).toBe('valid')
    expect(prototypes).toHaveLength(2)
    expect(prototypes.every(page => !page.available)).toBe(true)
    expect(prototypes.every(page => page.diagnostics.some(item => item.code === 'PROTOTYPE_DATA_SCOPE_CONFLICT'))).toBe(true)
  })

  it('reports custom Git exclusions that can omit registered draft-path content', () => {
    const root = copyFixture('mixed-notebook')
    fs.writeFileSync(path.join(root, '.gitignore'), 'custom/**/drafts/**\n')

    const result = inspectNotebook(root)

    expect(result.status).toBe('valid')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CUSTOM_DRAFT_EXCLUSION',
      path: '.gitignore:1',
    }))
  })

  it('keeps Prototype-contained Canvas entries visible but unavailable', () => {
    const root = tempRoot()
    fs.mkdirSync(path.join(root, 'prototypes', 'landing'), { recursive: true })
    const legacyCanvasPath = path.join(root, 'prototypes', 'landing', 'notes.canvas.jsonl')
    fs.writeFileSync(legacyCanvasPath, '{}\n')
    fs.writeFileSync(path.join(root, NOTEBOOK_MANIFEST_FILE), JSON.stringify({
      formatVersion: 2,
      id: 'nested-canvas',
      title: 'Nested Canvas',
      pages: [{ id: 'legacy-canvas', type: 'canvas', title: 'Notes', path: 'prototypes/landing/notes.canvas.jsonl' }],
    }))

    const result = inspectNotebook(root)
    expect(result.status).toBe('valid')
    expect(result.pages[0].available).toBe(false)
    expect(result.pages[0].diagnostics.map(item => item.code)).toContain('UNSUPPORTED_CANVAS_LOCATION')
    expect(fs.existsSync(legacyCanvasPath)).toBe(true)
  })

  it('preserves identity when a payload is renamed and the manifest is updated', () => {
    const root = copyFixture('rename-delete-notebook')
    const oldPath = path.join(root, 'canvas', 'overview.canvas.jsonl')
    const newPath = path.join(root, 'canvas', 'renamed-overview.canvas.jsonl')
    fs.renameSync(oldPath, newPath)

    const manifestPath = path.join(root, NOTEBOOK_MANIFEST_FILE)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.pages[0].path = 'canvas/renamed-overview.canvas.jsonl'
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = inspectNotebook(root)
    expect(result.pages[0]).toMatchObject({ id: 'canvas-overview', path: 'canvas/renamed-overview.canvas.jsonl', available: true })
  })

  it('does not guess identity for an unregistered raw rename', () => {
    const root = copyFixture('rename-delete-notebook')
    fs.renameSync(
      path.join(root, 'canvas', 'overview.canvas.jsonl'),
      path.join(root, 'canvas', 'renamed-overview.canvas.jsonl'),
    )

    const result = inspectNotebook(root)
    expect(result.pages[0].id).toBe('canvas-overview')
    expect(result.pages[0].available).toBe(false)
    expect(result.pages[0].path).toBe('canvas/overview.canvas.jsonl')
  })

  it('rejects payload symlinks that escape the Notebook root', () => {
    const root = copyFixture('rename-delete-notebook')
    const outside = tempRoot()
    const outsideCanvas = path.join(outside, 'outside.canvas.jsonl')
    fs.writeFileSync(outsideCanvas, '{}')
    fs.rmSync(path.join(root, 'canvas', 'overview.canvas.jsonl'))
    fs.symlinkSync(outsideCanvas, path.join(root, 'canvas', 'overview.canvas.jsonl'))

    const result = inspectNotebook(root)
    expect(result.pages[0].available).toBe(false)
    expect(result.pages[0].diagnostics.map(item => item.code)).toContain('UNSAFE_PAGE_PATH')
  })

  it('reports malformed and unsafe manifests without modifying them', () => {
    const root = copyFixture('invalid-notebook')
    const manifestPath = path.join(root, NOTEBOOK_MANIFEST_FILE)
    const original = fs.readFileSync(manifestPath, 'utf8')
    fs.writeFileSync(manifestPath, '{ malformed')

    const malformed = inspectNotebook(root)
    expect(malformed.status).toBe('invalid')
    expect(malformed.diagnostics.map(item => item.code)).toContain('MALFORMED_MANIFEST')

    fs.writeFileSync(manifestPath, original)
    const restored = inspectNotebook(root)
    expect(restored.status).toBe('invalid')
    expect(restored.diagnostics.map(item => item.code)).toContain('INVALID_PAGE_PATH')
  })

  it.each([
    ['unsupported-version', 'UNSUPPORTED_VERSION'],
    ['duplicate-page-ids', 'DUPLICATE_PAGE_ID'],
    ['unknown-page-type', 'UNKNOWN_PAGE_TYPE'],
    ['missing-page-payload', 'MISSING_PAGE_PAYLOAD'],
  ])('reports %s with a deterministic diagnostic', (fixture, code) => {
    const result = inspectNotebook(copyFixture(`invalid-notebook/${fixture}`))

    expect(result.diagnostics.map(item => item.code)).toContain(code)
  })

  it('returns an unavailable state when the selected root is deleted', () => {
    const root = copyFixture('empty-notebook')
    const session = openNotebook(root)
    fs.rmSync(root, { recursive: true })

    expect(session.refresh()).toMatchObject({ status: 'unavailable' })
    expect(session.snapshot.diagnostics[0].code).toBe('ROOT_NOT_FOUND')
    session.close()
  })

  it('retains the last valid snapshot across a transient malformed write', () => {
    const root = copyFixture('mixed-notebook')
    const session = openNotebook(root)
    const manifestPath = path.join(root, NOTEBOOK_MANIFEST_FILE)
    const original = fs.readFileSync(manifestPath, 'utf8')

    fs.writeFileSync(manifestPath, '{')
    expect(session.refresh().status).toBe('invalid')
    expect(session.snapshot.pages).toHaveLength(4)

    fs.writeFileSync(manifestPath, original)
    expect(session.refresh().status).toBe('valid')
    expect(session.snapshot.pages).toHaveLength(4)
    session.close()
  })
})
