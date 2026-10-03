import { describe, it, expect } from 'vitest'
import { toCanvasId } from './identity.js'

describe('toCanvasId (path-based canvas identity)', () => {
  it('returns basename for flat canvas in src/canvas/', () => {
    expect(toCanvasId('src/canvas/design-overview.canvas.jsonl')).toBe('design-overview')
  })

  it('returns path-based ID for canvas inside a .folder/', () => {
    expect(toCanvasId('src/canvas/research.folder/interviews.canvas.jsonl')).toBe('research/interviews')
  })

  it('strips .folder suffix from path', () => {
    expect(toCanvasId('src/canvas/ux.folder/onboarding.canvas.jsonl')).toBe('ux/onboarding')
  })

  it('handles nested subdirectories inside a .folder/', () => {
    expect(toCanvasId('src/canvas/team.folder/sub/deep.canvas.jsonl')).toBe('team/sub/deep')
  })

  it('returns proto:-prefixed ID for prototype-scoped canvas', () => {
    expect(toCanvasId('src/prototypes/Dashboard/overview.canvas.jsonl')).toBe('proto:Dashboard/overview')
  })

  it('handles prototype inside a .folder/', () => {
    expect(toCanvasId('src/prototypes/main.folder/Dashboard/overview.canvas.jsonl')).toBe('proto:main/Dashboard/overview')
  })

  it('duplicate basenames in different folders get distinct IDs', () => {
    const id1 = toCanvasId('src/canvas/alpha.folder/overview.canvas.jsonl')
    const id2 = toCanvasId('src/canvas/beta.folder/overview.canvas.jsonl')
    expect(id1).toBe('alpha/overview')
    expect(id2).toBe('beta/overview')
    expect(id1).not.toBe(id2)
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(toCanvasId('src\\canvas\\research.folder\\interviews.canvas.jsonl')).toBe('research/interviews')
  })
})
