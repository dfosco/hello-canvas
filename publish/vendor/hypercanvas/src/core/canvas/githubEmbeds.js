import { execFileSync } from 'node:child_process'

export const GH_INSTALL_URL = 'https://github.com/cli/cli'

const GH_HOST_RE = /^(www\.)?github\.com$/i
const OWNER_RE = /^[A-Za-z0-9_.-]+$/
const REPO_RE = /^[A-Za-z0-9_.-]+$/
const ISSUE_PATH_RE = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/
const DISCUSSION_PATH_RE = /^\/([^/]+)\/([^/]+)\/discussions\/(\d+)\/?$/
const PULL_REQUEST_PATH_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/
const ISSUE_COMMENT_HASH_RE = /^#issuecomment-(\d+)$/i
const DISCUSSION_COMMENT_HASH_RE = /^#discussioncomment-(\d+)$/i
const PR_REVIEW_COMMENT_HASH_RE = /^#discussion_r(\d+)$/i

const GH_TIMEOUT_MS = 15_000
const NOT_FOUND_MESSAGE = 'GitHub resource was not found or is not accessible with current credentials.'

export class GitHubEmbedError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'GitHubEmbedError'
    this.code = code
    this.status = status
  }
}

function isValidRepoRef(owner, repo) {
  return OWNER_RE.test(owner) && REPO_RE.test(repo)
}

