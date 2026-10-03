import { describe, expect, it } from 'vitest'
import { resolveBasePathAsset } from './basePathAsset.js'

describe('resolveBasePathAsset', () => {
  it('keeps relative assets under project and branch deployment bases', () => {
    expect(resolveBasePathAsset('assets/canvas/images/demo.png', '/')).toBe('/assets/canvas/images/demo.png')
    expect(resolveBasePathAsset('/assets/canvas/images/demo.png', '/branch--preview/repo/'))
      .toBe('/branch--preview/repo/assets/canvas/images/demo.png')
    expect(resolveBasePathAsset('assets/demo.png', './')).toBe('./assets/demo.png')
  })

  it('leaves absolute URLs intact and handles missing values', () => {
    expect(resolveBasePathAsset('https://example.test/demo.png', '/repo/')).toBe('https://example.test/demo.png')
    expect(resolveBasePathAsset('data:image/png;base64,abc', '/repo/')).toBe('data:image/png;base64,abc')
    expect(resolveBasePathAsset(undefined, '/repo/')).toBe('')
  })
})
