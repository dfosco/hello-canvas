import { describe, expect, it } from 'vitest'
import { getEmbedChromeVars } from './embedTheme.js'
import { normalizeLegacyEmbedSrc } from './normalizeLegacyEmbedSrc.js'
import { isLocalDevEmbedUrl, getAbsoluteEmbedOrigin } from './PrototypeEmbed.jsx'
import { buildPrototypePickerEntries, embedRoutePath, stripEmbedRoute } from './prototypePickerEntries.js'

describe('getEmbedChromeVars', () => {
  it('returns an empty object — color tokens now cascade from data-sb-canvas-theme via tailwind.css', () => {
    expect(getEmbedChromeVars('light')).toEqual({})
    expect(getEmbedChromeVars('dark')).toEqual({})
    expect(getEmbedChromeVars('dark_dimmed')).toEqual({})
  })
})

describe('normalizeLegacyEmbedSrc', () => {
  it('passes through clean canvas-app routes unchanged', () => {
    expect(normalizeLegacyEmbedSrc('/cq-org-enablement')).toBe('/cq-org-enablement')
    expect(normalizeLegacyEmbedSrc('/MyProto/SignupForm')).toBe('/MyProto/SignupForm')
    expect(normalizeLegacyEmbedSrc('/cq-org-enablement#x=1')).toBe('/cq-org-enablement#x=1')
  })

  it('passes through external http(s) URLs unchanged', () => {
    expect(normalizeLegacyEmbedSrc('https://example.com/foo')).toBe('https://example.com/foo')
  })

  it('passes through empty/falsy values', () => {
    expect(normalizeLegacyEmbedSrc('')).toBe('')
    expect(normalizeLegacyEmbedSrc(null)).toBe(null)
    expect(normalizeLegacyEmbedSrc(undefined)).toBe(undefined)
  })

  describe('legacy hash-form: /prototypes.html#/<route>', () => {
    it('strips loader prefix and keeps inner route', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html#/cq-org-enablement')).toBe('/cq-org-enablement')
    })

    it('keeps query strings inside inner', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html#/cq-org-enablement?cqConfirmOpen=true'))
        .toBe('/cq-org-enablement?cqConfirmOpen=true')
    })

    it('handles non-root basePath', () => {
      expect(normalizeLegacyEmbedSrc('/storyboard/prototypes.html#/MyProto')).toBe('/MyProto')
    })

    it('returns "/" for empty inner', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html#')).toBe('/')
    })

    it('prefixes "/" if inner missing leading slash', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html#MyProto')).toBe('/MyProto')
    })
  })

  describe('legacy URLSearchParams-clobbered form (real-world 0.6.13/0.6.14 bug)', () => {
    // Real bug: storyboard's session.writeHash did URLSearchParams.toString()
    // on the entire hash, which URL-encoded the route slash to %2F and turned
    // /MyProto into a key with an empty value. Real persisted srcs from the
    // wild look like /prototypes.html#%2Fcq-org-enablement=&cqConfirmOpen=true
    it('recovers route from URLSearchParams-mangled hash', () => {
      expect(
        normalizeLegacyEmbedSrc('/prototypes.html#%2Fcq-org-enablement=&cqConfirmOpen=true'),
      ).toBe('/cq-org-enablement#cqConfirmOpen=true')
    })

    it('recovers route with no surviving storyboard state', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html#%2Fcq-org-enablement=')).toBe('/cq-org-enablement')
    })

    it('recovers route with multiple storyboard params', () => {
      expect(
        normalizeLegacyEmbedSrc(
          '/prototypes.html#%2Fcq-org-enablement=&cqEnabled=null&cqFlashDismissed=null&cqConfirmOpen=true',
        ),
      ).toBe('/cq-org-enablement#cqEnabled=null&cqFlashDismissed=null&cqConfirmOpen=true')
    })

    it('recovers nested route', () => {
      expect(
        normalizeLegacyEmbedSrc('/prototypes.html#%2FMyProto%2FSignupForm=&x=1'),
      ).toBe('/MyProto/SignupForm#x=1')
    })

    it('handles non-root basePath', () => {
      expect(
        normalizeLegacyEmbedSrc('/storyboard/prototypes.html#%2FMyProto=&x=1'),
      ).toBe('/MyProto#x=1')
    })
  })

  describe('defensive path-form: /prototypes.html/<route>', () => {
    it('strips loader prefix', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html/MyProto')).toBe('/MyProto')
    })

    it('handles nested routes', () => {
      expect(normalizeLegacyEmbedSrc('/prototypes.html/MyProto/SignupForm')).toBe('/MyProto/SignupForm')
    })

    it('handles non-root basePath', () => {
      expect(normalizeLegacyEmbedSrc('/storyboard/prototypes.html/MyProto')).toBe('/MyProto')
    })
  })

  describe('all-encompassing regression — no legacy shape can produce a /prototypes.html src', () => {
    const cases = [
      '/prototypes.html#/foo',
      '/prototypes.html#/foo?bar=1',
      '/prototypes.html#',
      '/prototypes.html#%2Ffoo=&bar=1',
      '/prototypes.html#%2Ffoo%2Fbar=&x=1',
      '/prototypes.html/foo',
      '/prototypes.html/foo/bar',
      '/storyboard/prototypes.html#/foo',
      '/storyboard/prototypes.html#%2Ffoo=&x=1',
      '/storyboard/prototypes.html/foo',
    ]
    for (const input of cases) {
      it(`recovers ${input}`, () => {
        const result = normalizeLegacyEmbedSrc(input)
        expect(result).not.toMatch(/prototypes\.html/)
        expect(result.startsWith('/')).toBe(true)
      })
    }
  })
})