function parseNumber(raw) {
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBody(body) {
  if (typeof body !== 'string') return ''
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function uniqueStrings(values) {
  return [...new Set(
    (values || [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
  )]
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: GH_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function runGhApi(pathname, { withHtml = false } = {}) {
  const accept = withHtml
    ? 'application/vnd.github.full+json'
    : 'application/vnd.github+json'
  const output = runGh([
    'api',
    '-H',
    `Accept: ${accept}`,
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
    pathname,
  ])

  try {
    return JSON.parse(output || '{}')
  } catch {
    throw new GitHubEmbedError('gh_invalid_json', 'GitHub CLI returned invalid JSON.', 502)
  }
}

function runGhGraphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [name, value] of Object.entries(variables)) {
    if (value == null) continue
    args.push('-F', `${name}=${String(value)}`)
  }

  const output = runGh(args)
  try {
    return JSON.parse(output || '{}')
  } catch {
    throw new GitHubEmbedError('gh_invalid_json', 'GitHub CLI returned invalid JSON.', 502)
  }
}

function sanitizeGhErrorMessage(message) {
  return String(message || '')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]')
    .trim()
}

function extractStatusCode(message) {
  const match = String(message || '').match(/(?:HTTP\s+)?(401|403|404|422|429|500|502|503)\b/)
  if (!match) return null
  return Number.parseInt(match[1], 10)
}

function toFriendlyError(error) {
  if (error instanceof GitHubEmbedError) return error

  const raw = sanitizeGhErrorMessage(error?.stderr || error?.message || 'Failed to fetch GitHub data.')
  const status = extractStatusCode(raw)

  if (status === 401 || status === 403) {
    return new GitHubEmbedError(
      'gh_auth_required',
      'GitHub API rejected the request. Run `gh auth login` to access private resources.',
      401,
    )
  }

  if (status === 404) {
    return new GitHubEmbedError(
      'gh_not_found',
      NOT_FOUND_MESSAGE,
      404,
    )
  }

  if (status === 429) {
    return new GitHubEmbedError(
      'gh_rate_limited',
      'GitHub API rate limit reached. Try again in a few minutes.',
      429,
    )
  }

  return new GitHubEmbedError(
    'gh_fetch_failed',
    raw || 'Failed to fetch GitHub metadata via gh CLI.',
    502,
  )
}

function toContext(target) {
  const repo = `${target.owner}/${target.repo}`
  if (target.kind === 'issue') return `GitHub · ${repo} · Issue #${target.number}`
  if (target.kind === 'pull_request') return `GitHub · ${repo} · Pull Request #${target.number}`
  if (target.kind === 'discussion') return `GitHub · ${repo} · Discussion #${target.number}`
  if (target.parentKind === 'issue') return `GitHub · ${repo} · Issue #${target.number} comment`
  if (target.parentKind === 'pull_request') return `GitHub · ${repo} · Pull Request #${target.number} comment`
  return `GitHub · ${repo} · Discussion #${target.number} comment`
}

function buildPullRequestSnapshot(target, pr) {
  const number = pr?.number ?? target.number
  const merged = Boolean(pr?.merged_at || pr?.merged)
  const draft = Boolean(pr?.draft)
  const rawState = pr?.state === 'closed' ? 'closed' : 'open'
  const state = merged ? 'merged' : (draft && rawState === 'open' ? 'draft' : rawState)
  return {
    kind: 'pull_request',
    parentKind: 'pull_request',
    context: toContext(target),
    title: pr?.title ? `#${number} ${pr.title}` : `Pull Request #${number}`,
    body: normalizeBody(pr?.body),
    bodyHtml: pr?.body_html || '',
    authors: uniqueStrings([pr?.user?.login]),
    createdAt: pr?.created_at ?? null,
    updatedAt: pr?.updated_at ?? null,
    url: target.url,
    state,
    merged,
    draft,
    baseRef: typeof pr?.base?.ref === 'string' ? pr.base.ref : null,
    headRef: typeof pr?.head?.ref === 'string' ? pr.head.ref : null,
    additions: typeof pr?.additions === 'number' ? pr.additions : null,
    deletions: typeof pr?.deletions === 'number' ? pr.deletions : null,
    changedFiles: typeof pr?.changed_files === 'number' ? pr.changed_files : null,
  }
}

function buildIssueSnapshot(target, issue) {
  const number = issue?.number ?? target.number
  return {
    kind: 'issue',
    parentKind: 'issue',
    context: toContext(target),
    title: issue?.title ? `#${number} ${issue.title}` : `Issue #${number}`,
    body: normalizeBody(issue?.body),
    bodyHtml: issue?.body_html || '',
    authors: uniqueStrings([issue?.user?.login]),
    createdAt: issue?.created_at ?? null,
    updatedAt: issue?.updated_at ?? null,
    url: target.url,
  }
}

function buildDiscussionSnapshot(target, discussion) {
  const number = discussion?.number ?? target.number
  return {
    kind: 'discussion',
    parentKind: 'discussion',
    context: toContext(target),
    title: discussion?.title ? `#${number} ${discussion.title}` : `Discussion #${number}`,
    body: normalizeBody(discussion?.body),
    bodyHtml: discussion?.bodyHTML || '',
    authors: uniqueStrings([discussion?.author?.login, discussion?.user?.login]),
    createdAt: discussion?.createdAt ?? discussion?.created_at ?? null,
    updatedAt: discussion?.updatedAt ?? discussion?.updated_at ?? null,
    url: target.url,
  }
}

function buildPullRequestCommentSnapshot(target, comment, pr) {
  const prNumber = pr?.number ?? target.number
  const parentLabel = pr?.title ? `#${prNumber} ${pr.title}` : `Pull Request #${prNumber}`
  return {
    kind: 'comment',
    parentKind: 'pull_request',
    context: toContext(target),
    title: `Comment on ${parentLabel}`,
    body: normalizeBody(comment?.body),
    bodyHtml: comment?.body_html || '',
    authors: uniqueStrings([comment?.user?.login, pr?.user?.login]),
    createdAt: comment?.created_at ?? null,
    updatedAt: comment?.updated_at ?? null,
    url: target.url,
  }
}

function buildIssueCommentSnapshot(target, comment, issue) {
  const issueNumber = issue?.number ?? target.number
  const parentLabel = issue?.title ? `#${issueNumber} ${issue.title}` : `Issue #${issueNumber}`
  return {
    kind: 'comment',
    parentKind: 'issue',
    context: toContext(target),
    title: `Comment on ${parentLabel}`,
    body: normalizeBody(comment?.body),
    bodyHtml: comment?.body_html || '',
    authors: uniqueStrings([comment?.user?.login, issue?.user?.login]),
    createdAt: comment?.created_at ?? null,
    updatedAt: comment?.updated_at ?? null,
    url: target.url,
  }
}

function buildDiscussionCommentSnapshot(target, comment, discussion) {
  const discussionNumber = discussion?.number ?? target.number
  const parentLabel = discussion?.title ? `#${discussionNumber} ${discussion.title}` : `Discussion #${discussionNumber}`
  return {
    kind: 'comment',
    parentKind: 'discussion',
    context: toContext(target),
    title: `Comment on ${parentLabel}`,
    body: normalizeBody(comment?.body),
    bodyHtml: comment?.bodyHTML || '',
    authors: uniqueStrings([comment?.author?.login, comment?.user?.login, discussion?.author?.login, discussion?.user?.login]),
    createdAt: comment?.createdAt ?? comment?.created_at ?? null,
    updatedAt: comment?.updatedAt ?? comment?.updated_at ?? null,
    url: target.url,
  }
}

function parseIssueRefFromApiUrl(issueUrl) {
  if (typeof issueUrl !== 'string' || !issueUrl) return null
  try {
    const parsed = new URL(issueUrl)
    const match = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/)
    if (!match) return null
    const number = parseNumber(match[3])
    if (!number) return null
    return {
      owner: match[1],
      repo: match[2],
      number,
    }
  } catch {
    return null
  }
}

function parsePullRequestRefFromApiUrl(prUrl) {
  if (typeof prUrl !== 'string' || !prUrl) return null
  try {
    const parsed = new URL(prUrl)
    const match = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/)
    if (!match) return null
    const number = parseNumber(match[3])
    if (!number) return null
    return { owner: match[1], repo: match[2], number }
  } catch {
    return null
  }
}

