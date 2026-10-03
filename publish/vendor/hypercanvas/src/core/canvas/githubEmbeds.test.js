import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => {
  const execFileSync = vi.fn()
  return {
    execFileSync,
    default: { execFileSync },
  }
})

import { execFileSync } from 'node:child_process'
import {
  GitHubEmbedError,
  fetchGitHubEmbedSnapshot,
  isGhCliAvailable,
  parseGitHubEmbedUrl,
} from './githubEmbeds.js'

const ghExec = vi.mocked(execFileSync)

describe('parseGitHubEmbedUrl', () => {
  it('parses issue links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/issues/123')).toEqual({
      kind: 'issue',
      parentKind: 'issue',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 123,
      url: 'https://github.com/dfosco/storyboard/issues/123',
    })
  })

  it('parses discussion links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/discussions/456')).toEqual({
      kind: 'discussion',
      parentKind: 'discussion',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 456,
      url: 'https://github.com/dfosco/storyboard/discussions/456',
    })
  })

  it('parses issue comment links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/issues/123#issuecomment-987')).toEqual({
      kind: 'comment',
      parentKind: 'issue',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 123,
      commentId: 987,
      url: 'https://github.com/dfosco/storyboard/issues/123#issuecomment-987',
    })
  })

  it('parses discussion comment links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/discussions/456#discussioncomment-654')).toEqual({
      kind: 'comment',
      parentKind: 'discussion',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 456,
      commentId: 654,
      url: 'https://github.com/dfosco/storyboard/discussions/456#discussioncomment-654',
    })
  })

  it('parses pull request links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/pull/789')).toEqual({
      kind: 'pull_request',
      parentKind: 'pull_request',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 789,
      url: 'https://github.com/dfosco/storyboard/pull/789',
    })
  })

  it('parses PR top-level comment links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/pull/789#issuecomment-111')).toEqual({
      kind: 'comment',
      parentKind: 'pull_request',
      commentSubKind: 'issue_comment',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 789,
      commentId: 111,
      url: 'https://github.com/dfosco/storyboard/pull/789#issuecomment-111',
    })
  })

  it('parses PR inline review comment links', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/pull/789#discussion_r222')).toEqual({
      kind: 'comment',
      parentKind: 'pull_request',
      commentSubKind: 'review_comment',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 789,
      commentId: 222,
      url: 'https://github.com/dfosco/storyboard/pull/789#discussion_r222',
    })
  })

  it('rejects unsupported URLs and hashes', () => {
    expect(parseGitHubEmbedUrl('https://github.com/dfosco/storyboard/issues/123#foo')).toBeNull()
    expect(parseGitHubEmbedUrl('https://example.com/dfosco/storyboard/issues/123')).toBeNull()
    expect(parseGitHubEmbedUrl('not a url')).toBeNull()
  })
})

