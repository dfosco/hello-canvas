import { renderHook, waitFor } from '@testing-library/react'
import { useArtifactIndex } from './useArtifactIndex.js'

describe('useArtifactIndex', () => {
  afterEach(() => {
    delete window.__SB_LOCAL_DEV__
    vi.unstubAllGlobals()
  })

  it('short-circuits in local dev without fetching', () => {
    window.__SB_LOCAL_DEV__ = true
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useArtifactIndex('/storyboard/'))

    expect(result.current).toEqual({ artifactIndex: null, loading: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the parsed index after fetching', async () => {
    const index = { schemaVersion: 1, branches: [], prototypes: {}, canvases: {} }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => index }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useArtifactIndex('/storyboard/branch--feature-foo/'))

    await waitFor(() => {
      expect(result.current.artifactIndex).toBe(index)
      expect(result.current.loading).toBe(false)
    })
    expect(fetchMock).toHaveBeenCalledWith('/storyboard/artifacts.index.json')
  })

  it('returns null on fetch failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const { result } = renderHook(() => useArtifactIndex('/storyboard/'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.artifactIndex).toBeNull()
  })
})
