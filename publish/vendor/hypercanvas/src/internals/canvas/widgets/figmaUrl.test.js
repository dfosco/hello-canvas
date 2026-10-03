import { describe, it, expect } from 'vitest'
import { isFigmaUrl, getFigmaType, toFigmaEmbedUrl, getFigmaTitle, sanitizeFigmaUrl } from './figmaUrl.js'

describe('isFigmaUrl', () => {
  it('detects board URLs', () => {
    expect(isFigmaUrl('https://www.figma.com/board/QlwxSiYxYQsHmnLNYpQRtR/Security-Products-HQ?node-id=0-1&t=XBF45Am0VgicAITG-0')).toBe(true)
  })

  it('detects design URLs', () => {
    expect(isFigmaUrl('https://www.figma.com/design/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox?node-id=103-4739')).toBe(true)
  })

  it('detects proto URLs', () => {
    expect(isFigmaUrl('https://www.figma.com/proto/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox?node-id=122-9632&p=f&t=9XSi047pSbt81sZS-0&scaling=min-zoom')).toBe(true)
  })

  it('works without www prefix', () => {
    expect(isFigmaUrl('https://figma.com/board/abc123/My-Board')).toBe(true)
  })

  it('rejects non-Figma URLs', () => {
    expect(isFigmaUrl('https://example.com/board/abc')).toBe(false)
    expect(isFigmaUrl('https://www.figma.com/file/abc')).toBe(false)
    expect(isFigmaUrl('not a url')).toBe(false)
    expect(isFigmaUrl('')).toBe(false)
  })
})

describe('getFigmaType', () => {
  it('returns board for board URLs', () => {
    expect(getFigmaType('https://www.figma.com/board/QlwxSiYxYQsHmnLNYpQRtR/Name')).toBe('board')
  })

  it('returns design for design URLs', () => {
    expect(getFigmaType('https://www.figma.com/design/i8jI8RuxPnGQGp2QllfAr7/Name')).toBe('design')
  })

  it('returns proto for proto URLs', () => {
    expect(getFigmaType('https://www.figma.com/proto/i8jI8RuxPnGQGp2QllfAr7/Name')).toBe('proto')
  })

  it('returns null for non-Figma URLs', () => {
    expect(getFigmaType('https://example.com')).toBeNull()
  })
})

describe('toFigmaEmbedUrl', () => {
  it('transforms board URL', () => {
    const input = 'https://www.figma.com/board/QlwxSiYxYQsHmnLNYpQRtR/Security-Products-HQ?node-id=0-1&t=XBF45Am0VgicAITG-0'
    const result = toFigmaEmbedUrl(input)
    const parsed = new URL(result)

    expect(parsed.hostname).toBe('embed.figma.com')
    expect(parsed.pathname).toBe('/board/QlwxSiYxYQsHmnLNYpQRtR/Security-Products-HQ')
    expect(parsed.searchParams.get('node-id')).toBe('0-1')
    expect(parsed.searchParams.get('embed-host')).toBe('share')
    expect(parsed.searchParams.has('t')).toBe(false)
  })

  it('transforms design URL', () => {
    const input = 'https://www.figma.com/design/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox?node-id=103-4739'
    const result = toFigmaEmbedUrl(input)
    const parsed = new URL(result)

    expect(parsed.hostname).toBe('embed.figma.com')
    expect(parsed.pathname).toBe('/design/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox')
    expect(parsed.searchParams.get('node-id')).toBe('103-4739')
    expect(parsed.searchParams.get('embed-host')).toBe('share')
  })

  it('transforms proto URL and preserves relevant params', () => {
    const input = 'https://www.figma.com/proto/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox?node-id=122-9632&p=f&t=9XSi047pSbt81sZS-0&scaling=min-zoom&content-scaling=fixed&page-id=103%3A4739&starting-point-node-id=140%3A5949'
    const result = toFigmaEmbedUrl(input)
    const parsed = new URL(result)

    expect(parsed.hostname).toBe('embed.figma.com')
    expect(parsed.pathname).toBe('/proto/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox')
    expect(parsed.searchParams.get('node-id')).toBe('122-9632')
    expect(parsed.searchParams.get('p')).toBe('f')
    expect(parsed.searchParams.get('scaling')).toBe('min-zoom')
    expect(parsed.searchParams.get('content-scaling')).toBe('fixed')
    expect(parsed.searchParams.get('page-id')).toBe('103:4739')
    expect(parsed.searchParams.get('starting-point-node-id')).toBe('140:5949')
    expect(parsed.searchParams.get('embed-host')).toBe('share')
    expect(parsed.searchParams.has('t')).toBe(false)
  })

  it('returns original URL for non-Figma URLs', () => {
    expect(toFigmaEmbedUrl('https://example.com')).toBe('https://example.com')
  })
})

describe('getFigmaTitle', () => {
  it('extracts title from board URL', () => {
    expect(getFigmaTitle('https://www.figma.com/board/QlwxSiYxYQsHmnLNYpQRtR/Security-Products-HQ')).toBe('Security Products HQ')
  })

  it('extracts title from design URL', () => {
    expect(getFigmaTitle('https://www.figma.com/design/i8jI8RuxPnGQGp2QllfAr7/Darby-s-copilot-metric-sandbox')).toBe("Darby s copilot metric sandbox")
  })

  it('returns Figma for URLs without name segment', () => {
    expect(getFigmaTitle('https://www.figma.com/board/abc')).toBe('Figma')
  })
})

describe('sanitizeFigmaUrl', () => {
  it('strips tracking param and normalizes to www.figma.com', () => {
    const input = 'https://www.figma.com/board/QlwxSiYxYQsHmnLNYpQRtR/Security-Products-HQ?node-id=0-1&t=XBF45Am0VgicAITG-0'
    const result = sanitizeFigmaUrl(input)
    const parsed = new URL(result)

    expect(parsed.hostname).toBe('www.figma.com')
    expect(parsed.searchParams.get('node-id')).toBe('0-1')
    expect(parsed.searchParams.has('t')).toBe(false)
  })

  it('normalizes figma.com to www.figma.com', () => {
    const input = 'https://figma.com/board/abc/Name?node-id=0-1'
    const result = sanitizeFigmaUrl(input)
    expect(new URL(result).hostname).toBe('www.figma.com')
  })

  it('preserves all non-tracking params for proto URLs', () => {
    const input = 'https://www.figma.com/proto/abc/Name?node-id=1-2&p=f&t=TOKEN&scaling=min-zoom&page-id=103%3A4739'
    const result = sanitizeFigmaUrl(input)
    const parsed = new URL(result)

    expect(parsed.searchParams.get('node-id')).toBe('1-2')
    expect(parsed.searchParams.get('p')).toBe('f')
    expect(parsed.searchParams.get('scaling')).toBe('min-zoom')
    expect(parsed.searchParams.get('page-id')).toBe('103:4739')
    expect(parsed.searchParams.has('t')).toBe(false)
  })

  it('returns non-Figma URLs unchanged', () => {
    expect(sanitizeFigmaUrl('https://example.com')).toBe('https://example.com')
  })
})
