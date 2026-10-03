import { describe, it, expect } from 'vitest'
import { scoreMatch, fuzzySearch } from './fuzzySearch.js'

describe('scoreMatch', () => {
  it('returns 0 for empty query', () => {
    expect(scoreMatch('hello', '')).toBe(0)
  })

  it('returns -1 for empty text', () => {
    expect(scoreMatch('', 'hello')).toBe(-1)
  })

  it('scores exact prefix highest', () => {
    const score = scoreMatch('Dashboard', 'dash')
    expect(score).toBeGreaterThan(75)
  })

  it('scores word-boundary match above substring', () => {
    const boundary = scoreMatch('my-dashboard', 'dash')
    const substring = scoreMatch('syndashboard', 'dash')
    expect(boundary).toBeGreaterThan(substring)
  })

  it('scores substring match above fuzzy', () => {
    const sub = scoreMatch('syndashboard', 'dash')
    const fuzzy = scoreMatch('directories and shared hosting', 'dash')
    expect(sub).toBeGreaterThan(fuzzy)
  })

  it('returns -1 when fuzzy match fails', () => {
    expect(scoreMatch('hello', 'xyz')).toBe(-1)
  })

  it('handles case-insensitive matching', () => {
    expect(scoreMatch('Dashboard', 'dashboard')).toBeGreaterThan(0)
  })

  it('matches at various word boundaries', () => {
    expect(scoreMatch('src/components/Button', 'button')).toBeGreaterThan(0)
    expect(scoreMatch('some_thing_here', 'thing')).toBeGreaterThan(0)
    expect(scoreMatch('my.config.file', 'config')).toBeGreaterThan(0)
  })

  it('penalizes large gaps in fuzzy matching', () => {
    const tight = scoreMatch('abc', 'abc')
    const loose = scoreMatch('a----b----c', 'abc')
    expect(tight).toBeGreaterThan(loose)
  })
})

describe('fuzzySearch', () => {
  const items = [
    { label: 'Dashboard' },
    { label: 'Settings' },
    { label: 'User Profile' },
    { label: 'Go to Viewfinder' },
    { label: 'DevTools' },
  ]

  it('returns all items for empty query (up to max)', () => {
    const results = fuzzySearch(items, '')
    expect(results).toHaveLength(items.length)
    expect(results[0].score).toBe(0)
  })

  it('filters to matching items', () => {
    const results = fuzzySearch(items, 'dash')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].item.label).toBe('Dashboard')
  })

  it('ranks prefix matches above others', () => {
    const items2 = [
      { label: 'Find Dashboard' },
      { label: 'Dashboard Overview' },
    ]
    const results = fuzzySearch(items2, 'dash')
    expect(results[0].item.label).toBe('Dashboard Overview')
  })

  it('respects maxResults', () => {
    const results = fuzzySearch(items, '', { maxResults: 2 })
    expect(results).toHaveLength(2)
  })

  it('supports custom key', () => {
    const data = [{ name: 'Alpha' }, { name: 'Beta' }]
    const results = fuzzySearch(data, 'alp', { key: 'name' })
    expect(results).toHaveLength(1)
    expect(results[0].item.name).toBe('Alpha')
  })

  it('produces deterministic ranking for equal scores', () => {
    const data = [
      { label: 'aaa' },
      { label: 'aab' },
      { label: 'aac' },
    ]
    const r1 = fuzzySearch(data, 'aa')
    const r2 = fuzzySearch(data, 'aa')
    expect(r1.map(r => r.item.label)).toEqual(r2.map(r => r.item.label))
  })

  it('skips items with missing label', () => {
    const data = [{ label: 'Valid' }, { other: 'no-label' }]
    const results = fuzzySearch(data, 'val')
    expect(results).toHaveLength(1)
  })

  it('ranks agent keyword matches above fuzzy component matches for "cop"', () => {
    const data = [
      { label: 'Component add widget create component component' },
      { label: 'Agent add widget create agent copilot Copilot CLI' },
    ]
    const results = fuzzySearch(data, 'cop')
    expect(results[0].item.label).toContain('Agent')
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })
})
