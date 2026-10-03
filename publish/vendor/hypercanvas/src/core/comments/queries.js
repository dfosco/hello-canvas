/**
 * GraphQL query and mutation strings for the comments system.
 */

/** Search for a discussion by title — full data (used by drawer) */
export const SEARCH_DISCUSSION = `
  query SearchDiscussion($query: String!) {
    search(query: $query, type: DISCUSSION, first: 1) {
      nodes {
        ... on Discussion {
          id
          title
          body
          url
          comments(first: 100) {
            nodes {
              id
              body
              createdAt
              author {
                login
                avatarUrl
              }
              replies(first: 50) {
                nodes {
                  id
                  body
                  createdAt
                  author {
                    login
                    avatarUrl
                  }
                  reactionGroups {
                    content
                    users(first: 0) { totalCount }
                    viewerHasReacted
                  }
                }
              }
              reactionGroups {
                content
                users(first: 0) { totalCount }
                viewerHasReacted
              }
            }
          }
        }
      }
    }
  }
`

/** Search for a discussion — lightweight (pins only: id, body for metadata, author) */
export const SEARCH_DISCUSSION_LIGHTWEIGHT = `
  query SearchDiscussionLightweight($query: String!) {
    search(query: $query, type: DISCUSSION, first: 1) {
      nodes {
        ... on Discussion {
          id
          title
          url
          comments(first: 100) {
            nodes {
              id
              body
              author {
                login
                avatarUrl
              }
            }
          }
        }
      }
    }
  }
`

/** Fetch full detail for a single comment by node ID */
export const GET_COMMENT_DETAIL = `
  query GetCommentDetail($id: ID!) {
    node(id: $id) {
      ... on DiscussionComment {
        id
        body
        createdAt
        discussion {
          id
        }
        author {
          login
          avatarUrl
        }
        replies(first: 50) {
          nodes {
            id
            body
            createdAt
            author {
              login
              avatarUrl
            }
            reactionGroups {
              content
              users(first: 0) { totalCount }
              viewerHasReacted
            }
          }
        }
        reactionGroups {
          content
          users(first: 0) { totalCount }
          viewerHasReacted
        }
      }
    }
  }
`

/** Get the discussion category ID by name */
export const GET_CATEGORY_ID = `
  query GetCategoryId($owner: String!, $name: String!, $slug: String!) {
    repository(owner: $owner, name: $name) {
      id
      discussionCategory(slug: $slug) {
        id
      }
      discussionCategories(first: 25) {
        nodes {
          id
          name
          slug
        }
      }
    }
  }
`

/** Create a new discussion */
export const CREATE_DISCUSSION = `
  mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
      discussion {
        id
        title
        url
      }
    }
  }
`

/** Add a comment to a discussion */
export const ADD_COMMENT = `
  mutation AddComment($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
      comment {
        id
        body
        createdAt
        author {
          login
          avatarUrl
        }
      }
    }
  }
`

/** Reply to a discussion comment */
export const ADD_REPLY = `
  mutation AddReply($discussionId: ID!, $replyToId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body, replyToId: $replyToId }) {
      comment {
        id
        body
        createdAt
        author {
          login
          avatarUrl
        }
      }
    }
  }
`

/** Update a discussion comment body */
export const UPDATE_COMMENT = `
  mutation UpdateComment($commentId: ID!, $body: String!) {
    updateDiscussionComment(input: { commentId: $commentId, body: $body }) {
      comment {
        id
        body
      }
    }
  }
`

/** Delete a discussion comment */
export const DELETE_COMMENT = `
  mutation DeleteComment($commentId: ID!) {
    deleteDiscussionComment(input: { id: $commentId }) {
      comment {
        id
      }
    }
  }
`

/** Add a reaction */
export const ADD_REACTION = `
  mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
    addReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
    }
  }
`

/** Remove a reaction */
export const REMOVE_REACTION = `
  mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
    removeReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
    }
  }
`

/** List all discussions in a category */
export const LIST_DISCUSSIONS = `
  query ListDiscussions($owner: String!, $name: String!, $categoryId: ID!) {
    repository(owner: $owner, name: $name) {
      discussions(first: 50, categoryId: $categoryId) {
        nodes {
          id
          title
          body
          url
          createdAt
          comments {
            totalCount
          }
        }
      }
    }
  }
`
