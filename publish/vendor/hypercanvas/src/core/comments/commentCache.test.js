import { getCachedComments, setCachedComments, clearCachedComments } from './commentCache.js'

describe('commentCache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null for uncached route', () => {
    expect(getCachedComments('/Overview')).toBeNull()
  })

  it('stores and retrieves cached comments', () => {
    const data = { id: 'D_1', comments: [{ id: 'C_1', meta: { x: 10, y: 20 } }] }
    setCachedComments('/Overview', data)
    const cached = getCachedComments('/Overview')
    expect(cached).toEqual(data)
  })

  it('returns null for expired cache', () => {
    const data = { id: 'D_1', comments: [] }
    // Manually write expired entry
    localStorage.setItem('sb-comments:/Overview', JSON.stringify({
      ts: Date.now() - 3 * 60 * 1000, // 3 min ago (exceeds 2-min TTL)
      data,
    }))
    expect(getCachedComments('/Overview')).toBeNull()
  })

  it('clears cached comments for a route', () => {
    setCachedComments('/Overview', { id: 'D_1', comments: [] })
    clearCachedComments('/Overview')
    expect(getCachedComments('/Overview')).toBeNull()
  })

  it('does not affect other routes when clearing', () => {
    const data1 = { id: 'D_1', comments: [] }
    const data2 = { id: 'D_2', comments: [] }
    setCachedComments('/Overview', data1)
    setCachedComments('/Issues', data2)
    clearCachedComments('/Overview')
    expect(getCachedComments('/Issues')).toEqual(data2)
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('sb-comments:/Overview', 'not-json')
    expect(getCachedComments('/Overview')).toBeNull()
  })
})
