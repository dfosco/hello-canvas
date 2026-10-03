// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAgentsConfig } from './configReader.js'

const roots = []

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-config-reader-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true })
})

describe('Notebook terminal config fallback', () => {
  it('reads required agent config from app source when the Notebook copy is missing', () => {
    const appRoot = tempRoot()
    const notebookRoot = tempRoot()
    fs.writeFileSync(path.join(appRoot, 'terminal.config.json'), JSON.stringify({
      agents: { opencode: { startupCommand: 'opencode' } },
    }))

    expect(readAgentsConfig(notebookRoot, appRoot).opencode.startupCommand).toBe('opencode')
  })

  it('lets Notebook config override app-source defaults', () => {
    const appRoot = tempRoot()
    const notebookRoot = tempRoot()
    fs.writeFileSync(path.join(appRoot, 'terminal.config.json'), JSON.stringify({
      agents: { codex: { startupCommand: 'codex', readinessSignal: 'ready' } },
    }))
    fs.writeFileSync(path.join(notebookRoot, 'terminal.config.json'), JSON.stringify({
      agents: { codex: { readinessSignal: 'notebook-ready' } },
    }))

    expect(readAgentsConfig(notebookRoot, appRoot).codex).toEqual({
      startupCommand: 'codex',
      readinessSignal: 'notebook-ready',
    })
  })
})
