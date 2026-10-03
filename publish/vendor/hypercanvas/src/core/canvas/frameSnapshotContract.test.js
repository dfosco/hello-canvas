import { describe, expect, it } from 'vitest'
import {
  frameSnapshotSourceKey,
  frameSnapshotVariantKey,
  frameSnapshotThemes,
  normalizeFrameCaptureUrl,
  normalizeFrameSnapshotTarget,
} from './frameSnapshotContract.js'

describe('Frame snapshot contract', () => {
  it('normalizes prototype targets and preserves user query and hash', () => {
    const target = normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/MyProto/page?flow=default#panel=open', zoom: 150, width: 800, height: 600 })
    expect(target).toEqual({ kind: 'prototype', src: '/MyProto/page?flow=default#panel=open', zoom: 150, viewport: { width: 533, height: 375 } })
  })

  it('strips legacy branch prefixes from prototype identity', () => {
    expect(normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/branch--feature/Route' }).src).toBe('/Route')
  })

  it('derives the zoomed content viewport, excluding the title bar', () => {
    expect(normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/x', width: 1200, height: 837, zoom: 100 }).viewport)
      .toEqual({ width: 1200, height: 800 })
  })

  it('normalizes Site targets through the Site route contract', () => {
    const target = normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'docs', route: '/guide/setup?x=1#top', width: 900, height: 600 })
    expect(target).toEqual({ kind: 'site', siteId: 'docs', route: 'guide/setup?x=1#top', viewport: { width: 900, height: 563 } })
  })

  it('preserves custom content dimensions when a normalized target is normalized again', () => {
    const site = normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'docs', route: 'guide', width: 1280, height: 900 })
    expect(site.viewport).toEqual({ width: 1280, height: 863 })
    expect(normalizeFrameSnapshotTarget(site)).toEqual(site)

    const prototype = normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/x', width: 1200, height: 837, zoom: 150 })
    expect(prototype.viewport).toEqual({ width: 800, height: 533 })
    expect(normalizeFrameSnapshotTarget(prototype)).toEqual(prototype)
  })

  it('rejects remote or credential-bearing prototype sources', () => {
    expect(() => normalizeFrameSnapshotTarget({ kind: 'prototype', src: 'https://example.com/page' })).toThrow(/localhost/)
    expect(() => normalizeFrameSnapshotTarget({ kind: 'prototype', src: 'http://user:pass@localhost/x' })).toThrow(/credentials/)
    expect(() => normalizeFrameSnapshotTarget({ kind: 'prototype', src: '' })).toThrow(/requires a prototype route/)
  })

  it('computes stable source keys independent of non-portable fields', () => {
    const target = normalizeFrameSnapshotTarget({ kind: 'site', siteId: 'docs', route: 'guide', width: 800, height: 600 })
    expect(frameSnapshotSourceKey(target)).toBe(frameSnapshotSourceKey(normalizeFrameSnapshotTarget({ ...target })))
    expect(frameSnapshotSourceKey(target)).toMatch(/^[0-9a-f]{32}$/)
    expect(frameSnapshotSourceKey(target)).not.toBe(frameSnapshotSourceKey(normalizeFrameSnapshotTarget({ ...target, route: 'other' })))
    expect(frameSnapshotSourceKey(normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/x', zoom: 100, width: 800, height: 600 })))
      .toBe(frameSnapshotSourceKey(normalizeFrameSnapshotTarget({ kind: 'prototype', src: '/branch--b/x', zoom: 100, width: 800, height: 600 })))
  })

  it('keys theme variants separately from the shared target manifest', () => {
    const sourceKey = frameSnapshotSourceKey({ kind: 'site', siteId: 'docs', route: '' })
    expect(frameSnapshotVariantKey(sourceKey, 'light')).not.toBe(frameSnapshotVariantKey(sourceKey, 'dark'))
    expect(frameSnapshotThemes('both')).toEqual(['light', 'dark'])
    expect(frameSnapshotThemes('dark')).toEqual(['dark'])
    expect(frameSnapshotThemes('light')).toEqual(['light'])
  })

  it('validates capture URLs against local development origins', () => {
    expect(normalizeFrameCaptureUrl('/proto/page?x=1', { origin: 'http://localhost:5173' }))
      .toBe('http://localhost:5173/proto/page?x=1')
    expect(() => normalizeFrameCaptureUrl('/x', { origin: 'https://example.com' })).toThrow(/local development origin/)
    expect(() => normalizeFrameCaptureUrl('http://example.com/x', { origin: 'http://localhost:5173' })).toThrow(/localhost development server/)
    expect(() => normalizeFrameCaptureUrl('', { origin: 'http://localhost:5173' })).toThrow(/requires the Frame document URL/)
  })
})
