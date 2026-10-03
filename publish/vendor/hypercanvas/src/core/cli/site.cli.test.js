// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { SiteStore } from '../site/site.js'

const roots = []
const cliPath = fileURLToPath(new URL('./index.js', import.meta.url))

function notebookRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-site-cli-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'hypercanvas.notebook.json'), JSON.stringify({ id: 'site-cli-test', title: 'Site CLI test' }))
  return root
}

function runSiteCli(root, args) {
  const result = spawnSync(process.execPath, [cliPath, 'site', ...args, '--notebook', root, '--json'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `Site CLI exited with ${result.status}`)
  return JSON.parse(result.stdout)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Site CLI CRUD', () => {
  it('rejects the removed Notebook-copy Site option', () => {
    const root = notebookRoot()
    const result = spawnSync(process.execPath, [
      cliPath, 'site', 'create', '--notebook-path', 'assets/sites/app', '--title', 'App', '--notebook', root,
    ], { encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--notebook-path is no longer supported')
  })

  it('creates, edits, lists, and removes a Site with all authoring fields', () => {
    const root = notebookRoot()
    const created = runSiteCli(root, [
      'add', 'docs', '--title', 'Docs', '--description', 'Product documentation',
      '--development-base-url', 'http://localhost:4317/docs', '--production-base-url', 'https://docs.example.com/guide',
    ])
    expect(created).toMatchObject({
      site: {
        id: 'docs',
        title: 'Docs',
        description: 'Product documentation',
        deployments: { production: { baseUrl: 'https://docs.example.com/guide/' } },
      },
      binding: { source: 'url', developmentBaseUrl: 'http://localhost:4317/docs/' },
    })

    const updated = runSiteCli(root, [
      'metadata', 'docs', '--title', 'API Docs', '--description', 'Updated docs',
      '--development-base-url', 'http://127.0.0.1:4318/docs', '--start-command', 'npm run preview',
      '--production-base-url', 'https://docs.example.com/v2',
    ])
    expect(updated).toMatchObject({
      site: {
        title: 'API Docs',
        description: 'Updated docs',
        deployments: { production: { baseUrl: 'https://docs.example.com/v2/' } },
      },
      binding: { developmentBaseUrl: 'http://127.0.0.1:4318/docs/', startCommand: 'npm run preview' },
    })

    expect(runSiteCli(root, ['list']).sites).toMatchObject([{ binding: { status: 'running', running: true } }])
    expect(runSiteCli(root, ['status', 'docs'])).toMatchObject({ status: 'running', running: true })
    expect(runSiteCli(root, ['remove', 'docs', '--confirmed'])).toMatchObject({ success: true, deleted: 'docs', files: ['.storyboard/sites.config.json'] })
    expect(new SiteStore(root).get('docs')).toBeNull()
  })
})
