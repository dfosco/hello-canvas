import {
  fetchRouteDiscussion,
  fetchRouteCommentsSummary,
  fetchCommentDetail,
  createComment,
  replyToComment,
  resolveComment,
  moveComment,
  addReaction,
  removeReaction,
} from './api.js'
import { initCommentsConfig } from './config.js'
import { setToken, clearToken } from './auth.js'

// Mock the graphql module
vi.mock('./graphql.js', () => ({
  graphql: vi.fn(),
}))

import { graphql } from './graphql.js'

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearToken()
    setToken('ghp_test')
    initCommentsConfig({
      comments: {
        repo: { owner: 'dfosco', name: 'storyboard' },
        discussions: { category: 'Storyboard Comments' },
      },
    })
  })

  describe('fetchRouteDiscussion', () => {
    it('returns null when no discussion found', async () => {
      graphql.mockResolvedValue({ search: { nodes: [] } })
      const result = await fetchRouteDiscussion('/Overview')
      expect(result).toBeNull()
    })

    it('parses comments with metadata', async () => {
      graphql.mockResolvedValue({
        search: {
          nodes: [
            {
              id: 'D_123',
              title: 'Comments: /Overview',
              comments: {
                nodes: [
                  {
                    id: 'C_1',
                    body: '<!-- sb-meta {"x":10,"y":20} -->\nHello',
                    createdAt: '2026-01-01T00:00:00Z',
                    author: { login: 'dfosco', avatarUrl: 'https://example.com' },
                    replies: { nodes: [] },
                    reactionGroups: [],
                  },
                ],
              },
            },
          ],
        },
      })

      const result = await fetchRouteDiscussion('/Overview')
      expect(result.id).toBe('D_123')
      expect(result.comments).toHaveLength(1)
      expect(result.comments[0].meta).toEqual({ x: 10, y: 20 })
      expect(result.comments[0].text).toBe('Hello')
    })

    it('parses replies with metadata', async () => {
      graphql.mockResolvedValue({
        search: {
          nodes: [
            {
              id: 'D_123',
              comments: {
                nodes: [
                  {
                    id: 'C_1',
                    body: '<!-- sb-meta {"x":10,"y":20} -->\nComment',
                    replies: {
                      nodes: [
                        {
                          id: 'R_1',
                          body: 'A reply',
                          author: { login: 'user2' },
                        },
                      ],
                    },
                    reactionGroups: [],
                  },
                ],
              },
            },
          ],
        },
      })

      const result = await fetchRouteDiscussion('/Test')
      expect(result.comments[0].replies).toHaveLength(1)
      expect(result.comments[0].replies[0].text).toBe('A reply')
    })
  })

  describe('fetchRouteCommentsSummary', () => {
    it('returns null when no discussion found', async () => {
      graphql.mockResolvedValue({ search: { nodes: [] } })
      const result = await fetchRouteCommentsSummary('/Overview')
      expect(result).toBeNull()
    })

    it('parses comments with metadata (no replies/reactions)', async () => {
      graphql.mockResolvedValue({
        search: {
          nodes: [
            {
              id: 'D_123',
              title: 'Comments: /Overview',
              comments: {
                nodes: [
                  {
                    id: 'C_1',
                    body: '<!-- sb-meta {"x":10,"y":20} -->\nHello',
                    author: { login: 'dfosco', avatarUrl: 'https://example.com' },
                  },
                ],
              },
            },
          ],
        },
      })

      const result = await fetchRouteCommentsSummary('/Overview')
      expect(result.id).toBe('D_123')
      expect(result.comments).toHaveLength(1)
      expect(result.comments[0].meta).toEqual({ x: 10, y: 20 })
      expect(result.comments[0].text).toBe('Hello')
      // Should use lightweight query (no replies/reactions in query)
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('SearchDiscussionLightweight'),
        expect.any(Object)
      )
    })
  })

  describe('fetchCommentDetail', () => {
    it('returns null when node not found', async () => {
      graphql.mockResolvedValue({ node: null })
      const result = await fetchCommentDetail('C_999')
      expect(result).toBeNull()
    })

    it('returns full comment with replies and reactions', async () => {
      graphql.mockResolvedValue({
        node: {
          id: 'C_1',
          body: '<!-- sb-meta {"x":10,"y":20} -->\nHello',
          createdAt: '2026-01-01T00:00:00Z',
          author: { login: 'dfosco', avatarUrl: 'https://example.com' },
          replies: {
            nodes: [
              {
                id: 'R_1',
                body: 'A reply',
                createdAt: '2026-01-02T00:00:00Z',
                author: { login: 'user2', avatarUrl: 'https://example.com/2' },
                reactionGroups: [],
              },
            ],
          },
          reactionGroups: [
            { content: 'HEART', users: { totalCount: 1 }, viewerHasReacted: true },
          ],
        },
      })

      const result = await fetchCommentDetail('C_1')
      expect(result.id).toBe('C_1')
      expect(result.meta).toEqual({ x: 10, y: 20 })
      expect(result.text).toBe('Hello')
      expect(result.replies).toHaveLength(1)
      expect(result.replies[0].text).toBe('A reply')
      expect(result.reactionGroups).toHaveLength(1)
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('GetCommentDetail'),
        { id: 'C_1' }
      )
    })
  })

  describe('createComment', () => {
    it('creates a comment on existing discussion', async () => {
      // First call: search for discussion
      graphql.mockResolvedValueOnce({
        search: {
          nodes: [{ id: 'D_123', comments: { nodes: [] } }],
        },
      })
      // Second call: add comment
      graphql.mockResolvedValueOnce({
        addDiscussionComment: {
          comment: { id: 'C_new', body: '<!-- sb-meta {"x":50,"y":60} -->\nTest' },
        },
      })

      const result = await createComment('/Overview', 50, 60, 'Test')
      expect(result.id).toBe('C_new')
      expect(graphql).toHaveBeenCalledTimes(2)
    })
  })

  describe('replyToComment', () => {
    it('posts a reply', async () => {
      graphql.mockResolvedValue({
        addDiscussionComment: {
          comment: { id: 'R_1', body: 'Reply text' },
        },
      })

      const result = await replyToComment('D_123', 'C_1', 'Reply text')
      expect(result.id).toBe('R_1')
    })
  })

  describe('resolveComment', () => {
    it('updates metadata with resolved flag', async () => {
      graphql.mockResolvedValue({
        updateDiscussionComment: {
          comment: { id: 'C_1', body: '<!-- sb-meta {"x":10,"y":20,"resolved":true} -->\nText' },
        },
      })

      const body = '<!-- sb-meta {"x":10,"y":20} -->\nText'
      await resolveComment('C_1', body)

      const calledBody = graphql.mock.calls[0][1].body
      expect(calledBody).toContain('"resolved":true')
    })
  })

  describe('moveComment', () => {
    it('updates coordinates in metadata', async () => {
      graphql.mockResolvedValue({
        updateDiscussionComment: {
          comment: { id: 'C_1', body: 'updated' },
        },
      })

      const body = '<!-- sb-meta {"x":10,"y":20} -->\nText'
      await moveComment('C_1', body, 50, 60)

      const calledBody = graphql.mock.calls[0][1].body
      expect(calledBody).toContain('"x":50')
      expect(calledBody).toContain('"y":60')
    })
  })

  describe('addReaction', () => {
    it('calls graphql with correct args', async () => {
      graphql.mockResolvedValue({})
      await addReaction('C_1', 'HEART')
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('addReaction'),
        { subjectId: 'C_1', content: 'HEART' }
      )
    })
  })

  describe('removeReaction', () => {
    it('calls graphql with correct args', async () => {
      graphql.mockResolvedValue({})
      await removeReaction('C_1', 'THUMBS_UP')
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('removeReaction'),
        { subjectId: 'C_1', content: 'THUMBS_UP' }
      )
    })
  })
})
