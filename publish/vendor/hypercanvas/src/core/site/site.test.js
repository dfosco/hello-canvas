import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SiteStore, detectSiteConfiguration, normalizeSiteDescriptor, normalizeSiteRoute, parseSiteUrl, resolveSiteUrl, resolveSiteDevelopmentUrl, sitePreviewPath, siteRouteFromPreviewUrl, siteRouteForUrl } from './site.js'

function siteProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-project-'))
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  return root
}

describe('Site contract', () => {
  it('stores Site descriptors and local bindings together in one Notebook config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-'))
    const store = new SiteStore(root)
    store.upsert({ id: 'billing-app', title: 'Billing', deployments: { production: { baseUrl: 'https://billing.example' } } })
    store.upsertBinding('billing-app', { source: 'managed', workspaceId: 'workspace-site', root: '/tmp/billing', startCommand: 'npm run dev', terminalSessionId: 'site:billing-app', developmentBaseUrl: 'http://localhost:4311/app' })
    expect(store.get('billing-app')).toMatchObject({ id: 'billing-app', defaultDeployment: 'production' })
    expect(store.getBinding('billing-app')).toMatchObject({ developmentBaseUrl: 'http://localhost:4311/app/', terminalSessionId: 'site:billing-app', revision: 1 })
    expect(fs.existsSync(path.join(root, 'sites/billing-app.site.json'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.storyboard/sites.json'))).toBe(false)
    const config = JSON.parse(fs.readFileSync(path.join(root, '.storyboard/sites.config.json'), 'utf8'))
    expect(config.sites['billing-app']).toMatchObject({ id: 'billing-app', title: 'Billing', binding: { terminalSessionId: 'site:billing-app' } })
    expect(config.sites['billing-app'].binding).not.toHaveProperty('status')
    expect(config.sites['billing-app'].binding).not.toHaveProperty('pid')
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('.storyboard/')
  })

  it('adds the runtime ignore without overwriting existing Notebook ignore rules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-ignore-'))
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')

    new SiteStore(root).upsert({ id: 'docs', title: 'Docs' })

    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n.storyboard/\n')
  })

  it('migrates split legacy Site files into sites.config.json and preserves cleanup identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-migration-'))
    const siteRoot = path.join(root, 'project')
    fs.mkdirSync(siteRoot)
    fs.mkdirSync(path.join(root, 'sites'))
    fs.mkdirSync(path.join(root, '.storyboard'))
    fs.writeFileSync(path.join(root, 'sites/docs.site.json'), JSON.stringify({ id: 'docs', title: 'Docs' }))
    fs.writeFileSync(path.join(root, '.storyboard/sites.json'), JSON.stringify({
      formatVersion: 1,
      sites: { docs: { source: 'managed', workspaceId: 'workspace-docs', root: siteRoot, startCommand: 'npm run dev', status: 'running', pid: 4312 } },
    }))
    const store = new SiteStore(root)

    store.migrateLegacy()

    expect(store.get('docs')).toMatchObject({ id: 'docs', title: 'Docs' })
    expect(store.getBinding('docs')).toMatchObject({
      workspaceId: 'workspace-docs',
      terminalSessionId: 'site:docs',
      legacyPid: 4312,
      status: 'running',
    })
    expect(fs.existsSync(path.join(root, '.storyboard/sites.config.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'sites/docs.site.json'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.storyboard/sites.json'))).toBe(false)
    const config = JSON.parse(fs.readFileSync(path.join(root, '.storyboard/sites.config.json'), 'utf8'))
    expect(config.sites.docs.binding).not.toHaveProperty('status')
    expect(config.sites.docs.binding).not.toHaveProperty('pid')
  })

  it('does not persist Site process status or PID updates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-state-'))
    const store = new SiteStore(root)
    store.upsert({ id: 'docs', title: 'Docs' })
    store.upsertBinding('docs', { source: 'managed', workspaceId: 'workspace-docs', root: '/tmp/docs', startCommand: 'npm run dev' })
    const revision = store.getBinding('docs').revision

    store.upsertBinding('docs', { status: 'running', pid: 987 })

    expect(store.getBinding('docs')).toMatchObject({ status: 'stopped', pid: null, revision })
    const config = JSON.parse(fs.readFileSync(path.join(root, '.storyboard/sites.config.json'), 'utf8'))
    expect(config.sites.docs.binding).not.toHaveProperty('status')
    expect(config.sites.docs.binding).not.toHaveProperty('pid')
  })

  it('keeps Site runtime state inside the canonical Notebook and rejects reserved environment overrides', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-state-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-state-outside-'))
    try {
      const store = new SiteStore(root)
      expect(() => store.upsertBinding('billing-app', {
        source: 'managed',
        root: '/tmp/billing',
        env: { HYPERCANVAS_CORE_SESSION_SECRET: 'attempted-secret' },
      })).toThrow(/cannot override reserved Core\/Paseo variables/)

      fs.rmSync(path.join(root, '.storyboard'), { recursive: true, force: true })
      fs.symlinkSync(outside, path.join(root, '.storyboard'), 'dir')
      expect(() => store.upsertBinding('billing-app', { status: 'running' }))
        .toThrow(/outside its filesystem root/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('resolves only relative routes and named deployments', () => {
    const site = normalizeSiteDescriptor({ id: 'docs', deployments: { production: { baseUrl: 'https://example.com/docs' } } })
    expect(resolveSiteUrl(site.deployments.production.baseUrl, site.id, 'guide?mode=full')).toBe('https://example.com/docs/guide?mode=full')
    expect(resolveSiteUrl('https://example.com', site.id, 'guide?mode=full')).toBe('https://example.com/docs/guide?mode=full')
    expect(resolveSiteUrl('https://example.com/branch--feature', site.id, 'guide')).toBe('https://example.com/branch--feature/docs/guide')
    expect(resolveSiteDevelopmentUrl('http://127.0.0.1:8080/', 'guide?mode=full#intro')).toBe('http://127.0.0.1:8080/guide?mode=full#intro')
    expect(resolveSiteDevelopmentUrl('http://localhost:4321/app/', 'guide')).toBe('http://localhost:4321/app/guide')
    expect(() => normalizeSiteRoute('https://evil.example')).toThrow()
  })

  it('matches Site IDs on exact path boundaries and extracts the actual route', () => {
    expect(siteRouteForUrl('http://localhost:5173/docs/guide?mode=full#intro', 'http://localhost:5173/', 'docs'))
      .toBe('guide?mode=full#intro')
    expect(siteRouteForUrl('http://localhost:5173/?from=copy#top', 'http://localhost:5173/', 'docs'))
      .toBe('?from=copy#top')
    expect(siteRouteForUrl('http://127.0.0.1:5173/docs/guide', 'http://localhost:5173/', 'docs')).toBe('guide')
    expect(siteRouteForUrl('http://localhost:5173/docs-old/guide', 'http://localhost:5173/', 'docs')).toBeNull()
    expect(siteRouteForUrl('http://localhost:5173/project/', 'http://localhost:5173/project/', 'docs')).toBe('')
    expect(siteRouteForUrl('http://localhost:5173/branch--feature/?from=copy', 'http://localhost:5173/branch--feature/', 'docs', { basePath: '/branch--feature' }))
      .toBe('?from=copy')
    expect(siteRouteForUrl('http://localhost:5173/branch--feature/docs/guide', 'http://localhost:5173/branch--feature/', 'docs', { basePath: '/branch--feature' }))
      .toBe('guide')
    expect(siteRouteForUrl('http://localhost:4321/docs/guide', 'http://localhost:4321/', 'docs', { siteIdInUrl: false }))
      .toBe('docs/guide')
  })

  it('builds and resolves Site preview paths with branch prefixes and route state', () => {
    expect(sitePreviewPath('/', 'filesystem-design', 'explore?mode=full#intro'))
      .toBe('/_storyboard/site/filesystem-design/preview/explore?mode=full#intro')
    expect(sitePreviewPath('/branch--feature/', 'filesystem-design', 'explore'))
      .toBe('/branch--feature/_storyboard/site/filesystem-design/preview/explore')
    expect(siteRouteFromPreviewUrl('http://127.0.0.1:61482/branch--feature/_storyboard/site/filesystem-design/preview/explore?mode=full#intro', 'filesystem-design', {
      basePath: '/branch--feature/', origin: 'http://127.0.0.1:61482',
    })).toBe('explore?mode=full#intro')
    expect(siteRouteFromPreviewUrl('http://127.0.0.1:61482/explore?mode=full#intro', 'filesystem-design', {
      origin: 'http://127.0.0.1:61482',
    })).toBe('explore?mode=full#intro')
    expect(siteRouteFromPreviewUrl('http://127.0.0.1:61483/explore', 'filesystem-design', {
      origin: 'http://127.0.0.1:61482',
    })).toBeNull()
  })

  it('extracts an unmatched Site ID and route while preserving a branch deployment prefix', () => {
    expect(parseSiteUrl('http://localhost:5173/branch--feature/docs/guide?mode=full#intro', { basePath: '/branch--feature' })).toEqual({
      origin: 'http://localhost:5173',
      baseUrl: 'http://localhost:5173/branch--feature/',
      siteId: 'docs',
      route: 'guide?mode=full#intro',
    })
    expect(parseSiteUrl('http://localhost:4321/docs/guide', { siteIdInUrl: false })).toMatchObject({
      siteId: 'docs', baseUrl: 'http://localhost:4321/', route: 'docs/guide',
    })
  })

  it('returns confirmation-ready configuration findings without executing commands', () => {
    const root = siteProject({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^7' } }) })
    const result = detectSiteConfiguration(root)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'npm run dev' }),
      expect.objectContaining({ kind: 'framework', value: 'Vite' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:5173/' }),
    ]))
  })

  it('prefers the declared package manager and explicit dev-script port', () => {
    const root = siteProject({
      'package.json': JSON.stringify({ packageManager: 'pnpm@9.0.0', scripts: { dev: 'vite --host 0.0.0.0 --port 4317' }, devDependencies: { vite: '^7' } }),
    })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'pnpm run dev' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:4317/' }),
    ]))
  })

  it('builds a framework command when a Node project has no start script', () => {
    const root = siteProject({ 'package.json': JSON.stringify({ packageManager: 'yarn@1.22.0', dependencies: { next: '^15' } }) })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'yarn next dev --hostname 127.0.0.1' }),
      expect.objectContaining({ kind: 'framework', value: 'Next.js' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:3000/' }),
    ]))
  })

  it('uses the framework config port when the command does not declare one', () => {
    const root = siteProject({
      'package.json': JSON.stringify({ scripts: { dev: 'vite --host 127.0.0.1' }, devDependencies: { vite: '^7' } }),
      'vite.config.ts': 'export default { server: { port: 4512 } }',
    })

    expect(detectSiteConfiguration(root).findings).toContainEqual(expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:4512/' }))
  })

  it('detects Django projects from manage.py without running them', () => {
    const root = siteProject({ 'manage.py': 'from django.core.management import execute_from_command_line\n' })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'python3 manage.py runserver 127.0.0.1:8000' }),
      expect.objectContaining({ kind: 'framework', value: 'Django' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:8000/' }),
    ]))
  })

  it('detects FastAPI from Python project metadata and its app module', () => {
    const root = siteProject({
      'pyproject.toml': '[project]\ndependencies = ["fastapi", "uvicorn"]\n',
      'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'python3 -m uvicorn main:app --host 127.0.0.1 --port 8000' }),
      expect.objectContaining({ kind: 'framework', value: 'FastAPI' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:8000/' }),
    ]))
  })

  it('detects Flask and reads its configured port', () => {
    const root = siteProject({
      'requirements.txt': 'flask==3.0.0\n',
      'app.py': 'from flask import Flask\napp = Flask(__name__)\napp.run(port=5055)\n',
    })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'python3 -m flask --app app run --host 127.0.0.1 --port 5055' }),
      expect.objectContaining({ kind: 'framework', value: 'Flask' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:5055/' }),
    ]))
  })

  it('detects a Rust web framework and port from Cargo metadata and source', () => {
    const root = siteProject({
      'Cargo.toml': '[package]\nname = "site"\n[dependencies]\naxum = "0.8"\n',
      'src/main.rs': 'let listener = TcpListener::bind("0.0.0.0:4319").await?;\n',
    })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'cargo run' }),
      expect.objectContaining({ kind: 'framework', value: 'Axum' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:4319/' }),
    ]))
  })

  it('provides a deterministic local server for a static HTML directory', () => {
    const root = siteProject({ 'index.html': '<h1>Docs</h1>' })

    expect(detectSiteConfiguration(root).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start-command', value: 'python3 -m http.server 8000 --bind 127.0.0.1' }),
      expect.objectContaining({ kind: 'framework', value: 'Static HTML' }),
      expect.objectContaining({ kind: 'local-url', value: 'http://127.0.0.1:8000/' }),
    ]))
  })
})
