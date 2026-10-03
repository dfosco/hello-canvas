import { describe, expect, it } from 'vitest'
import { createPublishedSiteFrame, normalizeSiteReference, siteCaptureKey } from './publish.js'

describe('published Site frames', () => {
  it('stores identity and route without local URL details', () => {
    expect(normalizeSiteReference({ siteId: 'docs', route: '/guide' })).toEqual({ siteId: 'docs', route: 'guide' })
  })

  it('creates stable capture keys and production links', () => {
    const reference = { siteId: 'docs', route: 'guide', width: 800, height: 600 }
    expect(siteCaptureKey(reference, { bindingRevision: 2 })).toBe(siteCaptureKey(reference, { bindingRevision: 2 }))
    expect(createPublishedSiteFrame(reference, { productionBaseUrl: 'https://example.com/docs', snapshotUrl: '/assets/docs.png' })).toMatchObject({ openUrl: 'https://example.com/docs/guide', mode: 'snapshot' })
  })
})
