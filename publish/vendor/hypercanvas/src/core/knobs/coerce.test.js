import { coerceByType } from './coerce.js'

describe('coerceByType', () => {
  it('returns text values as-is', () => {
    expect(coerceByType('hello', { type: 'text' })).toBe('hello')
    expect(coerceByType('hello\nworld', { type: 'textarea' })).toBe('hello\nworld')
  })

  it('coerces number and slider values', () => {
    expect(coerceByType('42', { type: 'number' })).toBe(42)
    expect(coerceByType('3.5', { type: 'slider' })).toBe(3.5)
    expect(coerceByType('nope', { type: 'number' })).toBeUndefined()
  })

  it('coerces booleans from true and false strings only', () => {
    expect(coerceByType('true', { type: 'boolean' })).toBe(true)
    expect(coerceByType('false', { type: 'boolean' })).toBe(false)
    expect(coerceByType('1', { type: 'boolean' })).toBeUndefined()
  })

  it('accepts select and radio values only when declared in options', () => {
    const def = { type: 'select', options: ['small', 'large'] }
    expect(coerceByType('large', def)).toBe('large')
    expect(coerceByType('medium', def)).toBeUndefined()
    expect(coerceByType('small', { type: 'radio', options: [{ value: 'small' }] })).toBe('small')
  })

  it('coerces range values into numeric tuples', () => {
    expect(coerceByType('1,5', { type: 'range' })).toEqual([1, 5])
    expect(coerceByType('1,nope', { type: 'range' })).toBeUndefined()
    expect(coerceByType('1,2,3', { type: 'range' })).toBeUndefined()
  })

  it('validates ISO date strings', () => {
    expect(coerceByType('2026-06-06', { type: 'date' })).toBe('2026-06-06')
    expect(coerceByType('2026-02-31', { type: 'date' })).toBeUndefined()
    expect(coerceByType('06/06/2026', { type: 'date' })).toBeUndefined()
  })

  it('coerces string arrays as text or numbers', () => {
    expect(coerceByType('["a","b"]', { type: 'string-array' })).toEqual(['a', 'b'])
    expect(coerceByType('["1","2"]', { type: 'string-array', itemType: 'number' })).toEqual([1, 2])
    expect(coerceByType('[1,2]', { type: 'string-array' })).toBeUndefined()
  })

  it('returns undefined for missing, object, and unknown values', () => {
    expect(coerceByType(undefined, { type: 'text' })).toBeUndefined()
    expect(coerceByType('{"a":1}', { type: 'object' })).toBeUndefined()
    expect(coerceByType('x', { type: 'unknown' })).toBeUndefined()
  })
})
