import { getByPath, setByPath, deepClone } from './dotPath.js'

describe('getByPath', () => {
  it('resolves nested paths', () => {
    const obj = { a: { b: { c: 42 } } }
    expect(getByPath(obj, 'a.b.c')).toBe(42)
  })

  it('resolves array indices', () => {
    const obj = { items: ['zero', 'one', 'two'] }
    expect(getByPath(obj, 'items.0')).toBe('zero')
    expect(getByPath(obj, 'items.2')).toBe('two')
  })

  it('returns undefined for missing segments', () => {
    const obj = { a: { b: 1 } }
    expect(getByPath(obj, 'a.x.y')).toBeUndefined()
  })

  it('returns undefined for null obj', () => {
    expect(getByPath(null, 'a')).toBeUndefined()
  })

  it('returns undefined for undefined obj', () => {
    expect(getByPath(undefined, 'a')).toBeUndefined()
  })

  it('returns undefined for empty string path', () => {
    expect(getByPath({ a: 1 }, '')).toBeUndefined()
  })

  it('returns undefined for non-string path', () => {
    expect(getByPath({ a: 1 }, 123)).toBeUndefined()
    expect(getByPath({ a: 1 }, null)).toBeUndefined()
  })

  it('works with single-segment path', () => {
    expect(getByPath({ foo: 'bar' }, 'foo')).toBe('bar')
  })
})

describe('setByPath', () => {
  it('sets nested value (mutates)', () => {
    const obj = { a: { b: { c: 1 } } }
    setByPath(obj, 'a.b.c', 99)
    expect(obj.a.b.c).toBe(99)
  })

  it('auto-creates intermediate objects', () => {
    const obj = {}
    setByPath(obj, 'a.b.c', 'hello')
    expect(obj.a.b.c).toBe('hello')
  })

  it('auto-creates arrays when next segment is numeric', () => {
    const obj = {}
    setByPath(obj, 'items.0', 'first')
    expect(Array.isArray(obj.items)).toBe(true)
    expect(obj.items[0]).toBe('first')
  })

  it('overwrites existing values', () => {
    const obj = { a: { b: 'old' } }
    setByPath(obj, 'a.b', 'new')
    expect(obj.a.b).toBe('new')
  })

  it('works with single-segment path', () => {
    const obj = {}
    setByPath(obj, 'x', 42)
    expect(obj.x).toBe(42)
  })
})

describe('deepClone', () => {
  it('clones plain objects', () => {
    const obj = { a: 1, b: 'two' }
    const clone = deepClone(obj)
    expect(clone).toEqual(obj)
    expect(clone).not.toBe(obj)
  })

  it('clones arrays', () => {
    const arr = [1, 2, 3]
    const clone = deepClone(arr)
    expect(clone).toEqual(arr)
    expect(clone).not.toBe(arr)
  })

  it('clones nested objects and arrays', () => {
    const val = { a: [1, { b: 2 }], c: { d: [3] } }
    const clone = deepClone(val)
    expect(clone).toEqual(val)
    expect(clone.a).not.toBe(val.a)
    expect(clone.a[1]).not.toBe(val.a[1])
    expect(clone.c).not.toBe(val.c)
    expect(clone.c.d).not.toBe(val.c.d)
  })

  it('returns primitives as-is', () => {
    expect(deepClone(42)).toBe(42)
    expect(deepClone('hello')).toBe('hello')
    expect(deepClone(true)).toBe(true)
    expect(deepClone(null)).toBe(null)
    expect(deepClone(undefined)).toBe(undefined)
  })

  it('cloned object is independent (mutations do not propagate)', () => {
    const original = { a: { b: 1 } }
    const clone = deepClone(original)
    clone.a.b = 999
    expect(original.a.b).toBe(1)
  })
})
