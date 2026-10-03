import { describe, it, expect } from 'vitest'

import { computeEmbedNavigationSrc, resolveCanvasHomepageTarget } from './mountStoryboardCore.js'

describe('computeEmbedNavigationSrc', () => {
  describe('prod mode (direct route in pathname)', () => {
    it('strips basePath and appends hash', () => {
      expect(computeEmbedNavigationSrc('/cq-org-enablement', '#sectionA', '/')).toBe(
        '/cq-org-enablement#sectionA',
      )
    })

    it('handles non-root basePath', () => {
      expect(
        computeEmbedNavigationSrc('/storyboard/cq-org-enablement', '#x', '/storyboard/'),
      ).toBe('/cq-org-enablement#x')
    })

    it('strips /branch--xxx/ deploy prefix', () => {
      expect(
        computeEmbedNavigationSrc('/branch--my-feature/cq-org-enablement', '#x', '/'),
      ).toBe('/cq-org-enablement#x')
    })

    it('returns "/" when pathname equals basePath', () => {
      expect(computeEmbedNavigationSrc('/storyboard', '', '/storyboard/')).toBe('/')
    })

    it('handles missing hash', () => {
      expect(computeEmbedNavigationSrc('/MyProto', '', '/')).toBe('/MyProto')
    })
  })

  describe('dev mode (new shape: /prototypes.html/<route>)', () => {
    it('strips /prototypes.html prefix from pathname and keeps hash', () => {
      expect(
        computeEmbedNavigationSrc('/prototypes.html/cq-org-enablement', '#cqConfirmOpen=true', '/'),
      ).toBe('/cq-org-enablement#cqConfirmOpen=true')
    })

    it('preserves multi-key storyboard hash state', () => {
      expect(
        computeEmbedNavigationSrc(
          '/prototypes.html/cq-org-enablement',
          '#cqEnabled=null&cqFlashDismissed=null&cqConfirmOpen=true&cqSettingUp=null',
          '/',
        ),
      ).toBe('/cq-org-enablement#cqEnabled=null&cqFlashDismissed=null&cqConfirmOpen=true&cqSettingUp=null')
    })

    it('returns "/" for missing search', () => {
      expect(
        computeEmbedNavigationSrc(
          '/prototypes.html/cq-org-enablement',
          '',
          '/',
        ),
      ).toBe('/cq-org-enablement')
    })

    it('preserves storyboard search state (e.g. ?flow=name)', () => {
      expect(
        computeEmbedNavigationSrc(
          '/prototypes.html/StartupSignup',
          '',
          '/',
          '?flow=loopline-signup%2Fsuccess',
        ),
      ).toBe('/StartupSignup?flow=loopline-signup%2Fsuccess')
    })

    it('strips embed-managed params from the search', () => {
      expect(
        computeEmbedNavigationSrc(
          '/prototypes.html/StartupSignup',
          '',
          '/',
          '?flow=loopline-signup%2Fsuccess&_sb_embed&_sb_hide_branch_bar&_sb_theme_target=prototype&_sb_canvas_theme=dark&sb_knobs=1',
        ),
      ).toBe('/StartupSignup?flow=loopline-signup%2Fsuccess')
    })

    it('preserves search and hash together (prod shape)', () => {
      expect(
        computeEmbedNavigationSrc('/MyProto', '#x=1', '/', '?flow=MyProto%2Fdefault'),
      ).toBe('/MyProto?flow=MyProto%2Fdefault#x=1')
    })

    it('handles nested route segments', () => {
      expect(
        computeEmbedNavigationSrc('/prototypes.html/MyProto/SignupForm', '', '/'),
      ).toBe('/MyProto/SignupForm')
    })

    it('handles non-root basePath', () => {
      expect(
        computeEmbedNavigationSrc(
          '/storyboard/prototypes.html/MyProto',
          '#x=1',
          '/storyboard/',
        ),
      ).toBe('/MyProto#x=1')
    })

    it('handles branch deploy basePath', () => {
      expect(
        computeEmbedNavigationSrc(
          '/branch--feature-x/prototypes.html/MyProto',
          '#x=1',
          '/branch--feature-x/',
        ),
      ).toBe('/MyProto#x=1')
    })
  })

  describe('dev mode legacy shape (0.6.13 and older: /prototypes.html + #/<route>)', () => {
    it('uses hash content as src when pathname is /prototypes.html', () => {
      expect(
        computeEmbedNavigationSrc('/prototypes.html', '#/cq-org-enablement', '/'),
      ).toBe('/cq-org-enablement')
    })

    it('preserves query string inside hash', () => {
      expect(
        computeEmbedNavigationSrc(
          '/prototypes.html',
          '#/cq-org-enablement?flow=cq-org-enablement/default&cqConfirmOpen=true',
          '/',
        ),
      ).toBe('/cq-org-enablement?flow=cq-org-enablement/default&cqConfirmOpen=true')
    })

    it('handles non-root basePath', () => {
      expect(
        computeEmbedNavigationSrc('/storyboard/prototypes.html', '#/MyProto', '/storyboard/'),
      ).toBe('/MyProto')
    })

    it('handles branch deploy basePath', () => {
      expect(
        computeEmbedNavigationSrc(
          '/branch--feature-x/prototypes.html',
          '#/MyProto',
          '/branch--feature-x/',
        ),
      ).toBe('/MyProto')
    })

    it('prefixes inner hash with "/" if missing', () => {
      expect(
        computeEmbedNavigationSrc('/prototypes.html', '#MyProto', '/'),
      ).toBe('/MyProto')
    })

    it('returns "/" for empty hash', () => {
      expect(computeEmbedNavigationSrc('/prototypes.html', '', '/')).toBe('/')
    })

    it('returns "/" for hash that is just "#"', () => {
      expect(computeEmbedNavigationSrc('/prototypes.html', '#', '/')).toBe('/')
    })
  })

  describe('regression — must never produce /prototypes.html prefix as src', () => {
    // 0.6.13 bug: dev embed broadcast pathname+hash, so the parent canvas
    // persisted `/prototypes.html#/route` as the widget src. The URL builder
    // then rebuilt the iframe URL as
    // `/prototypes.html?proto=prototypes.html#/prototypes.html#/route`,
    // which loaded a blank page. Duplicating that widget (cmd+D) carried
    // the broken src to every clone.
    //
    // 0.6.14 bug: hash-based routing in createHashRouter collided with
    // storyboard URL state (which also writes to the hash). Navigating
    // inside the iframe blanked the page because the route part of the
    // hash got URL-encoded into a single nonsense fragment.
    //
    // 0.6.15 (this fix): pathname-based routing — both shapes must
    // round-trip to a clean canvas-app route.
    it('never returns a string starting with /prototypes.html', () => {
      const cases = [
        // legacy hash-form (0.6.13 bug)
        ['/prototypes.html', '#/foo'],
        ['/prototypes.html', '#/foo?bar=1'],
        ['/storyboard/prototypes.html', '#/bar'],
        ['/branch--x/prototypes.html', '#/baz'],
        // new path-form (0.6.15)
        ['/prototypes.html/foo', ''],
        ['/prototypes.html/foo', '#key=value'],
        ['/prototypes.html/foo/bar', '#a=1&b=2'],
        ['/storyboard/prototypes.html/foo', '#x=y'],
        ['/branch--x/prototypes.html/foo', '#x=y'],
      ]
      for (const [pathname, hash] of cases) {
        const basePath = pathname.startsWith('/branch--x')
          ? '/branch--x/'
          : pathname.startsWith('/storyboard')
            ? '/storyboard/'
            : '/'
        const result = computeEmbedNavigationSrc(pathname, hash, basePath)
        expect(result.startsWith('/prototypes.html')).toBe(false)
      }
    })
  })
})

describe('resolveCanvasHomepageTarget', () => {
  it('returns empty string for empty input', () => {
    expect(resolveCanvasHomepageTarget('')).toBe('')
    expect(resolveCanvasHomepageTarget(undefined)).toBe('')
    expect(resolveCanvasHomepageTarget(null)).toBe('')
  })

  it('prefixes a bare canvas id with /canvas/', () => {
    expect(resolveCanvasHomepageTarget('landing')).toBe('/canvas/landing')
  })

  it('preserves nested canvas ids', () => {
    expect(resolveCanvasHomepageTarget('research/intake')).toBe('/canvas/research/intake')
  })

  it('passes through values that start with /', () => {
    expect(resolveCanvasHomepageTarget('/canvas/landing')).toBe('/canvas/landing')
    expect(resolveCanvasHomepageTarget('/landing')).toBe('/landing')
    expect(resolveCanvasHomepageTarget('/some/custom/route')).toBe('/some/custom/route')
  })
})
