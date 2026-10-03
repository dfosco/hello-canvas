import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { initializeNotebook } from '../notebook/notebook.js'
import { createFilesystemGrants } from './filesystem-grants.js'
import { createSystemRoutes } from './routes.js'

function response() {
  return { writeHead: vi.fn(), end: vi.fn() }
}

async function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-system-routes-'))
  try {
    await callback(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function body(res) {
  return JSON.parse(res.end.mock.calls[0][0])
}

describe('Core system integration routes', () => {
  it('returns Core-selected directories with a purpose-scoped browser grant', async () => {
    await withTempDirectory(async directory => {
      const selected = path.join(directory, 'Site')
      fs.mkdirSync(selected)
      const grants = createFilesystemGrants()
      const browser = { headers: { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'sec-fetch-site': 'same-origin' } }
      grants.registerBrowserOrigin(browser.headers.origin)
      const selectDirectory = vi.fn(async ({ purpose }) => {
        expect(purpose).toBe('site')
        return selected
      })
      const handler = createSystemRoutes({ selectDirectory, filesystemGrants: grants })
      const res = response()

      await handler(browser, res, { method: 'POST', path: '/select-directory', body: { purpose: 'site' } })

      expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
      expect(body(res)).toEqual({ path: fs.realpathSync.native(selected), cancelled: false })
      expect(grants.resolveDirectory(browser, selected, { purpose: 'site' })).toBe(fs.realpathSync.native(selected))
      expect(() => grants.resolveDirectory(browser, selected, { purpose: 'site' })).toThrow(/Choose this directory through Core/)
    })
  })

  it('represents a cancelled native picker without inventing a path', async () => {
    const handler = createSystemRoutes({ selectFile: async () => null })
    const res = response()
    await handler({}, res, { method: 'POST', path: 'select-file' })
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ path: null, cancelled: true })
  })

  it('rejects directory picker grants requested from an unregistered browser origin', async () => {
    await withTempDirectory(async directory => {
      const selected = path.join(directory, 'Selected')
      fs.mkdirSync(selected)
      const handler = createSystemRoutes({
        selectDirectory: async () => selected,
        filesystemGrants: createFilesystemGrants(),
      })
      const req = { headers: { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4318', 'sec-fetch-site': 'same-site' } }
      const res = response()

      await handler(req, res, { method: 'POST', path: '/select-directory', body: { purpose: 'site' } })

      expect(res.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'application/json' })
      expect(body(res).error.code).toBe('FILESYSTEM_ORIGIN_NOT_ALLOWED')
    })
  })

  it('copies a selected file into Notebook assets and emits a relative-path event', async () => {
    await withTempDirectory(async (directory) => {
      const notebookRoot = path.join(directory, 'Notebook')
      const sourceDirectory = path.join(directory, 'selected')
      const source = path.join(sourceDirectory, 'reference.pdf')
      fs.mkdirSync(sourceDirectory)
      fs.writeFileSync(source, 'selected content')
      initializeNotebook(notebookRoot)
      const eventSender = vi.fn()
      const handler = createSystemRoutes({
        selectFile: async () => source,
        getNotebookRoot: () => notebookRoot,
        eventSender,
      })

      for (const filename of ['reference.pdf', 'reference--1.pdf']) {
        const res = response()
        await handler({}, res, { method: 'POST', path: '/import-file' })
        expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' })
        expect(body(res)).toEqual({ path: `assets/files/${filename}`, cancelled: false })
        expect(fs.readFileSync(path.join(notebookRoot, 'assets', 'files', filename), 'utf8')).toBe('selected content')
      }

      expect(fs.readFileSync(source, 'utf8')).toBe('selected content')
      expect(eventSender).toHaveBeenCalledWith({
        type: 'custom',
        event: 'storyboard:file-changed',
        data: { path: 'assets/files/reference--1.pdf' },
      })
      expect(eventSender).toHaveBeenCalledTimes(2)
    })
  })

  it('does not write when the picker is cancelled or no Notebook is active', async () => {
    const cancelled = createSystemRoutes({ selectFile: async () => null, getNotebookRoot: () => null })
    const cancelledResponse = response()
    await cancelled({}, cancelledResponse, { method: 'POST', path: '/import-file' })
    expect(body(cancelledResponse)).toEqual({ path: null, cancelled: true })

    await withTempDirectory(async (directory) => {
      const source = path.join(directory, 'source.txt')
      fs.writeFileSync(source, 'source')
      const handler = createSystemRoutes({ selectFile: async () => source, getNotebookRoot: () => null })
      const res = response()
      await handler({}, res, { method: 'POST', path: '/import-file' })
      expect(res.writeHead).toHaveBeenCalledWith(409, { 'Content-Type': 'application/json' })
      expect(body(res).error.code).toBe('NO_ACTIVE_NOTEBOOK')
    })
  })

  it('rejects an import whose Notebook assets directory escapes through a symlink', async () => {
    await withTempDirectory(async (directory) => {
      const notebookRoot = path.join(directory, 'Notebook')
      const outside = path.join(directory, 'outside')
      const source = path.join(directory, 'selected.txt')
      fs.mkdirSync(outside)
      fs.writeFileSync(source, 'source')
      initializeNotebook(notebookRoot)
      fs.symlinkSync(outside, path.join(notebookRoot, 'assets', 'files'), 'dir')
      const handler = createSystemRoutes({ selectFile: async () => source, getNotebookRoot: () => notebookRoot })
      const res = response()

      await handler({}, res, { method: 'POST', path: '/import-file' })
      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' })
      expect(body(res).error.code).toBe('UNSAFE_NOTEBOOK_PATH')
      expect(fs.readdirSync(outside)).toEqual([])
    })
  })

  it('rejects non-file and oversized selections', async () => {
    await withTempDirectory(async (directory) => {
      const notebookRoot = path.join(directory, 'Notebook')
      const selectedDirectory = path.join(directory, 'folder')
      const largeFile = path.join(directory, 'large.bin')
      fs.mkdirSync(selectedDirectory)
      fs.writeFileSync(largeFile, '')
      fs.truncateSync(largeFile, 50 * 1024 * 1024 + 1)
      initializeNotebook(notebookRoot)

      const invalidHandler = createSystemRoutes({ selectFile: async () => selectedDirectory, getNotebookRoot: () => notebookRoot })
      const invalidResponse = response()
      await invalidHandler({}, invalidResponse, { method: 'POST', path: '/import-file' })
      expect(invalidResponse.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' })
      expect(body(invalidResponse).error.code).toBe('INVALID_SELECTION')

      const largeHandler = createSystemRoutes({ selectFile: async () => largeFile, getNotebookRoot: () => notebookRoot })
      const largeResponse = response()
      await largeHandler({}, largeResponse, { method: 'POST', path: '/import-file' })
      expect(largeResponse.writeHead).toHaveBeenCalledWith(413, { 'Content-Type': 'application/json' })
      expect(body(largeResponse).error.code).toBe('FILE_TOO_LARGE')
      expect(fs.existsSync(path.join(notebookRoot, 'assets', 'files', 'large.bin'))).toBe(false)
    })
  })

  it('rejects route and method mismatches', async () => {
    const handler = createSystemRoutes()
    const res = response()
    await handler({}, res, { method: 'GET', path: '/select-directory' })
    expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' })
  })
})