describe('isLocalDevEmbedUrl', () => {
  it('matches localhost http(s) URLs (any port)', () => {
    expect(isLocalDevEmbedUrl('http://localhost:5200/MyProto')).toBe(true)
    expect(isLocalDevEmbedUrl('https://localhost:443/MyProto')).toBe(true)
    expect(isLocalDevEmbedUrl('http://127.0.0.1:3000/Foo')).toBe(true)
    expect(isLocalDevEmbedUrl('http://[::1]:8080/Foo')).toBe(true)
  })

  it('rejects external hosts and non-http(s) protocols', () => {
    expect(isLocalDevEmbedUrl('https://example.com/foo')).toBe(false)
    expect(isLocalDevEmbedUrl('http://my-app.local/foo')).toBe(false)
    expect(isLocalDevEmbedUrl('ftp://localhost/foo')).toBe(false)
  })

  it('rejects relative paths and garbage', () => {
    expect(isLocalDevEmbedUrl('/MyProto')).toBe(false)
    expect(isLocalDevEmbedUrl('')).toBe(false)
    expect(isLocalDevEmbedUrl(null)).toBe(false)
    expect(isLocalDevEmbedUrl(undefined)).toBe(false)
  })
})

describe('getAbsoluteEmbedOrigin', () => {
  it('returns the origin for local dev URLs', () => {
    expect(getAbsoluteEmbedOrigin('http://localhost:5200/MyProto/Sub?x=1#y')).toBe('http://localhost:5200')
    expect(getAbsoluteEmbedOrigin('http://127.0.0.1:3000/Foo')).toBe('http://127.0.0.1:3000')
  })

  it('returns "" for external or relative URLs', () => {
    expect(getAbsoluteEmbedOrigin('https://example.com/foo')).toBe('')
    expect(getAbsoluteEmbedOrigin('/MyProto')).toBe('')
    expect(getAbsoluteEmbedOrigin('')).toBe('')
  })
})