describe('gh availability', () => {
  beforeEach(() => {
    ghExec.mockReset()
  })

  it('returns true when gh is available', () => {
    ghExec.mockReturnValue('gh version 2.58.0')
    expect(isGhCliAvailable()).toBe(true)
    expect(ghExec).toHaveBeenCalledWith(
      'gh',
      ['--version'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('returns false when gh is missing', () => {
    ghExec.mockImplementation(() => {
      throw new Error('spawn gh ENOENT')
    })
    expect(isGhCliAvailable()).toBe(false)
  })
})

describe('fetchGitHubEmbedSnapshot', () => {
  beforeEach(() => {
    ghExec.mockReset()
  })

  it('hydrates issue snapshot metadata from gh', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        number: 123,
        title: 'Ship GitHub embeds',
        body: 'A detailed body',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        user: { login: 'dfosco' },
      }))

    const snapshot = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/issues/123')

    expect(snapshot).toEqual({
      kind: 'issue',
      parentKind: 'issue',
      context: 'GitHub · dfosco/storyboard · Issue #123',
      title: '#123 Ship GitHub embeds',
      body: 'A detailed body',
      bodyHtml: '',
      authors: ['dfosco'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      url: 'https://github.com/dfosco/storyboard/issues/123',
    })
  })

  it('hydrates discussion snapshot metadata via gh graphql', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        data: {
          repository: {
            discussion: {
              number: 456,
              title: 'Canvas API questions',
              body: 'Discussion body',
              createdAt: '2026-02-01T00:00:00Z',
              updatedAt: '2026-02-02T00:00:00Z',
              author: { login: 'octocat' },
            },
          },
        },
      }))

    const snapshot = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/discussions/456')

    expect(snapshot).toEqual({
      kind: 'discussion',
      parentKind: 'discussion',
      context: 'GitHub · dfosco/storyboard · Discussion #456',
      title: '#456 Canvas API questions',
      body: 'Discussion body',
      bodyHtml: '',
      authors: ['octocat'],
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-02T00:00:00Z',
      url: 'https://github.com/dfosco/storyboard/discussions/456',
    })

    const graphqlArgs = ghExec.mock.calls[1][1]
    expect(graphqlArgs.slice(0, 2)).toEqual(['api', 'graphql'])
  })

  it('hydrates pull request snapshot metadata (state, branches, diff)', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        number: 79,
        title: 'fix(viewfinder): eliminate FOUC',
        body: 'A PR body',
        state: 'closed',
        merged: true,
        merged_at: '2026-04-10T00:00:00Z',
        draft: false,
        user: { login: 'dfosco' },
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-10T00:00:00Z',
        base: { ref: '3.11.0' },
        head: { ref: '3.11.0--fix-viewfinder-fouc' },
        additions: 63,
        deletions: 18,
        changed_files: 4,
      }))

    const snapshot = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/pull/79')

    expect(snapshot).toMatchObject({
      kind: 'pull_request',
      parentKind: 'pull_request',
      title: '#79 fix(viewfinder): eliminate FOUC',
      state: 'merged',
      merged: true,
      draft: false,
      baseRef: '3.11.0',
      headRef: '3.11.0--fix-viewfinder-fouc',
      additions: 63,
      deletions: 18,
      changedFiles: 4,
    })
  })

  it('marks draft PRs and unmerged closed PRs correctly', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        number: 5,
        title: 'WIP: refactor',
        state: 'open',
        draft: true,
        merged: false,
        user: { login: 'dfosco' },
      }))

    const draftSnap = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/pull/5')
    expect(draftSnap.state).toBe('draft')
    expect(draftSnap.draft).toBe(true)
    expect(draftSnap.merged).toBe(false)

    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        number: 6,
        state: 'closed',
        merged: false,
        merged_at: null,
        user: { login: 'dfosco' },
      }))

    const closedSnap = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/pull/6')
    expect(closedSnap.state).toBe('closed')
    expect(closedSnap.merged).toBe(false)
  })

  it('rejects issue comment URLs when comment parent does not match', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        body: 'Comment body',
        user: { login: 'octocat' },
        issue_url: 'https://api.github.com/repos/dfosco/storyboard/issues/999',
      }))

    try {
      fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/issues/123#issuecomment-987')
      throw new Error('Expected fetchGitHubEmbedSnapshot to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubEmbedError)
      expect(error.code).toBe('gh_not_found')
      expect(error.status).toBe(404)
    }
  })

  it('hydrates discussion comment snapshot metadata via gh graphql', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        data: {
          repository: {
            discussion: {
              number: 456,
              title: 'Canvas API questions',
              body: 'Discussion body',
              createdAt: '2026-02-01T00:00:00Z',
              updatedAt: '2026-02-02T00:00:00Z',
              author: { login: 'maintainer' },
              comments: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null,
                },
                nodes: [
                  {
                    databaseId: 654,
                    body: 'This is a comment',
                    createdAt: '2026-02-03T00:00:00Z',
                    updatedAt: '2026-02-04T00:00:00Z',
                    author: { login: 'contributor' },
                  },
                ],
              },
            },
          },
        },
      }))

    const snapshot = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/discussions/456#discussioncomment-654')

    expect(snapshot).toEqual({
      kind: 'comment',
      parentKind: 'discussion',
      context: 'GitHub · dfosco/storyboard · Discussion #456 comment',
      title: 'Comment on #456 Canvas API questions',
      body: 'This is a comment',
      bodyHtml: '',
      authors: ['contributor', 'maintainer'],
      createdAt: '2026-02-03T00:00:00Z',
      updatedAt: '2026-02-04T00:00:00Z',
      url: 'https://github.com/dfosco/storyboard/discussions/456#discussioncomment-654',
    })
  })

  it('hydrates PR top-level comment snapshot metadata', () => {    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        body: 'Looks good!',
        user: { login: 'reviewer' },
        issue_url: 'https://api.github.com/repos/dfosco/storyboard/issues/789',
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-02T00:00:00Z',
      }))
      .mockReturnValueOnce(JSON.stringify({
        number: 789,
        title: 'Add PR comment embeds',
        user: { login: 'dfosco' },
      }))

    const snapshot = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/pull/789#issuecomment-111')

    expect(snapshot).toEqual({
      kind: 'comment',
      parentKind: 'pull_request',
      context: 'GitHub · dfosco/storyboard · Pull Request #789 comment',
      title: 'Comment on #789 Add PR comment embeds',
      body: 'Looks good!',
      bodyHtml: '',
      authors: ['reviewer', 'dfosco'],
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
      url: 'https://github.com/dfosco/storyboard/pull/789#issuecomment-111',
    })
  })

  it('hydrates PR inline review comment snapshot metadata', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        body: 'Nit: rename this var',
        user: { login: 'reviewer' },
        pull_request_url: 'https://api.github.com/repos/dfosco/storyboard/pulls/789',
        created_at: '2026-03-05T00:00:00Z',
        updated_at: '2026-03-05T00:00:00Z',
      }))
      .mockReturnValueOnce(JSON.stringify({
        number: 789,
        title: 'Add PR comment embeds',
        user: { login: 'dfosco' },
      }))

    const snapshot = fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/pull/789#discussion_r222')

    expect(snapshot.kind).toBe('comment')
    expect(snapshot.parentKind).toBe('pull_request')
    expect(snapshot.title).toBe('Comment on #789 Add PR comment embeds')
    expect(snapshot.body).toBe('Nit: rename this var')

    const reviewCommentArgs = ghExec.mock.calls[1][1]
    expect(reviewCommentArgs.at(-1)).toBe('repos/dfosco/storyboard/pulls/comments/222')
  })

  it('rejects PR comment URLs when parent does not match', () => {
    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockReturnValueOnce(JSON.stringify({
        body: 'Comment body',
        user: { login: 'octocat' },
        issue_url: 'https://api.github.com/repos/dfosco/storyboard/issues/999',
      }))

    try {
      fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/pull/789#issuecomment-111')
      throw new Error('Expected fetchGitHubEmbedSnapshot to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubEmbedError)
      expect(error.code).toBe('gh_not_found')
    }
  })

  it('throws gh_unavailable when gh is missing', () => {
    ghExec.mockImplementation(() => {
      throw new Error('spawn gh ENOENT')
    })

    try {
      fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/issues/123')
      throw new Error('Expected fetchGitHubEmbedSnapshot to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubEmbedError)
      expect(error.code).toBe('gh_unavailable')
      expect(error.status).toBe(503)
    }
  })

  it('maps auth failures to a safe message without leaking tokens', () => {
    const ghError = new Error('request failed')
    ghError.stderr = 'HTTP 401: token ghp_secret123 is invalid'

    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockImplementationOnce(() => {
        throw ghError
      })

    try {
      fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/issues/123')
      throw new Error('Expected fetchGitHubEmbedSnapshot to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubEmbedError)
      expect(error.code).toBe('gh_auth_required')
      expect(error.status).toBe(401)
      expect(error.message).not.toContain('ghp_secret123')
    }
  })

  it('maps inaccessible resources to 404', () => {
    const ghError = new Error('request failed')
    ghError.stderr = 'HTTP 404: Not Found'

    ghExec
      .mockReturnValueOnce('gh version 2.58.0')
      .mockImplementationOnce(() => {
        throw ghError
      })

    try {
      fetchGitHubEmbedSnapshot('https://github.com/dfosco/storyboard/discussions/456')
      throw new Error('Expected fetchGitHubEmbedSnapshot to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubEmbedError)
      expect(error.code).toBe('gh_not_found')
      expect(error.status).toBe(404)
    }
  })
})
