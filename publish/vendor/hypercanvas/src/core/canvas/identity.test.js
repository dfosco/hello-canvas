import { describe, it, expect } from 'vitest'
import { toCanvasId, parseCanvasId, canvasIdBasename, isLegacyCanvasId, CANVAS_IDENTITY_CONSUMERS } from './identity.js'

describe('canvas/identity', () => {
  describe('toCanvasId', () => {
    it('strips src/canvas/ prefix and .canvas.jsonl suffix', () => {
      expect(toCanvasId('src/canvas/overview.canvas.jsonl')).toBe('overview')
    })

    it('normalizes .folder segments', () => {
      expect(toCanvasId('src/canvas/design.folder/overview.canvas.jsonl')).toBe('design/overview')
    })

    it('handles nested folders', () => {
      expect(toCanvasId('src/canvas/design.folder/sub.folder/a.canvas.jsonl')).toBe('design/sub/a')
    })

    it('prefixes proto: for src/prototypes/', () => {
      expect(toCanvasId('src/prototypes/Main/board.canvas.jsonl')).toBe('proto:Main/board')
    })

    it('handles prototype with .folder', () => {
      expect(toCanvasId('src/prototypes/main.folder/Example/board.canvas.jsonl')).toBe('proto:main/Example/board')
    })

    it('normalizes backslashes', () => {
      expect(toCanvasId('src\\canvas\\design.folder\\overview.canvas.jsonl')).toBe('design/overview')
    })

    it('returns "unknown" for edge case empty result', () => {
      expect(toCanvasId('src/canvas/.canvas.jsonl')).toBe('unknown')
    })
  })

  describe('parseCanvasId', () => {
    it('parses a simple name', () => {
      expect(parseCanvasId('overview')).toEqual({
        namespace: 'canvas',
        segments: ['overview'],
        name: 'overview',
      })
    })

    it('parses a folder/name ID', () => {
      expect(parseCanvasId('design/overview')).toEqual({
        namespace: 'canvas',
        segments: ['design', 'overview'],
        name: 'overview',
      })
    })

    it('parses a proto: prefixed ID', () => {
      expect(parseCanvasId('proto:Main/board')).toEqual({
        namespace: 'prototype',
        segments: ['Main', 'board'],
        name: 'board',
      })
    })

    it('parses deeply nested ID', () => {
      expect(parseCanvasId('design/sub/a')).toEqual({
        namespace: 'canvas',
        segments: ['design', 'sub', 'a'],
        name: 'a',
      })
    })
  })

  describe('canvasIdBasename', () => {
    it('returns the last segment', () => {
      expect(canvasIdBasename('design/overview')).toBe('overview')
      expect(canvasIdBasename('overview')).toBe('overview')
      expect(canvasIdBasename('proto:Main/board')).toBe('board')
    })
  })

  describe('isLegacyCanvasId', () => {
    it('returns true for bare names', () => {
      expect(isLegacyCanvasId('overview')).toBe(true)
    })

    it('returns false for path-based IDs', () => {
      expect(isLegacyCanvasId('design/overview')).toBe(false)
    })

    it('returns false for proto: prefixed IDs', () => {
      expect(isLegacyCanvasId('proto:Main')).toBe(false)
    })
  })

  describe('CANVAS_IDENTITY_CONSUMERS', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(CANVAS_IDENTITY_CONSUMERS)).toBe(true)
      expect(CANVAS_IDENTITY_CONSUMERS.length).toBeGreaterThan(0)
      for (const entry of CANVAS_IDENTITY_CONSUMERS) {
        expect(typeof entry).toBe('string')
      }
    })
  })
})
