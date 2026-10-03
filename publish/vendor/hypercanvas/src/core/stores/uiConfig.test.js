import { initUIConfig, isMenuHidden, getHiddenItems, _resetUIConfig } from './uiConfig.js'

afterEach(() => {
  _resetUIConfig()
})

describe('initUIConfig', () => {
  it('starts with no hidden items', () => {
    expect(getHiddenItems()).toEqual([])
  })

  it('accepts a hide array', () => {
    initUIConfig({ hide: ['docs', 'comments'] })
    expect(getHiddenItems()).toEqual(['docs', 'comments'])
  })

  it('handles empty config', () => {
    initUIConfig({})
    expect(getHiddenItems()).toEqual([])
  })

  it('handles no args', () => {
    initUIConfig()
    expect(getHiddenItems()).toEqual([])
  })

  it('replaces previous config on re-init', () => {
    initUIConfig({ hide: ['docs'] })
    initUIConfig({ hide: ['inspector'] })
    expect(getHiddenItems()).toEqual(['inspector'])
  })
})

describe('isMenuHidden', () => {
  it('returns false for non-hidden menus', () => {
    initUIConfig({ hide: ['docs'] })
    expect(isMenuHidden('inspector')).toBe(false)
  })

  it('returns true for hidden menus', () => {
    initUIConfig({ hide: ['docs', 'comments'] })
    expect(isMenuHidden('docs')).toBe(true)
    expect(isMenuHidden('comments')).toBe(true)
  })

  it('returns false when no config is set', () => {
    expect(isMenuHidden('docs')).toBe(false)
  })

  it('can hide the command menu', () => {
    initUIConfig({ hide: ['command'] })
    expect(isMenuHidden('command')).toBe(true)
  })
})

describe('_resetUIConfig', () => {
  it('clears all hidden items', () => {
    initUIConfig({ hide: ['docs', 'inspector', 'create'] })
    _resetUIConfig()
    expect(getHiddenItems()).toEqual([])
    expect(isMenuHidden('docs')).toBe(false)
  })
})
