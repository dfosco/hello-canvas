import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserAgentSessionUrl,
  importCoreFile,
  PENDING_NOTEBOOK_REDIRECT_KEY,
  resumePendingNotebookRedirect,
  selectNotebookDirectory,
} from './browserBridge.js'

afterEach(() => {
  delete globalThis.__TAURI_INTERNALS__
  delete globalThis.__STORYBOARD_PICK_NOTEBOOK_FOLDER__
  delete window.__STORYBOARD_BASE_PATH__
  vi.unstubAllGlobals()
})

function mockCoreResponse(body) {
  return { ok: true, json: async () => body }
}

describe('browser Core picker bridge', () => {
  it('routes Notebook folder selection to Core under a branch-prefixed base path', async () => {
    window.__STORYBOARD_BASE_PATH__ = '/branch--browser-core/'
    const fetch = vi.fn().mockResolvedValue(mockCoreResponse({ path: '/Users/test/Notebook', cancelled: false }))
    vi.stubGlobal('fetch', fetch)

    await expect(selectNotebookDirectory()).resolves.toBe('/Users/test/Notebook')
    expect(fetch).toHaveBeenCalledWith('/branch--browser-core/_storyboard/system/select-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: 'notebook' }),
    })
  })

  it('requests file import from Core and returns only its Notebook-relative result', async () => {
    const result = { path: 'assets/files/reference.pdf', cancelled: false }
    const fetch = vi.fn().mockResolvedValue(mockCoreResponse(result))
    vi.stubGlobal('fetch', fetch)

    await expect(importCoreFile()).resolves.toEqual(result)
    expect(fetch).toHaveBeenCalledWith('/_storyboard/system/import-file', { method: 'POST' })
  })

  it('builds agent URLs beneath the active branch base', () => {
    window.__STORYBOARD_BASE_PATH__ = '/branch--feature/'

    expect(browserAgentSessionUrl({ agentId: 'agent-123', widgetId: 'chat-widget', canvasId: 'demo' }))
      .toBe('/branch--feature/workspace?panel=agent&agentId=agent-123&widgetId=chat-widget&canvasId=demo')
    expect(browserAgentSessionUrl({ agentId: '' })).toBeNull()
  })

  it('resumes a same-origin branch workspace redirect until the destination document loads', () => {
    const values = new Map([[PENDING_NOTEBOOK_REDIRECT_KEY, JSON.stringify({
      url: '/branch--feature/workspace',
      expiresAt: 2000,
    })]])
    const storage = {
      getItem: key => values.get(key) || null,
      removeItem: key => values.delete(key),
    }
    const location = {
      href: 'http://localhost/branch--feature/',
      origin: 'http://localhost',
      pathname: '/branch--feature/',
      search: '',
      hash: '',
    }
    const navigate = vi.fn()

    expect(resumePendingNotebookRedirect({ storage, location, navigate, now: 1000 })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/branch--feature/workspace')
    expect(storage.getItem(PENDING_NOTEBOOK_REDIRECT_KEY)).not.toBeNull()

    expect(resumePendingNotebookRedirect({
      storage,
      location: { ...location, pathname: '/branch--feature/workspace' },
      navigate,
      now: 1500,
    })).toBe(false)
    expect(storage.getItem(PENDING_NOTEBOOK_REDIRECT_KEY)).toBeNull()
  })

  it('discards expired and cross-origin pending redirects', () => {
    const values = new Map([[PENDING_NOTEBOOK_REDIRECT_KEY, JSON.stringify({
      url: 'https://attacker.example/workspace',
      expiresAt: 2000,
    })]])
    const storage = {
      getItem: key => values.get(key) || null,
      removeItem: key => values.delete(key),
    }
    const location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '' }
    const navigate = vi.fn()

    expect(resumePendingNotebookRedirect({ storage, location, navigate, now: 1000 })).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(storage.getItem(PENDING_NOTEBOOK_REDIRECT_KEY)).toBeNull()

    values.set(PENDING_NOTEBOOK_REDIRECT_KEY, JSON.stringify({ url: '/workspace', expiresAt: 1000 }))
    expect(resumePendingNotebookRedirect({ storage, location, navigate, now: 1000 })).toBe(false)
    expect(storage.getItem(PENDING_NOTEBOOK_REDIRECT_KEY)).toBeNull()
  })
})
