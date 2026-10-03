import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getFileEntry,
  subscribe,
  loadFile,
  updateContent,
  saveFile,
  refetchFile,
  pollFile,
  fileExists,
  renameFile,
  _resetStoreForTests,
} from '../fileContentStore.js'

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeReadResponse(content, { status = 200, mtime = 1000, size } = {}) {
  const body = { path: 'test', content, mtime, size: size ?? content.length }
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

function make404() {
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve('') })
}

function makeWriteResponse(path, content, { mtime = 2000 } = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, path, size: content.length, mtime }),
    text: () => Promise.resolve(''),
  })
}

function makeErrorResponse(status = 500, body = 'Internal Server Error') {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Flush all microtasks (settled promises). */
function flush() {
  return new Promise((r) => setTimeout(r, 0))
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let helpers

beforeEach(() => {
  helpers = _resetStoreForTests()
  mockFetch.mockReset()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getFileEntry', () => {
  it('returns default entry for unknown path without side effects', () => {
    const entry = getFileEntry('src/unknown.js')
    expect(entry).toMatchObject({
      content: '',
      exists: undefined,
      loading: false,
      dirty: false,
      error: null,
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('subscribe', () => {
  it('callback gets loading state then loaded state', async () => {
    const path = 'src/hello.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('const x = 1'))

    const cb = vi.fn()
    subscribe(path, cb)

    // First call: loading state (synchronous, before fetch resolves)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatchObject({ loading: true })

    await flush()

    // Second call: loaded state
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb.mock.calls[1][0]).toMatchObject({
      content: 'const x = 1',
      exists: true,
      loading: false,
      dirty: false,
    })
  })

  it('callback gets immediate snapshot for already-loaded path', async () => {
    const path = 'src/loaded.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('loaded'))

    await loadFile(path)

    const cb = vi.fn()
    subscribe(path, cb)

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatchObject({ content: 'loaded', exists: true })
    expect(mockFetch).toHaveBeenCalledTimes(1) // no second fetch
  })

  it('returns an unsubscribe function that stops notifications', async () => {
    const path = 'src/unsub.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('data'))

    const cb = vi.fn()
    const unsub = subscribe(path, cb)
    unsub()

    await flush()

    // Only the initial loading call before unsub; no subsequent calls
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

describe('two subscribers → one fetch', () => {
  it('concurrent subscribers share a single in-flight fetch', async () => {
    const path = 'src/shared.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('shared content'))

    const cb1 = vi.fn()
    const cb2 = vi.fn()

    subscribe(path, cb1)
    subscribe(path, cb2) // should NOT trigger a second fetch

    expect(mockFetch).toHaveBeenCalledTimes(1)

    await flush()

    // Both subscribers receive the loaded content
    const lastCalls = [cb1.mock.calls.at(-1)[0], cb2.mock.calls.at(-1)[0]]
    for (const entry of lastCalls) {
      expect(entry).toMatchObject({ content: 'shared content', exists: true })
    }
  })

  it('direct loadFile calls are de-duplicated', async () => {
    const path = 'src/dedup.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('x'))

    const p1 = loadFile(path)
    const p2 = loadFile(path)

    expect(p1).toBe(p2) // same promise
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await p1
  })
})

describe('updateContent', () => {
  it('notifies all subscribers and marks entry dirty', async () => {
    const path = 'src/edit.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('original'))
    await loadFile(path)

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    subscribe(path, cb1)
    subscribe(path, cb2)

    cb1.mockClear()
    cb2.mockClear()

    updateContent(path, 'edited')

    expect(cb1).toHaveBeenCalledOnce()
    expect(cb2).toHaveBeenCalledOnce()
    expect(cb1.mock.calls[0][0]).toMatchObject({ content: 'edited', dirty: true })
  })

  it('skips notification when content and dirty are unchanged', async () => {
    const path = 'src/noop.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('same'))
    await loadFile(path)
    updateContent(path, 'changed') // dirty = true

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    updateContent(path, 'changed') // same content, same dirty → no-op

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('saveFile', () => {
  it('PUTs content, clears dirty, updates size and mtime on success', async () => {
    const path = 'src/save.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('original'))
    await loadFile(path)
    updateContent(path, 'updated')

    mockFetch.mockReturnValueOnce(makeWriteResponse(path, 'updated', { mtime: 9999 }))

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    const entry = await saveFile(path)

    expect(entry).toMatchObject({ dirty: false, mtime: 9999, content: 'updated' })
    expect(cb).toHaveBeenCalledOnce()

    const [putUrl, putOpts] = mockFetch.mock.calls.at(-1)
    expect(putUrl).toContain('/_storyboard/file/write')
    expect(putOpts.method).toBe('PUT')
    expect(JSON.parse(putOpts.body)).toMatchObject({ path, content: 'updated' })
  })

  it('keeps dirty=true and sets error on server failure', async () => {
    const path = 'src/fail-save.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('data'))
    await loadFile(path)
    updateContent(path, 'edited')

    mockFetch.mockReturnValueOnce(makeErrorResponse(500, 'write error'))

    await expect(saveFile(path)).rejects.toThrow('write error')

    const entry = getFileEntry(path)
    expect(entry.dirty).toBe(true)
    expect(entry.error).toBe('write error')
  })
})

describe('404 / missing file', () => {
  it('sets exists: false and clears content on 404', async () => {
    const path = 'src/missing.js'
    mockFetch.mockReturnValueOnce(make404())

    const entry = await loadFile(path)

    expect(entry).toMatchObject({ exists: false, content: '', loading: false })
  })

  it('notifies subscribers with exists: false', async () => {
    const path = 'src/missing2.js'
    mockFetch.mockReturnValueOnce(make404())

    const cb = vi.fn()
    subscribe(path, cb)
    await flush()

    const lastEntry = cb.mock.calls.at(-1)[0]
    expect(lastEntry.exists).toBe(false)
  })
})

describe('refetchFile', () => {
  it('force re-fetches even if content is already cached', async () => {
    const path = 'src/refetch.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('v1'))
    await loadFile(path)

    mockFetch.mockReturnValueOnce(makeReadResponse('v2'))
    const entry = await refetchFile(path)

    expect(entry.content).toBe('v2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

describe('pollFile', () => {
  it('updates content and notifies subscribers when the file changed', async () => {
    const path = 'src/poll-change.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('v1', { mtime: 1000 }))
    await loadFile(path)

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    mockFetch.mockReturnValueOnce(makeReadResponse('v2', { mtime: 2000 }))
    await pollFile(path)

    expect(cb).toHaveBeenCalledOnce()
    expect(getFileEntry(path)).toMatchObject({ content: 'v2', exists: true })
  })

  it('does NOT notify when the content is unchanged', async () => {
    const path = 'src/poll-same.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('same', { mtime: 1000 }))
    await loadFile(path)

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    // Same content, but a newer mtime — must update metadata silently.
    mockFetch.mockReturnValueOnce(makeReadResponse('same', { mtime: 2000 }))
    await pollFile(path)

    expect(cb).not.toHaveBeenCalled()
    expect(getFileEntry(path).mtime).toBe(2000)
  })

  it('flags hasExternalChange without clobbering unsaved edits', async () => {
    const path = 'src/poll-dirty.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('original'))
    await loadFile(path)
    updateContent(path, 'local edits') // dirty = true

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    mockFetch.mockReturnValueOnce(makeReadResponse('server changed'))
    await pollFile(path)

    const entry = getFileEntry(path)
    expect(entry).toMatchObject({
      content: 'local edits',
      dirty: true,
      hasExternalChange: true,
    })
    expect(cb).toHaveBeenCalledOnce()
  })

  it('marks the file gone on a 404 when not dirty', async () => {
    const path = 'src/poll-deleted.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('here'))
    await loadFile(path)

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    mockFetch.mockReturnValueOnce(make404())
    await pollFile(path)

    expect(getFileEntry(path)).toMatchObject({ exists: false, content: '' })
    expect(cb).toHaveBeenCalledOnce()
  })

  it('swallows transient network errors without notifying', async () => {
    const path = 'src/poll-neterr.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('stable'))
    await loadFile(path)

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    mockFetch.mockRejectedValueOnce(new Error('network down'))
    await pollFile(path)

    expect(cb).not.toHaveBeenCalled()
    expect(getFileEntry(path).content).toBe('stable')
  })
})

describe('external WS event handling', () => {
  it('triggers refetch when entry is not dirty', async () => {
    const path = 'src/ws-clean.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('v1'))
    await loadFile(path)

    mockFetch.mockReturnValueOnce(makeReadResponse('v2'))

    helpers.triggerFileChanged(path)
    await flush()

    expect(getFileEntry(path).content).toBe('v2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('sets hasExternalChange when entry IS dirty and does NOT clobber content', async () => {
    const path = 'src/ws-dirty.js'
    mockFetch.mockReturnValueOnce(makeReadResponse('original'))
    await loadFile(path)

    updateContent(path, 'local edits') // makes dirty=true

    const cb = vi.fn()
    subscribe(path, cb)
    cb.mockClear()

    helpers.triggerFileChanged(path)

    // Refetch must NOT have been called (only the initial fetch)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    expect(cb).toHaveBeenCalledOnce()
    expect(cb.mock.calls[0][0]).toMatchObject({
      hasExternalChange: true,
      dirty: true,
      content: 'local edits',
    })
  })

  it('ignores events for paths not in the cache', () => {
    helpers.triggerFileChanged('src/not-loaded.js')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('renameFile', () => {
  it('calls POST /rename, notifies old path with exists:false/renamedTo, seeds new path', async () => {
    const from = 'src/old.js'
    const to = 'src/new.js'

    mockFetch.mockReturnValueOnce(makeReadResponse('file content'))
    await loadFile(from)

    // subscribe(to, cbTo) will trigger loadFile(to) since `to` is unknown
    mockFetch.mockReturnValueOnce(make404())

    const cbFrom = vi.fn()
    const cbTo = vi.fn()
    subscribe(from, cbFrom)
    subscribe(to, cbTo)
    await flush() // let the to-path 404 load settle
    cbFrom.mockClear()
    cbTo.mockClear()

    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ from, to }),
    }))

    const result = await renameFile(from, to)

    expect(result).toEqual({ from, to })

    // Old path should report gone/renamed
    expect(cbFrom).toHaveBeenCalledOnce()
    expect(cbFrom.mock.calls[0][0]).toMatchObject({ exists: false, renamedTo: to })

    // New path should have the content seeded (or notified if it was subscribed)
    const toEntry = getFileEntry(to)
    expect(toEntry).toMatchObject({ content: 'file content', exists: true })

    // Verify the POST request
    const [renameUrl, renameOpts] = mockFetch.mock.calls.at(-1)
    expect(renameUrl).toContain('/_storyboard/file/rename')
    expect(renameOpts.method).toBe('POST')
    expect(JSON.parse(renameOpts.body)).toEqual({ from, to })
  })

  it('throws on rename failure', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) }))
    await expect(renameFile('a.js', 'b.js')).rejects.toThrow('Rename failed: HTTP 409')
  })
})

describe('fileExists', () => {
  it('returns true when server says exists', async () => {
    mockFetch.mockReturnValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ exists: true }),
    })
    expect(await fileExists('src/real.js')).toBe(true)
  })

  it('returns false when server says not exists', async () => {
    mockFetch.mockReturnValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ exists: false }),
    })
    expect(await fileExists('src/ghost.js')).toBe(false)
  })

  it('returns false on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    expect(await fileExists('src/any.js')).toBe(false)
  })
})
