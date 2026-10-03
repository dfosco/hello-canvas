import { describe, it, expect, vi } from 'vitest'
import {
  createPasteContext,
  resolvePaste,
  compileRule,
  buildTemplateVars,
  sanitizeUrl,
  resolvePropValue,
  COMPILED_RULES,
  BRANCH_PREFIX_RE,
} from './pasteRules.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGIN = 'https://storyboard.example.com'
const BASE_PATH = '/storyboard'

function ctx(origin = ORIGIN, basePath = BASE_PATH) {
  return createPasteContext(origin, basePath)
}

// ---------------------------------------------------------------------------
// createPasteContext
// ---------------------------------------------------------------------------

describe('createPasteContext', () => {
  it('stores origin and normalized basePath', () => {
    const c = ctx()
    expect(c.origin).toBe(ORIGIN)
    expect(c.basePath).toBe('/storyboard')
  })

  it('strips trailing slash from basePath', () => {
    const c = createPasteContext(ORIGIN, '/storyboard/')
    expect(c.basePath).toBe('/storyboard')
  })

  describe('isSameOrigin', () => {
    it('matches exact base URL', () => {
      expect(ctx().isSameOrigin(`${ORIGIN}/storyboard`)).toBe(true)
    })

    it('matches sub-path under base', () => {
      expect(ctx().isSameOrigin(`${ORIGIN}/storyboard/MyProto`)).toBe(true)
    })

    it('rejects different origin', () => {
      expect(ctx().isSameOrigin('https://evil.com/storyboard/foo')).toBe(false)
    })

    it('rejects spoofed host with matching prefix', () => {
      expect(ctx().isSameOrigin('https://storyboard.example.com.evil.com/storyboard/x')).toBe(false)
    })

    it('rejects basePath prefix collision (/storyboard vs /storyboard-beta)', () => {
      expect(ctx().isSameOrigin(`${ORIGIN}/storyboard-beta/foo`)).toBe(false)
    })

    it('matches branch deploy URL', () => {
      expect(ctx().isSameOrigin(`${ORIGIN}/branch--my-feature/MyProto`)).toBe(true)
    })

    it('rejects non-http protocols', () => {
      expect(ctx().isSameOrigin('ftp://storyboard.example.com/storyboard/x')).toBe(false)
    })

    it('handles root basePath', () => {
      const c = createPasteContext(ORIGIN, '/')
      expect(c.isSameOrigin(`${ORIGIN}/anything`)).toBe(true)
    })
  })

  describe('extractSrc', () => {
    it('strips base path', () => {
      expect(ctx().extractSrc('/storyboard/MyProto')).toBe('/MyProto')
    })

    it('strips branch prefix', () => {
      expect(ctx().extractSrc('/branch--feat/MyProto')).toBe('/MyProto')
    })

    it('returns / for base path alone', () => {
      expect(ctx().extractSrc('/storyboard')).toBe('/')
    })

    it('returns pathname as-is when no prefix matches', () => {
      expect(ctx().extractSrc('/other/path')).toBe('/other/path')
    })
  })

  describe('parseUrl', () => {
    it('parses http URL', () => {
      const u = ctx().parseUrl('https://example.com/path')
      expect(u).not.toBeNull()
      expect(u.hostname).toBe('example.com')
    })

    it('returns null for non-http', () => {
      expect(ctx().parseUrl('ftp://example.com')).toBeNull()
    })

    it('returns null for invalid URL', () => {
      expect(ctx().parseUrl('not a url')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(ctx().parseUrl('')).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// BRANCH_PREFIX_RE
// ---------------------------------------------------------------------------

describe('BRANCH_PREFIX_RE', () => {
  it('matches /branch--name', () => {
    expect(BRANCH_PREFIX_RE.test('/branch--my-feature')).toBe(true)
  })

  it('matches /branch--name/rest', () => {
    expect(BRANCH_PREFIX_RE.test('/branch--fix/Proto/page')).toBe(true)
  })

  it('does not match /branching', () => {
    expect(BRANCH_PREFIX_RE.test('/branching')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sanitizeUrl
// ---------------------------------------------------------------------------

describe('sanitizeUrl', () => {
  it('strips specified params', () => {
    const result = sanitizeUrl('https://figma.com/board/abc/Name?t=token&node-id=1', { stripParams: ['t'] })
    expect(result).not.toContain('t=token')
    expect(result).toContain('node-id=1')
  })

  it('normalizes hostname', () => {
    const result = sanitizeUrl('https://figma.com/board/abc/Name', { normalizeHost: 'www.figma.com' })
    expect(result).toContain('www.figma.com')
  })

  it('returns original on invalid URL', () => {
    expect(sanitizeUrl('not-a-url', { stripParams: ['t'] })).toBe('not-a-url')
  })
})

// ---------------------------------------------------------------------------
// buildTemplateVars
// ---------------------------------------------------------------------------

describe('buildTemplateVars', () => {
  const c = ctx()

  it('builds all vars from a parsed URL', () => {
    const parsed = new URL(`${ORIGIN}/storyboard/MyProto?flow=alt#over`)
    const vars = buildTemplateVars(parsed.toString(), parsed, c)
    expect(vars.$url).toBe(parsed.toString())
    expect(vars.$text).toBe(parsed.toString())
    expect(vars.$pathname).toBe('/storyboard/MyProto')
    expect(vars.$src).toBe('/MyProto')
    expect(vars.$search).toBe('?flow=alt')
    expect(vars.$hash).toBe('#over')
    expect(vars.$hostname).toBe('storyboard.example.com')
  })

  it('handles null parsed URL (plain text)', () => {
    const vars = buildTemplateVars('hello world', null, c)
    expect(vars.$url).toBe('hello world')
    expect(vars.$text).toBe('hello world')
    expect(vars.$pathname).toBe('')
    expect(vars.$src).toBe('')
    expect(vars.$hostname).toBe('')
  })
})

// ---------------------------------------------------------------------------
// resolvePropValue
// ---------------------------------------------------------------------------

describe('resolvePropValue', () => {
  const vars = { $url: 'https://example.com', $text: 'https://example.com', $src: '/MyProto', $pathname: '/storyboard/MyProto', $search: '', $hash: '', $hostname: 'example.com', $origin: 'https://example.com' }

  it('resolves template object', () => {
    expect(resolvePropValue({ template: '$src' }, vars)).toBe('/MyProto')
  })

  it('resolves template with sanitize', () => {
    const result = resolvePropValue(
      { template: '$url', sanitize: { stripParams: ['t'], normalizeHost: 'www.figma.com' } },
      { ...vars, $url: 'https://figma.com/board/abc?t=token' }
    )
    expect(result).toContain('www.figma.com')
    expect(result).not.toContain('t=token')
  })

  it('resolves plain string with template vars', () => {
    expect(resolvePropValue('path is $pathname', vars)).toBe('path is /storyboard/MyProto')
  })

  it('passes through numbers', () => {
    expect(resolvePropValue(800, vars)).toBe(800)
  })

  it('passes through null', () => {
    expect(resolvePropValue(null, vars)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// compileRule
// ---------------------------------------------------------------------------

describe('compileRule', () => {
  const c = ctx()

  it('compiles hostname + pathname matcher', () => {
    const rule = compileRule({
      name: 'figma',
      match: { hostname: '^(www\\.)?figma\\.com$', pathname: '^/(board|design|proto)/' },
      widget: 'figma-embed',
      props: { url: { template: '$url' }, width: 800 },
    })
    expect(rule).not.toBeNull()
    const parsed = c.parseUrl('https://www.figma.com/board/abc/Name')
    expect(rule.match('https://www.figma.com/board/abc/Name', parsed, c)).toBe(true)
    const nonFigma = c.parseUrl('https://github.com/repo')
    expect(rule.match('https://github.com/repo', nonFigma, c)).toBe(false)
  })

  it('compiles sameOrigin matcher', () => {
    const rule = compileRule({
      name: 'proto',
      match: { sameOrigin: true },
      widget: 'prototype',
      props: { src: { template: '$src' } },
    })
    const parsed = c.parseUrl(`${ORIGIN}/storyboard/MyProto`)
    expect(rule.match(`${ORIGIN}/storyboard/MyProto`, parsed, c)).toBe(true)
    const ext = c.parseUrl('https://other.com/page')
    expect(rule.match('https://other.com/page', ext, c)).toBe(false)
  })

  it('compiles isUrl matcher', () => {
    const rule = compileRule({
      name: 'link',
      match: { isUrl: true },
      widget: 'link-preview',
      props: { url: { template: '$url' } },
    })
    const parsed = c.parseUrl('https://example.com')
    expect(rule.match('https://example.com', parsed, c)).toBe(true)
    expect(rule.match('plain text', null, c)).toBe(false)
  })

  it('compiles any matcher', () => {
    const rule = compileRule({
      name: 'fallback',
      match: { any: true },
      widget: 'markdown',
      props: { content: { template: '$text' } },
    })
    expect(rule.match('anything', null, c)).toBe(true)
  })

  it('compiles pattern matcher', () => {
    const rule = compileRule({
      name: 'youtube',
      match: { pattern: 'youtube\\.com/watch' },
      widget: 'link-preview',
      props: { url: { template: '$url' } },
    })
    expect(rule.match('https://youtube.com/watch?v=abc', null, c)).toBe(true)
    expect(rule.match('https://vimeo.com/123', null, c)).toBe(false)
  })

  it('returns null for missing match', () => {
    expect(compileRule({ widget: 'test' })).toBeNull()
  })

  it('returns null for missing widget', () => {
    expect(compileRule({ match: { any: true } })).toBeNull()
  })

  it('returns null for invalid regex', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(compileRule({ name: 'bad', match: { hostname: '[invalid' }, widget: 'test' })).toBeNull()
    spy.mockRestore()
  })

  it('resolves props with template vars', () => {
    const rule = compileRule({
      name: 'test',
      match: { any: true },
      widget: 'markdown',
      props: { content: { template: '$text' }, width: 400 },
    })
    const result = rule.resolve('hello', null, c)
    expect(result.type).toBe('markdown')
    expect(result.props.content).toBe('hello')
    expect(result.props.width).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// COMPILED_RULES (from paste.config.json)
// ---------------------------------------------------------------------------

describe('COMPILED_RULES', () => {
  it('compiles all rules from paste.config.json', () => {
    expect(COMPILED_RULES.length).toBeGreaterThanOrEqual(4)
    const names = COMPILED_RULES.map(r => r.name)
    expect(names).toContain('figma')
    expect(names).toContain('same-origin')
    expect(names).toContain('link-preview')
    expect(names).toContain('markdown')
  })
})

// ---------------------------------------------------------------------------
// resolvePaste — end-to-end with paste.config.json rules
// ---------------------------------------------------------------------------

describe('resolvePaste', () => {
  const c = ctx()

  describe('figma rule', () => {
    it('creates figma-embed for figma board URL', () => {
      const text = 'https://www.figma.com/board/abc123/My-Board'
      const result = resolvePaste(text, c)
      expect(result.type).toBe('figma-embed')
      expect(result.props.url).toContain('figma.com')
      expect(result.props.width).toBe(800)
      expect(result.props.height).toBe(450)
    })

    it('sanitizes figma URL (strips tracking params)', () => {
      const text = 'https://figma.com/design/abc/Name?t=trackingToken'
      const result = resolvePaste(text, c)
      expect(result.type).toBe('figma-embed')
      expect(result.props.url).not.toContain('trackingToken')
    })

    it('normalizes figma hostname to www.figma.com', () => {
      const text = 'https://figma.com/board/abc/Name'
      const result = resolvePaste(text, c)
      expect(result.props.url).toContain('www.figma.com')
    })
  })

  describe('same-origin rule', () => {
    it('creates prototype widget for same-origin URL', () => {
      const text = `${ORIGIN}/storyboard/MyProto`
      const result = resolvePaste(text, c)
      expect(result.type).toBe('prototype')
      expect(result.props.src).toBe('/MyProto')
      expect(result.props.originalSrc).toBe('/MyProto')
      expect(result.props.width).toBe(800)
      expect(result.props.height).toBe(600)
    })

    it('creates prototype widget for branch deploy URL', () => {
      const text = `${ORIGIN}/branch--feat/MyProto`
      const result = resolvePaste(text, c)
      expect(result.type).toBe('prototype')
      expect(result.props.src).toBe('/MyProto')
    })

    it('preserves search and hash in src', () => {
      const text = `${ORIGIN}/storyboard/Proto?flow=alt#override`
      const result = resolvePaste(text, c)
      expect(result.type).toBe('prototype')
      expect(result.props.src).toBe('/Proto?flow=alt#override')
    })
  })

  describe('link-preview rule', () => {
    it('creates link-preview for external URL', () => {
      const text = 'https://github.com/dfosco/storyboard'
      const result = resolvePaste(text, c)
      expect(result.type).toBe('link-preview')
      expect(result.props.url).toBe(text)
      expect(result.props.title).toBe('')
    })
  })

  describe('markdown rule (fallback)', () => {
    it('creates markdown widget for plain text', () => {
      const result = resolvePaste('Hello world', c)
      expect(result.type).toBe('markdown')
      expect(result.props.content).toBe('Hello world')
    })

    it('creates markdown for non-URL text with slashes', () => {
      const result = resolvePaste('some/path/thing', c)
      expect(result.type).toBe('markdown')
    })
  })

  describe('rule precedence', () => {
    it('figma wins over same-origin (if origin were figma.com)', () => {
      const figmaCtx = createPasteContext('https://www.figma.com', '/')
      const text = 'https://www.figma.com/board/abc/Name'
      const result = resolvePaste(text, figmaCtx)
      expect(result.type).toBe('figma-embed')
    })

    it('same-origin wins over generic link-preview', () => {
      const text = `${ORIGIN}/storyboard/Proto`
      const result = resolvePaste(text, c)
      expect(result.type).toBe('prototype')
    })

    it('link-preview wins over markdown for URLs', () => {
      const text = 'https://example.com'
      const result = resolvePaste(text, c)
      expect(result.type).toBe('link-preview')
    })
  })

  describe('edge cases', () => {
    it('handles empty string gracefully (markdown)', () => {
      const result = resolvePaste('', c)
      expect(result.type).toBe('markdown')
      expect(result.props.content).toBe('')
    })

    it('handles malformed URL-like text without crashing', () => {
      const result = resolvePaste('http://', c)
      expect(result).not.toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Override rules (from storyboard.config.json canvas.pasteRules)
// ---------------------------------------------------------------------------

describe('resolvePaste with override rules', () => {
  const c = ctx()

  it('override rule takes priority over paste.config.json rules', () => {
    const overrides = [
      { name: 'custom-github', match: { pattern: 'github\\.com' }, widget: 'markdown', props: { content: 'GitHub link: $url' } },
    ]
    const result = resolvePaste('https://github.com/repo', c, overrides)
    expect(result.type).toBe('markdown')
    expect(result.props.content).toBe('GitHub link: https://github.com/repo')
  })

  it('falls through to paste.config.json rules when override does not match', () => {
    const overrides = [
      { name: 'youtube', match: { pattern: 'youtube\\.com' }, widget: 'video', props: {} },
    ]
    const result = resolvePaste('https://github.com/repo', c, overrides)
    expect(result.type).toBe('link-preview')
  })

  it('invalid override rules are silently skipped', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const overrides = [
      { name: 'bad', match: { hostname: '[invalid' }, widget: 'test' },
      { name: 'good', match: { pattern: 'github\\.com' }, widget: 'custom', props: { url: { template: '$url' } } },
    ]
    const result = resolvePaste('https://github.com/repo', c, overrides)
    expect(result.type).toBe('custom')
    spy.mockRestore()
  })
})