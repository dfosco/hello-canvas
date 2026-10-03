import { describe, expect, it } from 'vitest'
import { isGitHubEmbedUrl, parseGitHubUrl } from './githubUrl.js'

describe('parseGitHubUrl', () => {
  it('classifies issue URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/issues/12')).toEqual({
      kind: 'issue',
      parentKind: 'issue',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 12,
    })
  })

  it('classifies discussion URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/discussions/99')).toEqual({
      kind: 'discussion',
      parentKind: 'discussion',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 99,
    })
  })

  it('classifies issue comment URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/issues/12#issuecomment-345')).toEqual({
      kind: 'comment',
      parentKind: 'issue',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 12,
      commentId: 345,
    })
  })

  it('classifies discussion comment URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/discussions/99#discussioncomment-888')).toEqual({
      kind: 'comment',
      parentKind: 'discussion',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 99,
      commentId: 888,
    })
  })

  it('classifies pull request URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/pull/12')).toEqual({
      kind: 'pull_request',
      parentKind: 'pull_request',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 12,
    })
  })

  it('classifies PR top-level comment URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/pull/12#issuecomment-555')).toEqual({
      kind: 'comment',
      parentKind: 'pull_request',
      commentSubKind: 'issue_comment',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 12,
      commentId: 555,
    })
  })

  it('classifies PR inline review comment URLs', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/pull/12#discussion_r777')).toEqual({
      kind: 'comment',
      parentKind: 'pull_request',
      commentSubKind: 'review_comment',
      owner: 'dfosco',
      repo: 'storyboard',
      number: 12,
      commentId: 777,
    })
  })

  it('rejects unsupported paths and hashes', () => {
    expect(parseGitHubUrl('https://github.com/dfosco/storyboard/issues/12#random')).toBeNull()
    expect(parseGitHubUrl('https://example.com/dfosco/storyboard/issues/12')).toBeNull()
    expect(parseGitHubUrl('not a url')).toBeNull()
  })
})

describe('isGitHubEmbedUrl', () => {
  it('returns true for supported GitHub URLs', () => {
    expect(isGitHubEmbedUrl('https://github.com/dfosco/storyboard/issues/12')).toBe(true)
    expect(isGitHubEmbedUrl('https://github.com/dfosco/storyboard/discussions/99#discussioncomment-888')).toBe(true)
    expect(isGitHubEmbedUrl('https://github.com/dfosco/storyboard/pull/1')).toBe(true)
  })

  it('returns false for unsupported URLs', () => {
    expect(isGitHubEmbedUrl('https://example.com')).toBe(false)
  })
})