describe('embedRoutePath', () => {
  it('keeps only the path of relative routes', () => {
    expect(embedRoutePath('/StartupSignup?flow=loopline-signup%2Fsuccess')).toBe('/StartupSignup')
    expect(embedRoutePath('/MyProto/Page#section')).toBe('/MyProto/Page')
    expect(embedRoutePath('/StartupSignup?flow=ok#state=x')).toBe('/StartupSignup')
  })

  it('strips branch deploy prefixes', () => {
    expect(embedRoutePath('/branch--feature/MyProto')).toBe('/MyProto')
  })

  it('keeps pathname+hash for absolute URLs and tolerates garbage', () => {
    expect(embedRoutePath('http://localhost:5200/MyProto?x=1')).toBe('/MyProto')
    expect(embedRoutePath('https://example.com/foo#bar')).toBe('/foo#bar')
    expect(embedRoutePath(null)).toBe('')
    expect(embedRoutePath(42)).toBe('')
  })
})

describe('stripEmbedRoute', () => {
  it('removes only the branch prefix', () => {
    expect(stripEmbedRoute('/branch--x/MyProto?flow=a%2Fb')).toBe('/MyProto?flow=a%2Fb')
    expect(stripEmbedRoute('/MyProto')).toBe('/MyProto')
    expect(stripEmbedRoute(123)).toBe('')
  })
})

describe('buildPrototypePickerEntries', () => {
  const folderProto = {
    name: 'Loopline Signup',
    dirName: 'loopline-signup',
    isExternal: false,
    flows: [
      { name: 'empty', route: '/StartupSignup?flow=loopline-signup%2Fempty', meta: null },
      { name: 'success', route: '/StartupSignup?flow=loopline-signup%2Fsuccess', meta: { title: 'Success' } },
      { name: 'submitting', route: '/StartupSignup?flow=loopline-signup%2Fsubmitting', meta: { title: 'Submitting', default: true } },
    ],
  }
  const plainProto = {
    name: 'Welcome',
    dirName: 'welcome',
    isExternal: false,
    flows: [],
  }
  const externalProto = {
    name: 'External Docs',
    dirName: 'docs-site',
    isExternal: true,
    flows: [],
  }

  it('flattens folders and ungrouped prototypes into one sorted list, skipping externals', () => {
    const index = {
      sorted: { title: { folders: [{ prototypes: [folderProto] }], prototypes: [plainProto, externalProto] } },
    }
    const entries = buildPrototypePickerEntries(index)
    expect(entries.map(e => `${e.title}|${e.dirName}`)).toEqual([
      'Loopline Signup|loopline-signup',
      'Welcome|welcome',
    ])
  })

  it('picks the default flow route as the representative src and lists every owning route', () => {
    const entries = buildPrototypePickerEntries({ sorted: { title: { folders: [], prototypes: [folderProto] } } })
    expect(entries[0].route).toBe('/StartupSignup?flow=loopline-signup%2Fsubmitting')
    expect(entries[0].routes).toEqual([
      '/loopline-signup',
      '/StartupSignup?flow=loopline-signup%2Fempty',
      '/StartupSignup?flow=loopline-signup%2Fsuccess',
      '/StartupSignup?flow=loopline-signup%2Fsubmitting',
    ])
    expect(entries[0].flows.map(f => f.name)).toEqual(['Empty', 'Success', 'Submitting'])
  })

  it('falls back to the prototype index route when it has no flows', () => {
    const entries = buildPrototypePickerEntries({ sorted: { title: { folders: [], prototypes: [plainProto] } } })
    expect(entries[0].route).toBe('/welcome')
    expect(entries[0].routes).toEqual(['/welcome'])
  })

  it('dedupes prototypes by dirName and tolerates empty indexes', () => {
    expect(buildPrototypePickerEntries({ sorted: { title: { folders: [], prototypes: [plainProto, plainProto] } } }).length).toBe(1)
    expect(buildPrototypePickerEntries(null)).toEqual([])
    expect(buildPrototypePickerEntries({})).toEqual([])
  })
})
