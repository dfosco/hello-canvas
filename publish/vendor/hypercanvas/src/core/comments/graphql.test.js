import { graphql } from './graphql.js'
import { setToken, clearToken } from './auth.js'

describe('graphql', () => {
  beforeEach(() => {
    clearToken()
    vi.restoreAllMocks()
  })

  it('throws when not authenticated', async () => {
    await expect(graphql('query { viewer { login } }')).rejects.toThrow(
      'Not authenticated'
    )
  })

  it('sends authenticated request and returns data', async () => {
    setToken('ghp_test')
    const mockData = { viewer: { login: 'test' } }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: mockData }),
      })
    )

    const result = await graphql('query { viewer { login } }')
    expect(result).toEqual(mockData)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'bearer ghp_test',
        }),
      })
    )
  })

  it('throws on 401 without retrying', async () => {
    setToken('ghp_bad')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })
    )

    await expect(graphql('query { viewer { login } }')).rejects.toThrow(
      'invalid or expired'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws on GraphQL errors', async () => {
    setToken('ghp_test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: null,
            errors: [{ message: 'Something went wrong' }],
          }),
      })
    )

    await expect(graphql('query { bad }')).rejects.toThrow(
      'GraphQL error: Something went wrong'
    )
  })

  it('passes variables in request body', async () => {
    setToken('ghp_test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: {} }),
      })
    )

    await graphql('mutation ($id: ID!) { delete(id: $id) }', { id: '123' })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.variables).toEqual({ id: '123' })
  })
})
