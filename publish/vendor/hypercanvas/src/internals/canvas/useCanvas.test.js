import { describe, it, expect } from 'vitest'
import { resolveCanvasModuleImport } from './useCanvas.js'

describe('resolveCanvasModuleImport', () => {
  it('prefixes root-relative module paths with BASE_URL', () => {
    expect(resolveCanvasModuleImport('/src/canvas/button-patterns.story.jsx', '/feature-branch/')).toBe(
      '/feature-branch/src/canvas/button-patterns.story.jsx',
    )
  })

  it('keeps root-relative paths unchanged when BASE_URL is root', () => {
    expect(resolveCanvasModuleImport('/src/canvas/button-patterns.story.jsx', '/')).toBe(
      '/src/canvas/button-patterns.story.jsx',
    )
  })

  it('returns relative paths as-is', () => {
    expect(resolveCanvasModuleImport('./local-module.js', '/feature-branch/')).toBe('./local-module.js')
  })

  it('returns absolute URLs as-is', () => {
    expect(resolveCanvasModuleImport('https://cdn.example.com/module.js', '/feature-branch/')).toBe(
      'https://cdn.example.com/module.js',
    )
  })
})
