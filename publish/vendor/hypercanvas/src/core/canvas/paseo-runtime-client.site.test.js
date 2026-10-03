import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ensurePaseoWorkspaceForRoot } from './paseo-runtime-client.js'

const temporary = []
afterEach(() => temporary.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })))

it('opens selected Notebook directories idempotently and never creates a duplicate workspace', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'hypercanvas-site-workspace-'))
  temporary.push(parent)
  const directory = path.join(parent, 'Selected Notebook')
  const secondDirectory = path.join(parent, 'Other Notebook')
  fs.mkdirSync(directory)
  fs.mkdirSync(secondDirectory)
  const identities = new Map()
  const open = vi.fn(async ({ cwd }) => {
    if (!identities.has(cwd)) identities.set(cwd, `workspace-${identities.size + 1}`)
    return { id: identities.get(cwd), workspaceDirectory: cwd }
  })
  const create = vi.fn()
  const client = { workspaces: { open, create } }

  const existingId = await ensurePaseoWorkspaceForRoot(client, directory)
  expect(await ensurePaseoWorkspaceForRoot(client, directory)).toBe(existingId)
  const secondId = await ensurePaseoWorkspaceForRoot(client, secondDirectory)

  expect(existingId).toBe('workspace-1')
  expect(secondId).toBe('workspace-2')
  expect(open).toHaveBeenCalledTimes(3)
  expect(open).toHaveBeenNthCalledWith(1, { cwd: fs.realpathSync.native(directory) })
  expect(open).toHaveBeenNthCalledWith(3, { cwd: fs.realpathSync.native(secondDirectory) })
  expect(create).not.toHaveBeenCalled()
})
