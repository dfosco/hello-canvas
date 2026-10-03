import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { seedTestData, TEST_RECORDS } from '../../test-utils.js'
import { activateHideMode, setShadow, init } from '../../core/index.js'
import { StoryboardContext } from '../StoryboardContext.js'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: vi.fn(() => ({})) }
})
import { useParams } from 'react-router-dom'

import { useRecord, useRecords } from './useRecord.js'

beforeEach(() => {
  seedTestData()
  useParams.mockReturnValue({})
})

/**
 * Create a wrapper that provides StoryboardContext with a prototypeName,
 * used for testing scoped (prototype-level) records.
 */
function createPrototypeWrapper(prototypeName) {
  return function Wrapper({ children }) {
    return React.createElement(
      StoryboardContext.Provider,
      { value: { data: {}, prototypeName } },
      children,
    )
  }
}

// ── useRecord ──

describe('useRecord', () => {
  it('returns null when no URL param matches', () => {
    const { result } = renderHook(() => useRecord('posts'))
    expect(result.current).toBeNull()
  })

  it('returns matching record entry when param is set', () => {
    useParams.mockReturnValue({ id: 'post-1' })
    const { result } = renderHook(() => useRecord('posts'))
    expect(result.current).toEqual(TEST_RECORDS.posts[0])
  })

  it('returns null when param value does not match any entry', () => {
    useParams.mockReturnValue({ id: 'nonexistent' })
    const { result } = renderHook(() => useRecord('posts'))
    expect(result.current).toBeNull()
  })

  it('defaults paramName to id', () => {
    useParams.mockReturnValue({ id: 'post-2' })
    const { result } = renderHook(() => useRecord('posts'))
    expect(result.current).toEqual(TEST_RECORDS.posts[1])
  })

  it('returns null gracefully when record collection does not exist', () => {
    useParams.mockReturnValue({ id: 'post-1' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useRecord('nonexistent'))
    expect(result.current).toBeNull()
    console.error.mockRestore()
  })
})

// ── useRecords ──

describe('useRecords', () => {
  it('returns all entries from a record collection', () => {
    const { result } = renderHook(() => useRecords('posts'))
    expect(result.current).toEqual(TEST_RECORDS.posts)
  })

  it('returns empty array when record does not exist', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useRecords('nonexistent'))
    expect(result.current).toEqual([])
    console.error.mockRestore()
  })

  it('applies hash overrides to existing entries', () => {
    window.location.hash = 'record.posts.post-1.title=Updated'
    const { result } = renderHook(() => useRecords('posts'))
    const post1 = result.current.find(e => e.id === 'post-1')
    expect(post1.title).toBe('Updated')
  })

  it('creates new entries from hash overrides', () => {
    window.location.hash = 'record.posts.new-post.title=New'
    const { result } = renderHook(() => useRecords('posts'))
    const newPost = result.current.find(e => e.id === 'new-post')
    expect(newPost).toBeTruthy()
    expect(newPost.title).toBe('New')
  })
})

// ── Hide mode ──

describe('useRecord (hide mode)', () => {
  beforeEach(() => {
    act(() => { activateHideMode() })
  })

  it('reads overrides from localStorage shadow in hide mode', () => {
    useParams.mockReturnValue({ id: 'post-1' })
    act(() => { setShadow('record.posts.post-1.title', 'Shadow Title') })

    const { result } = renderHook(() => useRecord('posts'))
    expect(result.current.title).toBe('Shadow Title')
  })

  it('reactively updates when shadow changes in hide mode', () => {
    useParams.mockReturnValue({ id: 'post-1' })
    const { result } = renderHook(() => useRecord('posts'))
    expect(result.current.title).toBe('First Post')

    act(() => { setShadow('record.posts.post-1.title', 'Updated via Shadow') })
    expect(result.current.title).toBe('Updated via Shadow')
  })
})

describe('useRecords (hide mode)', () => {
  beforeEach(() => {
    act(() => { activateHideMode() })
  })

  it('applies shadow overrides to existing entries', () => {
    act(() => { setShadow('record.posts.post-1.title', 'Hidden Update') })

    const { result } = renderHook(() => useRecords('posts'))
    const post1 = result.current.find(e => e.id === 'post-1')
    expect(post1.title).toBe('Hidden Update')
  })

  it('creates new entries from shadow overrides', () => {
    act(() => { setShadow('record.posts.shadow-post.title', 'New Shadow') })

    const { result } = renderHook(() => useRecords('posts'))
    const newPost = result.current.find(e => e.id === 'shadow-post')
    expect(newPost).toBeTruthy()
    expect(newPost.title).toBe('New Shadow')
  })
})

// ── Scoped (prototype) records ──

const SCOPED_RECORDS = {
  'security/rules': [
    { id: 'constant-condition', title: 'Constant Condition', state: 'open' },
    { id: 'unused-var', title: 'Unused Variable', state: 'open' },
  ],
}

function seedScopedData() {
  init({
    flows: {},
    objects: {},
    records: SCOPED_RECORDS,
  })
}

describe('useRecords (scoped records)', () => {
  beforeEach(() => {
    seedScopedData()
    window.location.hash = ''
  })

  it('applies overrides written with the plain (unscoped) record name', () => {
    // Callers write: record.rules.constant-condition.state=dismissed
    // Reader resolves to "security/rules" — this was the bug
    window.location.hash = 'record.rules.constant-condition.state=dismissed'

    const wrapper = createPrototypeWrapper('security')
    const { result } = renderHook(() => useRecords('rules'), { wrapper })

    const rule = result.current.find(e => e.id === 'constant-condition')
    expect(rule.state).toBe('dismissed')
  })

  it('applies overrides written with the resolved (scoped) record name', () => {
    window.location.hash = 'record.security/rules.constant-condition.state=dismissed'

    const wrapper = createPrototypeWrapper('security')
    const { result } = renderHook(() => useRecords('rules'), { wrapper })

    const rule = result.current.find(e => e.id === 'constant-condition')
    expect(rule.state).toBe('dismissed')
  })

  it('merges overrides from both plain and scoped prefixes', () => {
    window.location.hash =
      'record.rules.constant-condition.state=dismissed' +
      '&record.security/rules.unused-var.state=resolved'

    const wrapper = createPrototypeWrapper('security')
    const { result } = renderHook(() => useRecords('rules'), { wrapper })

    expect(result.current.find(e => e.id === 'constant-condition').state).toBe('dismissed')
    expect(result.current.find(e => e.id === 'unused-var').state).toBe('resolved')
  })
})

describe('useRecord (scoped records)', () => {
  beforeEach(() => {
    seedScopedData()
    window.location.hash = ''
    useParams.mockReturnValue({ id: 'constant-condition' })
  })

  it('applies overrides written with the plain (unscoped) record name', () => {
    window.location.hash = 'record.rules.constant-condition.state=dismissed'

    const wrapper = createPrototypeWrapper('security')
    const { result } = renderHook(() => useRecord('rules'), { wrapper })

    expect(result.current.state).toBe('dismissed')
  })
})
