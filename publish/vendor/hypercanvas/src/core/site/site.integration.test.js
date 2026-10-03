import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPublishedSiteManifest, renderPublishedSiteFrame } from './published.js'
import { SiteStore } from './site.js'
import { SiteRuntime } from './runtime.js'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Site local-to-published integration', () => {
  it('starts a local Site and publishes its immutable reference without localhost', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-site-'))
    roots.push(root)
    const siteRoot = path.join(root, 'docs-site')
    fs.mkdirSync(siteRoot, { recursive: true })
    const notebookRoot = path.join(root, 'notebook')
    fs.mkdirSync(notebookRoot, { recursive: true })
    const store = new SiteStore(notebookRoot)
    store.upsert({ id: 'docs', title: 'Docs', deployments: { production: { baseUrl: 'https://docs.example' } } })
    store.upsertBinding('docs', { source: 'managed', workspaceId: 'workspace-site', root: siteRoot, startCommand: 'npm run dev', developmentBaseUrl: 'http://127.0.0.1:4311/' })
    const pty = {
      create: vi.fn().mockResolvedValue({ terminalId: 'terminal-docs' }),
      terminate: vi.fn().mockResolvedValue({ terminated: true }),
    }
    const runtime = new SiteRuntime(store, { ptyRuntime: pty, requirePtyRuntime: true, probe: vi.fn().mockResolvedValue({ reachable: true }) })

    await runtime.start('docs', { confirmed: true })
    expect(runtime.status('docs')).toMatchObject({ running: true, developmentBaseUrl: 'http://127.0.0.1:4311/' })
    expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'site:docs',
      workspaceId: 'workspace-site',
      cwd: fs.realpathSync.native(siteRoot),
    }))

    const [published] = buildPublishedSiteManifest([{ siteId: 'docs', route: 'guide', title: 'Docs' }], {
      productionBaseUrl: 'https://docs.example',
      snapshotUrl: '/captures/docs.png',
    })
    expect(published).toMatchObject({ siteId: 'docs', route: 'guide', openUrl: 'https://docs.example/docs/guide', mode: 'snapshot' })
    expect(renderPublishedSiteFrame(published)).not.toContain('127.0.0.1')
    await runtime.close()
    expect(pty.terminate).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'site:docs',
      workspaceId: 'workspace-site',
    }))
  })
})
