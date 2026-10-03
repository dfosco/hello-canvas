/**
 * Tests for CodePen URL utilities.
 */
import { describe, it, expect } from 'vitest'
import { isCodePenUrl, toCodePenEmbedUrl, getCodePenTitle, getCodePenUser } from './codepenUrl.js'

describe('isCodePenUrl', () => {
  it('returns true for pen URLs', () => {
    expect(isCodePenUrl('https://codepen.io/Calleb/pen/jEMXgvq')).toBe(true)
  })

  it('returns true for full view URLs', () => {
    expect(isCodePenUrl('https://codepen.io/Calleb/full/jEMXgvq')).toBe(true)
  })

  it('returns true for details URLs', () => {
    expect(isCodePenUrl('https://codepen.io/Calleb/details/jEMXgvq')).toBe(true)
  })

  it('returns true for embed URLs', () => {
    expect(isCodePenUrl('https://codepen.io/Calleb/embed/jEMXgvq')).toBe(true)
  })

  it('returns false for non-CodePen URLs', () => {
    expect(isCodePenUrl('https://example.com')).toBe(false)
    expect(isCodePenUrl('https://figma.com/design/abc')).toBe(false)
  })

  it('returns false for CodePen homepage', () => {
    expect(isCodePenUrl('https://codepen.io')).toBe(false)
    expect(isCodePenUrl('https://codepen.io/Calleb')).toBe(false)
  })

  it('returns false for null/empty', () => {
    expect(isCodePenUrl(null)).toBe(false)
    expect(isCodePenUrl('')).toBe(false)
  })
})

describe('toCodePenEmbedUrl', () => {
  it('converts pen URL to embed format', () => {
    const result = toCodePenEmbedUrl('https://codepen.io/Calleb/pen/jEMXgvq')
    expect(result).toBe('https://codepen.io/Calleb/embed/jEMXgvq?default-tab=result&editable=true')
  })

  it('converts full URL to embed format', () => {
    const result = toCodePenEmbedUrl('https://codepen.io/Calleb/full/jEMXgvq')
    expect(result).toBe('https://codepen.io/Calleb/embed/jEMXgvq?default-tab=result&editable=true')
  })

  it('returns empty string for invalid URL', () => {
    expect(toCodePenEmbedUrl('https://example.com')).toBe('')
    expect(toCodePenEmbedUrl(null)).toBe('')
  })
})

describe('getCodePenTitle', () => {
  it('extracts user/penId from URL', () => {
    expect(getCodePenTitle('https://codepen.io/Calleb/pen/jEMXgvq')).toBe('Calleb/jEMXgvq')
  })

  it('returns "CodePen" for invalid URL', () => {
    expect(getCodePenTitle('https://example.com')).toBe('CodePen')
    expect(getCodePenTitle(null)).toBe('CodePen')
  })
})

describe('getCodePenUser', () => {
  it('extracts username', () => {
    expect(getCodePenUser('https://codepen.io/Calleb/pen/jEMXgvq')).toBe('Calleb')
  })

  it('returns empty for invalid URL', () => {
    expect(getCodePenUser('https://example.com')).toBe('')
  })
})
