import { describe, expect, it } from 'vitest'
import { stripHash, isSameIframeDocument } from './iframeSrcCompare.js'

describe('stripHash', () => {
  it('returns empty string for null/undefined/empty inputs', () => {
    expect(stripHash(null)).toBe('')
    expect(stripHash(undefined)).toBe('')
    expect(stripHash('')).toBe('')
  })

  it('returns the URL unchanged when there is no hash', () => {
    expect(stripHash('/foo')).toBe('/foo')
    expect(stripHash('/foo?bar=baz')).toBe('/foo?bar=baz')
    expect(stripHash('https://example.com/foo?bar=baz')).toBe('https://example.com/foo?bar=baz')
  })

  it('strips a trailing hash fragment', () => {
    expect(stripHash('/foo#bar')).toBe('/foo')
    expect(stripHash('/foo?a=1#bar=2')).toBe('/foo?a=1')
    expect(stripHash('https://example.com/foo#section')).toBe('https://example.com/foo')
  })

  it('strips an empty hash', () => {
    expect(stripHash('/foo#')).toBe('/foo')
  })
})

describe('isSameIframeDocument', () => {
  it('treats identical URLs as the same document', () => {
    expect(isSameIframeDocument('/foo?bar=baz', '/foo?bar=baz')).toBe(true)
  })

  it('treats two URLs differing only in the hash as the same document', () => {
    expect(isSameIframeDocument('/foo', '/foo#bar')).toBe(true)
    expect(isSameIframeDocument('/foo#a=1', '/foo#a=2')).toBe(true)
    expect(
      isSameIframeDocument(
        '/SiloDashboard?flow=SiloDashboard%2Fdefault&_sb_embed#view=projects',
        '/SiloDashboard?flow=SiloDashboard%2Fdefault&_sb_embed#view=projects&projects.menuOpen=mock-project',
      ),
    ).toBe(true)
  })

  it('treats URLs with different paths as different documents', () => {
    expect(isSameIframeDocument('/foo', '/bar')).toBe(false)
    expect(isSameIframeDocument('/foo#x', '/bar#x')).toBe(false)
  })

  it('treats URLs with different search params as different documents', () => {
    expect(isSameIframeDocument('/foo?a=1', '/foo?a=2')).toBe(false)
    expect(isSameIframeDocument('/foo?flow=a#x', '/foo?flow=b#x')).toBe(false)
  })

  it('treats null/undefined vs a real URL as different documents (spinner shows on first load)', () => {
    expect(isSameIframeDocument(null, '/foo')).toBe(false)
    expect(isSameIframeDocument(undefined, '/foo')).toBe(false)
    expect(isSameIframeDocument('', '/foo')).toBe(false)
  })

  it('treats two null/empty inputs as the same (both "no document")', () => {
    expect(isSameIframeDocument(null, null)).toBe(true)
    expect(isSameIframeDocument(undefined, undefined)).toBe(true)
    expect(isSameIframeDocument(null, '')).toBe(true)
  })
})
