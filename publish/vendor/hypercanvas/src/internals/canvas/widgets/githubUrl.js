const GH_HOST_RE = /^(www\.)?github\.com$/i
const ISSUE_PATH_RE = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/
const DISCUSSION_PATH_RE = /^\/([^/]+)\/([^/]+)\/discussions\/(\d+)\/?$/
const PULL_REQUEST_PATH_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/
const ISSUE_COMMENT_HASH_RE = /^#issuecomment-(\d+)$/i
const DISCUSSION_COMMENT_HASH_RE = /^#discussioncomment-(\d+)$/i
const PR_REVIEW_COMMENT_HASH_RE = /^#discussion_r(\d+)$/i

function toNumber(raw) {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : null
}

/**
 * Parse supported GitHub embed URLs (issues, discussions, pull requests, comments).
 * @param {string} rawUrl
 * @returns {null | {
 *   kind: 'issue' | 'discussion' | 'pull_request' | 'comment',
 *   parentKind: 'issue' | 'discussion' | 'pull_request',
 *   owner: string,
 *   repo: string,
 *   number: number,
 *   commentId?: number,
 *   commentSubKind?: 'issue_comment' | 'review_comment'
 * }}
 */
export function parseGitHubUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (!GH_HOST_RE.test(parsed.hostname)) return null

    const issueMatch = parsed.pathname.match(ISSUE_PATH_RE)
    if (issueMatch) {
      const [, owner, repo, numberRaw] = issueMatch
      const number = toNumber(numberRaw)
      if (!number) return null

      const commentMatch = parsed.hash.match(ISSUE_COMMENT_HASH_RE)
      if (commentMatch) {
        const commentId = toNumber(commentMatch[1])
        if (!commentId) return null
        return { kind: 'comment', parentKind: 'issue', owner, repo, number, commentId }
      }

      if (parsed.hash) return null
      return { kind: 'issue', parentKind: 'issue', owner, repo, number }
    }

    const discussionMatch = parsed.pathname.match(DISCUSSION_PATH_RE)
    if (discussionMatch) {
      const [, owner, repo, numberRaw] = discussionMatch
      const number = toNumber(numberRaw)
      if (!number) return null

      const commentMatch = parsed.hash.match(DISCUSSION_COMMENT_HASH_RE)
      if (commentMatch) {
        const commentId = toNumber(commentMatch[1])
        if (!commentId) return null
        return { kind: 'comment', parentKind: 'discussion', owner, repo, number, commentId }
      }

      if (parsed.hash) return null
      return { kind: 'discussion', parentKind: 'discussion', owner, repo, number }
    }

    const prMatch = parsed.pathname.match(PULL_REQUEST_PATH_RE)
    if (prMatch) {
      const [, owner, repo, numberRaw] = prMatch
      const number = toNumber(numberRaw)
      if (!number) return null

      const issueCommentMatch = parsed.hash.match(ISSUE_COMMENT_HASH_RE)
      if (issueCommentMatch) {
        const commentId = toNumber(issueCommentMatch[1])
        if (!commentId) return null
        return { kind: 'comment', parentKind: 'pull_request', owner, repo, number, commentId, commentSubKind: 'issue_comment' }
      }

      const reviewCommentMatch = parsed.hash.match(PR_REVIEW_COMMENT_HASH_RE)
      if (reviewCommentMatch) {
        const commentId = toNumber(reviewCommentMatch[1])
        if (!commentId) return null
        return { kind: 'comment', parentKind: 'pull_request', owner, repo, number, commentId, commentSubKind: 'review_comment' }
      }

      if (parsed.hash) return null
      return { kind: 'pull_request', parentKind: 'pull_request', owner, repo, number }
    }
  } catch {
    return null
  }

  return null
}

export function isGitHubEmbedUrl(rawUrl) {
  return parseGitHubUrl(rawUrl) !== null
}
