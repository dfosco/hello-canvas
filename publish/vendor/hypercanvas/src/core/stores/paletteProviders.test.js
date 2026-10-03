import { describe, it, expect, vi } from 'vitest'

// Mock loader and workspace before importing providers
vi.mock('../data/loader.js', () => ({
  listStories: vi.fn(() => ['button', 'card']),
  getStoryData: vi.fn((name) => ({
    button: { _route: '/components/button', _storyModule: '/src/button.story.jsx' },
    card: { _route: '/components/card', _storyModule: '/src/card.story.jsx' },
  })[name] || null),
  listFlows: vi.fn(() => ['MyProto/default', 'MyProto/dark', 'global-flow']),
  loadFlow: vi.fn((name) => ({
    'MyProto/default': { _route: '/MyProto', meta: { default: true } },
    'MyProto/dark': { _route: '/MyProto', meta: {} },
    'global-flow': { _route: '/', meta: {} },
  })[name] || null),
  listPrototypes: vi.fn(() => ['MyProto', 'ExternalApp']),
  getPrototypeMetadata: vi.fn((name) => ({
    MyProto: { meta: { title: 'My Prototype', author: 'alice' }, folder: null },
    ExternalApp: { meta: { title: 'External App' }, url: 'https://example.com', folder: null },
  })[name] || null),
  listFolders: vi.fn(() => []),
  getFolderMetadata: vi.fn(() => null),
  listCanvases: vi.fn(() => ['design-overview']),
  getCanvasData: vi.fn((name) => ({
    'design-overview': {
      title: 'Design Overview',
      _route: '/canvas/design-overview',
      _canvasMeta: { title: 'Design Overview' },
      _group: null,
      _folder: null,
    },
  })[name] || null),
}))

vi.mock('./commandActions.js', () => ({
  getActionsForMode: vi.fn(() => [
    { id: 'core/workspace', label: 'Go to Workspace', type: 'link', url: '/', toolKey: 'workspace' },
    { id: 'core/docs', label: 'Documentation', type: 'default', toolKey: 'docs' },
    { id: 'core/devtools', label: 'DevTools', type: 'submenu', toolKey: 'devtools' },
    { type: 'header', label: 'Command Menu' },
    { type: 'footer', label: '⌘ + K to open' },
  ]),
  executeAction: vi.fn(),
  getActionChildren: vi.fn((id) => {
    if (id === 'core/devtools') {
      return [
        { id: 'devtools:inspector', label: 'Inspector', execute: vi.fn() },
        { id: 'devtools:network', label: 'Network', execute: vi.fn() },
      ]
    }
    return []
  }),
}))

vi.mock('./toolStateStore.js', () => ({
  getToolbarToolState: vi.fn(() => 'active'),
  isToolbarToolLocalOnly: vi.fn(() => false),
}))

vi.mock('./recentArtifacts.js', () => ({
  getRecent: vi.fn(() => [
    { type: 'prototype', key: 'MyProto', label: 'My Prototype' },
  ]),
  trackRecent: vi.fn(),
  clearRecent: vi.fn(),
}))

import {
  buildCommandItems,
  buildPrototypeItems,
  buildCanvasItems,
  buildStoryItems,
  buildRecentItems,
  buildAllItems,
  searchPalette,
} from './paletteProviders.js'

describe('buildCommandItems', () => {
  it('produces items from resolved actions', () => {
    const items = buildCommandItems('default', '/')
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.category === 'Commands')).toBe(true)
  })

  it('skips structural items (header, separator, footer)', () => {
    const items = buildCommandItems('default', '/')
    expect(items.some(i => i.label === 'Command Menu')).toBe(false)
    expect(items.some(i => i.label === '⌘ + K to open')).toBe(false)
  })

  it('flattens submenu children into individual items', () => {
    const items = buildCommandItems('default', '/')
    expect(items.some(i => i.label === 'Inspector')).toBe(true)
    expect(items.some(i => i.label === 'Network')).toBe(true)
    // The submenu parent should not appear as its own item
    expect(items.some(i => i.label === 'DevTools')).toBe(false)
  })

  it('items have executable actions', () => {
    const items = buildCommandItems('default', '/')
    for (const item of items) {
      expect(typeof item.action).toBe('function')
    }
  })
})

describe('buildPrototypeItems', () => {
  it('includes prototypes from the index', () => {
    const items = buildPrototypeItems('/')
    expect(items.some(i => i.label === 'My Prototype')).toBe(true)
  })

  it('handles external prototypes', () => {
    const items = buildPrototypeItems('/')
    const ext = items.find(i => i.label === 'External App')
    expect(ext).toBeDefined()
  })

  it('sets category to Prototypes', () => {
    const items = buildPrototypeItems('/')
    expect(items.every(i => i.category === 'Prototypes')).toBe(true)
  })
})

describe('buildCanvasItems', () => {
  it('includes canvases from the index', () => {
    const items = buildCanvasItems('/')
    expect(items.some(i => i.label === 'Design Overview')).toBe(true)
  })

  it('sets category to Canvases', () => {
    const items = buildCanvasItems('/')
    expect(items.every(i => i.category === 'Canvases')).toBe(true)
  })
})

describe('buildStoryItems', () => {
  it('includes stories from the data index', () => {
    const items = buildStoryItems('/')
    expect(items).toHaveLength(2)
    expect(items.some(i => i.label === 'button')).toBe(true)
    expect(items.some(i => i.label === 'card')).toBe(true)
  })

  it('sets category to Stories', () => {
    const items = buildStoryItems('/')
    expect(items.every(i => i.category === 'Stories')).toBe(true)
  })
})

describe('buildRecentItems', () => {
  it('includes recent entries', () => {
    const items = buildRecentItems('/')
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('My Prototype')
  })

  it('sets category to Recent', () => {
    const items = buildRecentItems('/')
    expect(items.every(i => i.category === 'Recent')).toBe(true)
  })
})

describe('searchPalette', () => {
  it('shows recent + commands for empty query', () => {
    const dataset = buildAllItems('default', '/')
    const groups = searchPalette(dataset, '')
    expect(groups[0].category).toBe('Recent')
    expect(groups[1].category).toBe('Commands')
  })

  it('filters results by query', () => {
    const dataset = buildAllItems('default', '/')
    const groups = searchPalette(dataset, 'button')
    // Should find the story
    const storyGroup = groups.find(g => g.category === 'Stories')
    expect(storyGroup).toBeDefined()
    expect(storyGroup.items.some(i => i.label === 'button')).toBe(true)
  })

  it('returns empty groups when nothing matches', () => {
    const dataset = buildAllItems('default', '/')
    const groups = searchPalette(dataset, 'zzzznonexistent')
    expect(groups).toHaveLength(0)
  })
})
