import {
  isCommentModeActive,
  toggleCommentMode,
  setCommentMode,
  subscribeToCommentMode,
} from './commentMode.js'
import { initCommentsConfig } from './config.js'
import { setToken, clearToken } from './auth.js'

describe('commentMode', () => {
  beforeEach(() => {
    // Reset state
    setCommentMode(false)
    clearToken()
    initCommentsConfig(null)
  })

  it('starts inactive', () => {
    setCommentMode(false)
    expect(isCommentModeActive()).toBe(false)
  })

  it('setCommentMode activates and deactivates', () => {
    setCommentMode(true)
    expect(isCommentModeActive()).toBe(true)
    setCommentMode(false)
    expect(isCommentModeActive()).toBe(false)
  })

  it('toggleCommentMode returns false when comments not enabled', () => {
    const result = toggleCommentMode()
    expect(result).toBe(false)
    expect(isCommentModeActive()).toBe(false)
  })

  it('toggleCommentMode returns false when not authenticated', () => {
    initCommentsConfig({
      comments: { discussions: { category: 'Test' } },
      repository: { owner: 'o', name: 'r' },
    })
    const result = toggleCommentMode()
    expect(result).toBe(false)
    expect(isCommentModeActive()).toBe(false)
  })

  it('toggleCommentMode activates when enabled and authenticated', () => {
    initCommentsConfig({
      comments: { discussions: { category: 'Test' } },
      repository: { owner: 'o', name: 'r' },
    })
    setToken('ghp_test')
    const result = toggleCommentMode()
    expect(result).toBe(true)
    expect(isCommentModeActive()).toBe(true)
  })

  it('toggleCommentMode toggles off when active', () => {
    initCommentsConfig({
      comments: { discussions: { category: 'Test' } },
      repository: { owner: 'o', name: 'r' },
    })
    setToken('ghp_test')
    toggleCommentMode() // on
    const result = toggleCommentMode() // off
    expect(result).toBe(false)
    expect(isCommentModeActive()).toBe(false)
  })

  it('subscribeToCommentMode calls callback on changes', () => {
    const calls = []
    subscribeToCommentMode((active) => calls.push(active))

    setCommentMode(true)
    setCommentMode(false)
    setCommentMode(true)

    expect(calls).toEqual([true, false, true])
  })

  it('subscribeToCommentMode returns unsubscribe function', () => {
    const calls = []
    const unsub = subscribeToCommentMode((active) => calls.push(active))

    setCommentMode(true)
    unsub()
    setCommentMode(false)

    expect(calls).toEqual([true])
  })
})
