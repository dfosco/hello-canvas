import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNotebookRuntime } from '../notebook/runtime.js'
import { defaultDemoNotebookPath, resolveStartupNotebook, runStartupScaffolds } from './startupScaffolds.js'

const roots = []
function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-scaffold-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function templateAt(root) {
  const template = path.join(root, 'template')
  for (const entry of ['canvas', 'prototypes', 'assets', 'sites']) fs.mkdirSync(path.join(template, entry), { recursive: true })
  fs.writeFileSync(path.join(template, 'hypercanvas.notebook.json'), '{}')
  fs.writeFileSync(path.join(template, 'storyboard.canvas.json'), '{}')
  fs.writeFileSync(path.join(template, 'assets', 'sample.txt'), 'fixture')
  return template
}

describe('startup scaffold registry', () => {
  it('scaffolds once, preserves user settings, and does not recreate deletion', () => {
    const home = path.join(tempRoot(), 'home')
    const source = templateAt(tempRoot())
    fs.mkdirSync(path.join(home, '.hypercanvas-dev'), { recursive: true })
    fs.writeFileSync(path.join(home, '.hypercanvas-dev/settings.json'), '{"theme":"dark"}')

    const demo = runStartupScaffolds({ profile: 'development', home, source })['demo-notebook']
    expect(demo).toBe(defaultDemoNotebookPath('development', home))
    expect(fs.readFileSync(path.join(demo, 'assets/sample.txt'), 'utf8')).toBe('fixture')
    expect(JSON.parse(fs.readFileSync(path.join(home, '.hypercanvas-dev/settings.json')))).toEqual({ theme: 'dark', demoNotebookProvisioned: true })

    fs.writeFileSync(path.join(demo, 'assets/sample.txt'), 'edited')
    runStartupScaffolds({ profile: 'development', home, source })
    expect(fs.readFileSync(path.join(demo, 'assets/sample.txt'), 'utf8')).toBe('edited')
    fs.rmSync(demo, { recursive: true })
    runStartupScaffolds({ profile: 'development', home, source })
    expect(fs.existsSync(demo)).toBe(false)
  })

  it('keeps development and production scaffold profiles separate', () => {
    const home = path.join(tempRoot(), 'home')
    const source = templateAt(tempRoot())
    const dev = runStartupScaffolds({ profile: 'development', home, source })['demo-notebook']
    const prod = runStartupScaffolds({ profile: 'production', home, source })['demo-notebook']
    expect(dev).toBe(path.join(home, 'Documents/hypercanvas-dev/demo'))
    expect(prod).toBe(path.join(home, 'Documents/hypercanvas/demo'))
    expect(dev).not.toBe(prod)
    expect(fs.existsSync(path.join(home, '.hypercanvas-dev/settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.hypercanvas/settings.json'))).toBe(true)
  })

  it('restores the most recently selected available Notebook instead of the demo', () => {
    const home = path.join(tempRoot(), 'home')
    const source = templateAt(tempRoot())
    const demo = runStartupScaffolds({ profile: 'development', home, source })['demo-notebook']
    const selected = path.join(home, 'Documents', 'client-work')
    const stateDirectory = path.join(home, '.hypercanvas-dev')

    fs.mkdirSync(selected, { recursive: true })
    const runtime = createNotebookRuntime({ stateDirectory })
    runtime.open(selected)

    expect(resolveStartupNotebook({ profile: 'development', home, stateDirectory, fallback: demo }))
      .toBe(fs.realpathSync.native(selected))
  })

  it('prefers an explicit valid Notebook and falls back when the remembered Notebook is unavailable', () => {
    const home = path.join(tempRoot(), 'home')
    const source = templateAt(tempRoot())
    const demo = runStartupScaffolds({ profile: 'development', home, source })['demo-notebook']
    const remembered = path.join(home, 'Documents', 'remembered')
    const explicit = path.join(home, 'Documents', 'explicit')
    const stateDirectory = path.join(home, '.hypercanvas-dev')

    fs.mkdirSync(remembered, { recursive: true })
    fs.mkdirSync(explicit, { recursive: true })
    const runtime = createNotebookRuntime({ stateDirectory })
    runtime.open(remembered)
    runtime.open(explicit)
    expect(resolveStartupNotebook({ profile: 'development', home, activeNotebook: remembered, stateDirectory, fallback: demo }))
      .toBe(path.resolve(remembered))

    fs.rmSync(explicit, { recursive: true, force: true })
    expect(resolveStartupNotebook({ profile: 'development', home, stateDirectory, fallback: demo }))
      .toBe(fs.realpathSync.native(remembered))
    fs.rmSync(remembered, { recursive: true, force: true })
    expect(resolveStartupNotebook({ profile: 'development', home, stateDirectory, fallback: demo })).toBe(demo)
  })

  it('does not overwrite a pre-existing demo folder', () => {
    const home = path.join(tempRoot(), 'home')
    const source = templateAt(tempRoot())
    const demo = defaultDemoNotebookPath('development', home)
    fs.mkdirSync(demo, { recursive: true })
    fs.writeFileSync(path.join(demo, 'mine.txt'), 'mine')
    runStartupScaffolds({ profile: 'development', home, source })
    expect(fs.readFileSync(path.join(demo, 'mine.txt'), 'utf8')).toBe('mine')
    expect(fs.existsSync(path.join(demo, 'hypercanvas.notebook.json'))).toBe(false)
  })

  it('links demo notebook node_modules so prototype CSS can import tailwindcss', () => {
    const home = path.join(tempRoot(), 'home')
    const source = templateAt(tempRoot())
    const demo = runStartupScaffolds({ profile: 'development', home, source })['demo-notebook']

    const link = path.join(demo, 'node_modules', 'tailwindcss')
    const stats = fs.lstatSync(link)
    expect(stats.isSymbolicLink()).toBe(true)
    expect(fs.existsSync(fs.realpathSync(link))).toBe(true)

    // Stale link from an older app install gets replaced, and the op is
    // idempotent across repeated startups (same target).
    fs.rmSync(link)
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync('/nonexistent-app/node_modules/tailwindcss', link, 'dir')
    runStartupScaffolds({ profile: 'development', home, source })
    expect(fs.readlinkSync(link)).not.toBe('/nonexistent-app/node_modules/tailwindcss')

    const first = fs.readlinkSync(link)
    runStartupScaffolds({ profile: 'development', home, source })
    expect(fs.readlinkSync(link)).toBe(first)
  })
})