function assertIssueCommentParent(target, comment) {
  const parent = parseIssueRefFromApiUrl(comment?.issue_url)
  if (!parent) {
    throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
  }

  const sameOwner = parent.owner.toLowerCase() === target.owner.toLowerCase()
  const sameRepo = parent.repo.toLowerCase() === target.repo.toLowerCase()
  const sameNumber = parent.number === target.number
  if (!sameOwner || !sameRepo || !sameNumber) {
    throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
  }
}

function assertPullRequestCommentParent(target, comment) {
  // Top-level PR conversation comments come back via issues/comments endpoint and
  // expose issue_url that matches the PR's issue (/repos/.../issues/N).
  // Inline review comments expose pull_request_url (/repos/.../pulls/N).
  const parent = parsePullRequestRefFromApiUrl(comment?.pull_request_url)
    || parseIssueRefFromApiUrl(comment?.issue_url)
  if (!parent) {
    throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
  }

  const sameOwner = parent.owner.toLowerCase() === target.owner.toLowerCase()
  const sameRepo = parent.repo.toLowerCase() === target.repo.toLowerCase()
  const sameNumber = parent.number === target.number
  if (!sameOwner || !sameRepo || !sameNumber) {
    throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
  }
}

function fetchDiscussion(target) {
  const query = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      number
      title
      body
      bodyHTML
      createdAt
      updatedAt
      author { login }
    }
  }
}
`
  const response = runGhGraphql(query, {
    owner: target.owner,
    repo: target.repo,
    number: target.number,
  })

  const discussion = response?.data?.repository?.discussion
  if (!discussion) {
    throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
  }
  return discussion
}

function fetchDiscussionComment(target) {
  const query = `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      number
      title
      body
      bodyHTML
      createdAt
      updatedAt
      author { login }
      comments(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          databaseId
          body
          bodyHTML
          createdAt
          updatedAt
          author { login }
        }
      }
    }
  }
}
`

  let after = null
  while (true) {
    const response = runGhGraphql(query, {
      owner: target.owner,
      repo: target.repo,
      number: target.number,
      after,
    })

    const discussion = response?.data?.repository?.discussion
    if (!discussion) {
      throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
    }

    const comment = (discussion?.comments?.nodes || [])
      .find((node) => Number(node?.databaseId) === target.commentId)

    if (comment) return { discussion, comment }

    const pageInfo = discussion?.comments?.pageInfo
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
      throw new GitHubEmbedError('gh_not_found', NOT_FOUND_MESSAGE, 404)
    }
    after = pageInfo.endCursor
  }
}

/**
 * Parse a GitHub URL to a supported embed target.
 *
 * Supported patterns:
 * - /{owner}/{repo}/issues/{number}
 * - /{owner}/{repo}/discussions/{number}
 * - /{owner}/{repo}/pull/{number}
 * - /{owner}/{repo}/issues/{number}#issuecomment-{id}
 * - /{owner}/{repo}/discussions/{number}#discussioncomment-{id}
 * - /{owner}/{repo}/pull/{number}#issuecomment-{id}    (top-level PR comment)
 * - /{owner}/{repo}/pull/{number}#discussion_r{id}     (inline review comment)
 *
 * @param {string} rawUrl
 * @returns {null | {
 *   kind: 'issue' | 'discussion' | 'pull_request' | 'comment',
 *   parentKind: 'issue' | 'discussion' | 'pull_request',
 *   owner: string,
 *   repo: string,
 *   number: number,
 *   commentId?: number,
 *   commentSubKind?: 'issue_comment' | 'review_comment',
 *   url: string
 * }}
 */
export function parseGitHubEmbedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (!GH_HOST_RE.test(parsed.hostname)) return null

    const issueMatch = parsed.pathname.match(ISSUE_PATH_RE)
    if (issueMatch) {
      const [, owner, repo, numberRaw] = issueMatch
      if (!isValidRepoRef(owner, repo)) return null
      const number = parseNumber(numberRaw)
      if (!number) return null

      const commentMatch = parsed.hash.match(ISSUE_COMMENT_HASH_RE)
      if (commentMatch) {
        const commentId = parseNumber(commentMatch[1])
        if (!commentId) return null
        return {
          kind: 'comment',
          parentKind: 'issue',
          owner,
          repo,
          number,
          commentId,
          url: parsed.toString(),
        }
      }

      if (parsed.hash) return null
      return {
        kind: 'issue',
        parentKind: 'issue',
        owner,
        repo,
        number,
        url: parsed.toString(),
      }
    }

    const discussionMatch = parsed.pathname.match(DISCUSSION_PATH_RE)
    if (discussionMatch) {
      const [, owner, repo, numberRaw] = discussionMatch
      if (!isValidRepoRef(owner, repo)) return null
      const number = parseNumber(numberRaw)
      if (!number) return null

      const commentMatch = parsed.hash.match(DISCUSSION_COMMENT_HASH_RE)
      if (commentMatch) {
        const commentId = parseNumber(commentMatch[1])
        if (!commentId) return null
        return {
          kind: 'comment',
          parentKind: 'discussion',
          owner,
          repo,
          number,
          commentId,
          url: parsed.toString(),
        }
      }

      if (parsed.hash) return null
      return {
        kind: 'discussion',
        parentKind: 'discussion',
        owner,
        repo,
        number,
        url: parsed.toString(),
      }
    }

    const prMatch = parsed.pathname.match(PULL_REQUEST_PATH_RE)
    if (prMatch) {
      const [, owner, repo, numberRaw] = prMatch
      if (!isValidRepoRef(owner, repo)) return null
      const number = parseNumber(numberRaw)
      if (!number) return null

      const issueCommentMatch = parsed.hash.match(ISSUE_COMMENT_HASH_RE)
      if (issueCommentMatch) {
        const commentId = parseNumber(issueCommentMatch[1])
        if (!commentId) return null
        return {
          kind: 'comment',
          parentKind: 'pull_request',
          commentSubKind: 'issue_comment',
          owner,
          repo,
          number,
          commentId,
          url: parsed.toString(),
        }
      }

      const reviewCommentMatch = parsed.hash.match(PR_REVIEW_COMMENT_HASH_RE)
      if (reviewCommentMatch) {
        const commentId = parseNumber(reviewCommentMatch[1])
        if (!commentId) return null
        return {
          kind: 'comment',
          parentKind: 'pull_request',
          commentSubKind: 'review_comment',
          owner,
          repo,
          number,
          commentId,
          url: parsed.toString(),
        }
      }

      if (parsed.hash) return null
      return {
        kind: 'pull_request',
        parentKind: 'pull_request',
        owner,
        repo,
        number,
        url: parsed.toString(),
      }
    }
  } catch {
    return null
  }

  return null
}

export function isGitHubEmbedUrl(rawUrl) {
  return parseGitHubEmbedUrl(rawUrl) !== null
}

export function isGhCliAvailable() {
  try {
    runGh(['--version'])
    return true
  } catch {
    return false
  }
}

export function fetchGitHubEmbedSnapshot(rawUrl) {
  const target = parseGitHubEmbedUrl(rawUrl)
  if (!target) {
    throw new GitHubEmbedError(
      'unsupported_url',
      'Only GitHub issue, discussion, pull request, and comment URLs are supported.',
      400,
    )
  }

  if (!isGhCliAvailable()) {
    throw new GitHubEmbedError(
      'gh_unavailable',
      'GitHub CLI (gh) is not installed. Install it to enable GitHub embeds.',
      503,
    )
  }

  try {
    if (target.kind === 'issue') {
      const issue = runGhApi(`repos/${target.owner}/${target.repo}/issues/${target.number}`, { withHtml: true })
      return buildIssueSnapshot(target, issue)
    }

    if (target.kind === 'pull_request') {
      const pr = runGhApi(`repos/${target.owner}/${target.repo}/pulls/${target.number}`, { withHtml: true })
      return buildPullRequestSnapshot(target, pr)
    }

    if (target.kind === 'discussion') {
      const discussion = fetchDiscussion(target)
      return buildDiscussionSnapshot(target, discussion)
    }

    if (target.parentKind === 'issue') {
      const comment = runGhApi(`repos/${target.owner}/${target.repo}/issues/comments/${target.commentId}`, { withHtml: true })
      assertIssueCommentParent(target, comment)
      const issue = runGhApi(`repos/${target.owner}/${target.repo}/issues/${target.number}`, { withHtml: true })
      return buildIssueCommentSnapshot(target, comment, issue)
    }

    if (target.parentKind === 'pull_request') {
      const endpoint = target.commentSubKind === 'review_comment'
        ? `repos/${target.owner}/${target.repo}/pulls/comments/${target.commentId}`
        : `repos/${target.owner}/${target.repo}/issues/comments/${target.commentId}`
      const comment = runGhApi(endpoint, { withHtml: true })
      assertPullRequestCommentParent(target, comment)
      const pr = runGhApi(`repos/${target.owner}/${target.repo}/pulls/${target.number}`, { withHtml: true })
      return buildPullRequestCommentSnapshot(target, comment, pr)
    }

    const { comment, discussion } = fetchDiscussionComment(target)
    return buildDiscussionCommentSnapshot(target, comment, discussion)
  } catch (error) {
    throw toFriendlyError(error)
  }
}
