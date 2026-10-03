import {
  getLocal,
  setLocal,
  removeLocal,
  getAllLocal,
  subscribeToStorage,
  getStorageSnapshot,
  STORAGE_PREFIX,
} from './localStorage.js'

const P = STORAGE_PREFIX

beforeEach(() => {
  // jsdom's localStorage persists across tests in the same suite.
  localStorage.clear()
})

describe('STORAGE_PREFIX (H7 namespacing)', () => {
  it('is namespaced as storyboard:<devDomain>:<branch>:', () => {
    // jsdom default: hostname=localhost (no devDomain match), BASE_URL=/ (no branch).
    expect(STORAGE_PREFIX).toBe('storyboard:default::')
  })
})

describe('getLocal', () => {
  it('returns null for missing key', () => {
    expect(getLocal('nonexistent')).toBeNull()
  })

  it('reads stored value using P + "" prefix internally', () => {
    localStorage.setItem(P + 'mykey', 'hello')
    expect(getLocal('mykey')).toBe('hello')
  })

  it('returns null if localStorage throws', () => {
    const original = localStorage.getItem
    localStorage.getItem = () => { throw new Error('fail') }
    expect(getLocal('anything')).toBeNull()
    localStorage.getItem = original
  })
})

describe('setLocal', () => {
  it('stores value with prefix', () => {
    setLocal('color', 'blue')
    expect(localStorage.getItem(P + 'color')).toBe('blue')
  })

  it('converts value to string', () => {
    setLocal('num', 42)
    expect(localStorage.getItem(P + 'num')).toBe('42')
  })

  it('dispatches storyboard-storage event on window', () => {
    const cb = vi.fn()
    window.addEventListener('storyboard-storage', cb)
    setLocal('x', '1')
    expect(cb).toHaveBeenCalledTimes(1)
    window.removeEventListener('storyboard-storage', cb)
  })
})

describe('removeLocal', () => {
  it('removes prefixed key', () => {
    setLocal('temp', 'val')
    expect(localStorage.getItem(P + 'temp')).toBe('val')
    removeLocal('temp')
    expect(localStorage.getItem(P + 'temp')).toBeNull()
  })

  it('dispatches storyboard-storage event', () => {
    setLocal('temp', 'val')
    const cb = vi.fn()
    window.addEventListener('storyboard-storage', cb)
    removeLocal('temp')
    expect(cb).toHaveBeenCalled()
    window.removeEventListener('storyboard-storage', cb)
  })
})

describe('getAllLocal', () => {
  it('returns empty object when no storyboard keys', () => {
    expect(getAllLocal()).toEqual({})
  })

  it('returns all prefixed entries with prefix stripped', () => {
    setLocal('a', '1')
    setLocal('b', '2')
    expect(getAllLocal()).toEqual({ a: '1', b: '2' })
  })

  it('ignores non-storyboard keys', () => {
    localStorage.setItem('other-key', 'nope')
    setLocal('only', 'this')
    const result = getAllLocal()
    expect(result).toEqual({ only: 'this' })
    expect(result['other-key']).toBeUndefined()
  })
})

describe('subscribeToStorage', () => {
  it('calls callback on storyboard-storage event', () => {
    const cb = vi.fn()
    const unsub = subscribeToStorage(cb)
    window.dispatchEvent(new Event('storyboard-storage'))
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('calls callback on storage event', () => {
    const cb = vi.fn()
    const unsub = subscribeToStorage(cb)
    window.dispatchEvent(new Event('storage'))
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('returns unsubscribe function that works', () => {
    const cb = vi.fn()
    const unsub = subscribeToStorage(cb)
    unsub()
    window.dispatchEvent(new Event('storyboard-storage'))
    window.dispatchEvent(new Event('storage'))
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('getStorageSnapshot', () => {
  it('returns serialized string of all entries', () => {
    setLocal('z', '3')
    setLocal('a', '1')
    // Force cache invalidation so snapshot recomputes
    window.dispatchEvent(new Event('storyboard-storage'))
    const snap = getStorageSnapshot()
    // Entries are sorted alphabetically
    expect(snap).toBe(P + 'a=1&' + P + 'z=3')
  })

  it('caches result (same reference on repeated calls)', () => {
    setLocal('k', 'v')
    // Invalidate cache first
    window.dispatchEvent(new Event('storyboard-storage'))
    const snap1 = getStorageSnapshot()
    const snap2 = getStorageSnapshot()
    expect(snap1).toBe(snap2)
  })

  it('invalidates cache on storage event', () => {
    setLocal('k', 'v')
    // Subscribe so events invalidate the cache
    const unsub = subscribeToStorage(() => {})

    const snap1 = getStorageSnapshot()
    // Directly mutate localStorage and fire event to invalidate
    localStorage.setItem(P + 'k', 'changed')
    window.dispatchEvent(new Event('storyboard-storage'))
    const snap2 = getStorageSnapshot()

    expect(snap1).not.toBe(snap2)
    expect(snap2).toContain(P + 'k=changed')
    unsub()
  })
})
