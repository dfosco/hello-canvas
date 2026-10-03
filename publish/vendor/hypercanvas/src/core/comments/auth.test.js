import { getToken, setToken, clearToken, getCachedUser, isAuthenticated, validateToken } from './auth.js'
import { initCommentsConfig } from './config.js'

describe('auth token management', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('stores and retrieves a token', () => {
    setToken('ghp_test123')
    expect(getToken()).toBe('ghp_test123')
  })

  it('clears token and user', () => {
    setToken('ghp_test123')
    localStorage.setItem('sb-comments-user', JSON.stringify({ login: 'test' }))
    clearToken()
    expect(getToken()).toBeNull()
    expect(getCachedUser()).toBeNull()
  })
})

describe('getCachedUser', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no user is cached', () => {
    expect(getCachedUser()).toBeNull()
  })

  it('returns cached user info', () => {
    const user = { login: 'dfosco', avatarUrl: 'https://example.com/avatar.png' }
    localStorage.setItem('sb-comments-user', JSON.stringify(user))
    expect(getCachedUser()).toEqual(user)
  })

  it('returns null on invalid JSON', () => {
    localStorage.setItem('sb-comments-user', 'not json')
    expect(getCachedUser()).toBeNull()
  })
})

describe('isAuthenticated', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns false when no token', () => {
    expect(isAuthenticated()).toBe(false)
  })

  it('returns true when token exists', () => {
    setToken('ghp_abc')
    expect(isAuthenticated()).toBe(true)
  })
})

describe('validateToken', () => {
  beforeEach(() => {
    localStorage.clear()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws on invalid token (REST 401)', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(validateToken('bad_token')).rejects.toThrow('Invalid token')
  })

  it('validates user and permissions when config is set', async () => {
    initCommentsConfig({
      comments: { discussions: { category: 'Comments' } },
      repository: { owner: 'testorg', name: 'testrepo' },
    })

    // REST /user succeeds
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ login: 'testuser', avatar_url: 'https://img/avatar' }),
      headers: { get: () => 'repo' },
    })
    // GraphQL permissions probe succeeds
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        data: {
          repository: {
            id: 'R_123',
            discussionCategories: { nodes: [{ id: 'DC_1' }] },
          },
        },
      }),
    })

    const user = await validateToken('ghp_valid')
    expect(user).toEqual({ login: 'testuser', avatarUrl: 'https://img/avatar', scopes: ['repo'] })
    expect(getCachedUser()).toEqual(user)
  })

  it('throws descriptive error when token lacks discussion access', async () => {
    initCommentsConfig({
      comments: { discussions: { category: 'Comments' } },
      repository: { owner: 'testorg', name: 'testrepo' },
    })

    // REST /user succeeds
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ login: 'testuser', avatar_url: 'https://img/avatar' }),
      headers: { get: () => '' },
    })
    // GraphQL probe fails with permissions error
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        errors: [{ message: 'Resource not accessible by personal access token' }],
      }),
    })

    await expect(validateToken('ghp_no_scope')).rejects.toThrow(
      /doesn't have access.*discussions/i
    )
    // User should NOT be cached on permission failure
    expect(getCachedUser()).toBeNull()
  })

  it('throws when repository not found', async () => {
    initCommentsConfig({
      comments: { discussions: { category: 'Comments' } },
      repository: { owner: 'testorg', name: 'missing' },
    })

    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ login: 'testuser', avatar_url: 'https://img/avatar' }),
      headers: { get: () => '' },
    })
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { repository: null } }),
    })

    await expect(validateToken('ghp_valid')).rejects.toThrow(/not found/)
  })

  it('skips permission check when no comments config', async () => {
    initCommentsConfig({}) // no comments key

    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ login: 'testuser', avatar_url: 'https://img/avatar' }),
      headers: { get: () => '' },
    })

    const user = await validateToken('ghp_valid')
    expect(user.login).toBe('testuser')
    // Only 1 fetch call (REST), no GraphQL probe
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
