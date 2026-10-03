import { describe, expect, it } from 'vitest'
import { buildPublishedSiteManifest, renderPublishedSiteFrame } from './published.js'

describe('published Site rendering', () => {
  it('renders a snapshot linked to the production route', () => {
    const [frame] = buildPublishedSiteManifest([{ siteId: 'docs', route: 'guide', title: 'Docs' }], { productionBaseUrl: 'https://example.com', snapshotUrl: '/assets/docs.png' })
    expect(renderPublishedSiteFrame(frame)).toContain('https://example.com/docs/guide')
    expect(renderPublishedSiteFrame(frame)).toContain('/assets/docs.png')
  })

  it('renders an explicit fallback when snapshot capture is unavailable', () => {
    expect(renderPublishedSiteFrame({ siteId: 'docs', openUrl: 'https://example.com' })).toContain('Preview unavailable')
  })
})
