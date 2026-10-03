import { initCommentsConfig, getCommentsConfig, isCommentsEnabled } from './config.js'

describe('initCommentsConfig', () => {
  beforeEach(() => {
    // Reset config state
    initCommentsConfig(null)
  })

  it('initializes config from valid rawConfig', () => {
    initCommentsConfig({
      repository: { owner: 'dfosco', name: 'storyboard' },
      comments: {
        discussions: { category: 'Comments' },
      },
    })
    const config = getCommentsConfig()
    expect(config).toEqual({
      repo: { owner: 'dfosco', name: 'storyboard' },
      discussions: { category: 'Comments' },
      basePath: '/',
    })
  })

  it('uses default category when not provided', () => {
    initCommentsConfig({
      repository: { owner: 'owner', name: 'repo' },
      comments: {},
    })
    const config = getCommentsConfig()
    expect(config.discussions.category).toBe('Storyboard Comments')
  })

  it('sets config to null when rawConfig is null', () => {
    initCommentsConfig(null)
    expect(getCommentsConfig()).toBeNull()
  })

  it('sets config to null when rawConfig has no comments key', () => {
    initCommentsConfig({ other: 'stuff' })
    expect(getCommentsConfig()).toBeNull()
  })

  it('handles missing repository fields gracefully', () => {
    initCommentsConfig({ comments: {} })
    const config = getCommentsConfig()
    expect(config.repo.owner).toBe('')
    expect(config.repo.name).toBe('')
  })
})

describe('isCommentsEnabled', () => {
  beforeEach(() => {
    initCommentsConfig(null)
  })

  it('returns false when config is null', () => {
    expect(isCommentsEnabled()).toBe(false)
  })

  it('returns false when owner is empty', () => {
    initCommentsConfig({ repository: { owner: '', name: 'repo' }, comments: {} })
    expect(isCommentsEnabled()).toBe(false)
  })

  it('returns false when name is empty', () => {
    initCommentsConfig({ repository: { owner: 'owner', name: '' }, comments: {} })
    expect(isCommentsEnabled()).toBe(false)
  })

  it('returns true when both owner and name are set', () => {
    initCommentsConfig({
      repository: { owner: 'dfosco', name: 'storyboard' },
      comments: {},
    })
    expect(isCommentsEnabled()).toBe(true)
  })
})
