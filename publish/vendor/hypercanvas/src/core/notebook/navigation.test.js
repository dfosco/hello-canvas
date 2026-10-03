import { describe, expect, it } from 'vitest'
import {
  applyNavigationOperation,
  createDefaultNavigation,
  normalizeNavigation,
} from './navigation.js'

const pages = [
  { id: 'p1', type: 'prototype' },
  { id: 'c1', type: 'canvas' },
  { id: 's1', type: 'site' },
  { id: 'c2', type: 'canvas' },
]

describe('Notebook navigation layouts', () => {
  it('seeds Type, flat Files, and sectioned Files orders independently', () => {
    const navigation = createDefaultNavigation(pages, {
      legacyGroups: [{ id: 'research', title: 'Research', pageIds: ['c1', 's1'] }],
    })

    expect(navigation).toEqual({
      mode: 'type',
      sectionsEnabled: true,
      type: {
        groups: ['prototype', 'canvas', 'site'],
        order: { prototype: ['p1'], canvas: ['c1', 'c2'], site: ['s1'] },
      },
      files: {
        flatOrder: ['p1', 'c1', 's1', 'c2'],
        entries: [
          { type: 'page', pageId: 'p1' },
          { type: 'section', sectionId: 'research' },
          { type: 'page', pageId: 'c2' },
        ],
        sections: [{ id: 'research', title: 'Research', pageIds: ['c1', 's1'] }],
      },
    })
  })

  it('returns a complete fallback inventory for missing, duplicate, or nested page references', () => {
    const base = createDefaultNavigation(pages)
    const duplicate = structuredClone(base)
    duplicate.files.flatOrder = ['p1', 'c1', 'c1', 's1']
    const nested = structuredClone(base)
    nested.files.entries = [{ type: 'section', sectionId: 'missing' }]

    for (const malformed of [
      { ...base, files: { ...base.files, flatOrder: ['p1'] } },
      duplicate,
      nested,
    ]) {
      const result = normalizeNavigation(malformed, pages)
      expect(result.valid).toBe(false)
      expect(result.diagnostic.code).toBe('INVALID_NAVIGATION')
      expect(result.navigation.files.flatOrder).toEqual(pages.map(page => page.id))
      expect(result.navigation.type.order.canvas).toEqual(['c1', 'c2'])
    }
  })

  it('keeps Type, flat Files, and sectioned Files moves isolated', () => {
    const base = createDefaultNavigation(pages)
    const type = applyNavigationOperation(base, pages, { type: 'movePage', layout: 'type', pageId: 'c2', index: 0 })
    const flat = applyNavigationOperation(base, pages, { type: 'movePage', layout: 'filesFlat', pageId: 'c2', index: 0 })
    const sectioned = applyNavigationOperation(base, pages, { type: 'movePage', layout: 'filesSections', pageId: 'c2', index: 0 })

    expect(type.type.order.canvas).toEqual(['c2', 'c1'])
    expect(type.files.flatOrder).toEqual(base.files.flatOrder)
    expect(flat.files.flatOrder).toEqual(['c2', 'p1', 'c1', 's1'])
    expect(flat.type).toEqual(base.type)
    expect(sectioned.files.entries[0]).toEqual({ type: 'page', pageId: 'c2' })
    expect(sectioned.files.entries.slice(1)).toEqual(base.files.entries.filter(entry => entry.pageId !== 'c2'))
  })

  it('rejects moving a page into a different Type group', () => {
    expect(() => applyNavigationOperation(createDefaultNavigation(pages), pages, {
      type: 'movePage', layout: 'type', pageId: 'c1', targetType: 'prototype', index: 0,
    })).toThrow(/different Type group/)
  })

  it('allows mixed-type sections, reorders root entries, and unwraps pages on removal', () => {
    let navigation = createDefaultNavigation(pages)
    navigation = applyNavigationOperation(navigation, pages, { type: 'createSection', sectionId: 'mixed', title: 'Mixed', index: 1 })
    navigation = applyNavigationOperation(navigation, pages, { type: 'movePage', layout: 'filesSections', pageId: 's1', sectionId: 'mixed', index: 0 })
    navigation = applyNavigationOperation(navigation, pages, { type: 'movePage', layout: 'filesSections', pageId: 'c1', sectionId: 'mixed', index: 1 })
    navigation = applyNavigationOperation(navigation, pages, { type: 'moveSection', sectionId: 'mixed', index: 0 })

    expect(normalizeNavigation(navigation, pages).valid).toBe(true)
    expect(navigation.files.entries[0]).toEqual({ type: 'section', sectionId: 'mixed' })
    expect(navigation.files.sections[0].pageIds).toEqual(['s1', 'c1'])

    navigation = applyNavigationOperation(navigation, pages, { type: 'removeSection', sectionId: 'mixed' })
    expect(navigation.files.entries.slice(0, 2)).toEqual([
      { type: 'page', pageId: 's1' },
      { type: 'page', pageId: 'c1' },
    ])
    expect(navigation.files.sections).toEqual([])
  })

  it('preserves section membership when section display is disabled', () => {
    let navigation = createDefaultNavigation(pages, {
      legacyGroups: [{ id: 'research', title: 'Research', pageIds: ['c1', 's1'] }],
    })
    navigation = applyNavigationOperation(navigation, pages, { type: 'setSectionsEnabled', enabled: false })
    expect(navigation.sectionsEnabled).toBe(false)
    expect(navigation.files.sections[0].pageIds).toEqual(['c1', 's1'])

    navigation = applyNavigationOperation(navigation, pages, { type: 'setSectionsEnabled', enabled: true })
    expect(navigation.files.sections[0].pageIds).toEqual(['c1', 's1'])
  })
})
