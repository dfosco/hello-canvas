import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createNotebookRuntime } from '../notebook/runtime.js'
import { resolveNotebookStateDirectory } from '../notebook/stateDirectory.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function copyTree(source, destination) {
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    fs.mkdirSync(destination)
    for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry))
  } else if (stat.isFile()) {
    fs.copyFileSync(source, destination)
  } else {
    throw new Error(`Unsupported scaffold entry: ${source}`)
  }
}

const operations = [
  {
    id: 'demo-notebook',
    policy: 'once-per-user-profile',
    provision({ profile, home, source }) {
      const suffix = profile === 'development' ? '-dev' : ''
      const configDir = path.join(home, `.hypercanvas${suffix}`)
      const settingsPath = path.join(configDir, 'settings.json')
      const destination = path.join(home, 'Documents', `hypercanvas${suffix}`, 'demo')
      let settings = {}
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`Invalid settings object: ${settingsPath}`)
      }
      if (settings.demoNotebookProvisioned === true) return destination

      if (!fs.existsSync(destination)) {
        const entries = ['hypercanvas.notebook.json', 'storyboard.canvas.json', 'canvas', 'prototypes', 'assets', 'sites']
        for (const entry of entries) {
          if (!fs.existsSync(path.join(source, entry))) throw new Error(`Demo Notebook template is missing ${entry}`)
        }
        const parent = path.dirname(destination)
        fs.mkdirSync(parent, { recursive: true })
        const staging = path.join(parent, `.demo-${process.pid}-staging`)
        fs.rmSync(staging, { recursive: true, force: true })
        fs.mkdirSync(staging)
        try {
          for (const entry of entries) copyTree(path.join(source, entry), path.join(staging, entry))
          fs.renameSync(staging, destination)
        } catch (error) {
          fs.rmSync(staging, { recursive: true, force: true })
          throw error
        }
      }

      fs.mkdirSync(configDir, { recursive: true })
      const temporary = `${settingsPath}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify({ ...settings, demoNotebookProvisioned: true }, null, 2)}\n`)
      fs.renameSync(temporary, settingsPath)
      return destination
    },
  },
  {
    id: 'demo-notebook-modules',
    // Runs on every startup so notebooks provisioned by an older build keep
    // working: prototype-owned CSS (`@import "tailwindcss"`) must resolve from
    // the Notebook folder, which has no node_modules of its own.
    policy: 'every-startup',
    provision({ profile, home }) {
      const suffix = profile === 'development' ? '-dev' : ''
      const destination = path.join(home, 'Documents', `hypercanvas${suffix}`, 'demo')
      if (!fs.existsSync(path.join(destination, 'hypercanvas.notebook.json'))) return destination

      // Resolve packages the way Node would from this module — handles
      // hoisted workspace installs (dev) and the packaged bundle layout
      // (node_modules lives next to the compiled package) alike.
      let appNodeModules
      try {
        const pkgJson = createRequire(import.meta.url).resolve('tailwindcss/package.json')
        appNodeModules = path.dirname(path.dirname(pkgJson))
      } catch {
        appNodeModules = path.join(PACKAGE_ROOT, 'node_modules')
      }
      for (const name of ['tailwindcss']) {
        const packageRoot = path.join(appNodeModules, name)
        if (!fs.existsSync(packageRoot)) continue
        const modulesDir = path.join(destination, 'node_modules')
        fs.mkdirSync(modulesDir, { recursive: true })
        const link = path.join(modulesDir, name)
        const target = fs.realpathSync(packageRoot)
        try {
          const existing = fs.readlinkSync(link)
          if (existing === target) continue
        } catch { /* not a symlink yet — create or replace below */ }
        try { fs.rmSync(link, { force: true, recursive: true }) } catch { /* ignore */ }
        try { fs.symlinkSync(target, link, 'dir') } catch { /* best-effort */ }
      }
      return destination
    },
  },
]

export function runStartupScaffolds({ profile = 'development', home = os.homedir(), source = process.env.HYPERCANVAS_DEMO_NOTEBOOK_TEMPLATE || path.resolve(PACKAGE_ROOT, '../../fixtures/notebooks/demo-notebook') } = {}) {
  if (!['development', 'production'].includes(profile)) throw new Error(`Unknown scaffold profile: ${profile}`)
  if (!fs.existsSync(source) && !process.env.HYPERCANVAS_DEMO_NOTEBOOK_TEMPLATE) return {}
  const results = {}
  for (const operation of operations) results[operation.id] = operation.provision({ profile, home, source })
  return results
}

export function defaultDemoNotebookPath(profile = 'development', home = os.homedir()) {
  const suffix = profile === 'development' ? '-dev' : ''
  return path.join(home, 'Documents', `hypercanvas${suffix}`, 'demo')
}

/** Prefer an explicitly configured Notebook, then the last available selection. */
export function resolveStartupNotebook({
  profile = 'development',
  home = os.homedir(),
  activeNotebook = process.env.HYPERCANVAS_NOTEBOOK_ROOT,
  stateDirectory = null,
  fallback = defaultDemoNotebookPath(profile, home),
} = {}) {
  if (activeNotebook && fs.existsSync(path.join(activeNotebook, 'hypercanvas.notebook.json'))) {
    return path.resolve(activeNotebook)
  }

  const runtime = createNotebookRuntime({
    stateDirectory: resolveNotebookStateDirectory({ profile, home, stateDirectory }),
  })
  return runtime.recent().find(entry => entry.available)?.root || fallback
}
