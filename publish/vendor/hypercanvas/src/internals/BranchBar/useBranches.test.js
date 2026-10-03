import { renderHook, waitFor } from '@testing-library/react'
import { useBranches } from './useBranches.js'

describe('useBranches', () => {
  afterEach(() => {
    delete window.__SB_BRANCHES__
    vi.unstubAllGlobals()
  })

  it('loads branches from branches.json when worktrees API is unavailable on branch deploys', async () => {
    const branchesFromManifest = [
      { folder: 'branch--4.3.0-prompt-widget', branch: '4.3.0-prompt-widget' },
      { folder: 'branch--main', branch: 'main' },
    ]

    const fetchMock = vi.fn((url) => {
      if (url === '/storyboard/branch--4.3.0-prompt-widget/_storyboard/git-user') {
        return Promise.resolve({ ok: false, json: async () => null })
      }
      if (url === '/storyboard/branch--4.3.0-prompt-widget/_storyboard/worktrees') {
        return Promise.resolve({ ok: false, json: async () => null })
      }
      if (url === '/storyboard/branches.json') {
        return Promise.resolve({ ok: true, json: async () => branchesFromManifest })
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useBranches('/storyboard/branch--4.3.0-prompt-widget/'))

    await waitFor(() => {
      expect(result.current.branches).toEqual(branchesFromManifest)
    })

    expect(fetchMock).toHaveBeenCalledWith('/storyboard/branches.json')
  })

  it('resolves branches.json from repo root when basePath has no trailing slash', async () => {
    const branchesFromManifest = [
      { folder: 'branch--4.3.0-prompt-widget', branch: '4.3.0-prompt-widget' },
    ]

    const fetchMock = vi.fn((url) => {
      if (url === '/storyboard/branch--4.3.0-prompt-widget/_storyboard/git-user') {
        return Promise.resolve({ ok: false, json: async () => null })
      }
      if (url === '/storyboard/branch--4.3.0-prompt-widget/_storyboard/worktrees') {
        return Promise.resolve({ ok: false, json: async () => null })
      }
      if (url === '/storyboard/branches.json') {
        return Promise.resolve({ ok: true, json: async () => branchesFromManifest })
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useBranches('/storyboard/branch--4.3.0-prompt-widget'))

    await waitFor(() => {
      expect(result.current.branches).toEqual(branchesFromManifest)
    })

    expect(fetchMock).toHaveBeenCalledWith('/storyboard/branches.json')
  })
})
