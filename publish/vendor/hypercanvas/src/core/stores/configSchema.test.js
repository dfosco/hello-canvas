import { describe, it, expect } from 'vitest'
import { getConfig, getConfigDefaults, configDefaults, builtinPasteRules, resolveRouteTarget } from './configSchema.js'

describe('configSchema', () => {
  describe('getConfigDefaults', () => {
    it('returns a full defaults object', () => {
      const d = getConfigDefaults()
      expect(d.canvas).toBeDefined()
      expect(d.commandPalette).toBeDefined()
      expect(d.repository).toEqual({ owner: '', name: '' })
    })

    it('returns a fresh copy each time', () => {
      const a = getConfigDefaults()
      const b = getConfigDefaults()
      expect(a).not.toBe(b)
      expect(a).toEqual(b)
    })
  })

  describe('getConfig', () => {
    it('returns full defaults when called with empty object', () => {
      const c = getConfig({})
      expect(c.canvas.pasteRules).toEqual(builtinPasteRules)
      expect(c.canvas.github.embedBehavior).toBe('link-preview')
      expect(c.canvas.github.ghGuard).toBe('copy')
      expect(c.canvas.zoom.gestures).toBe(true)
      expect(c.canvas.zoom.origin).toBe('center')
      expect(c.canvas.scroll.axis).toBe('both')
      expect(c.canvas.surface).toEqual({ width: 'auto', height: 'auto' })
      expect(c.canvas.production).toEqual({
        move: false,
        resize: false,
        editMarkdown: false,
        editSticky: false,
      })
      expect(c.featureFlags.browserSessionHandoff).toBe(false)
      expect(c.featureFlags.usePaseoApp).toBe(true)
      expect(c.commandPalette.providers).toEqual(['prototypes', 'flows', 'canvases', 'pages'])
      expect(c.commandPalette.ranking).toBe('frecency')
      expect(c.customerMode.enabled).toBe(false)
      expect(c.customerMode.homepage).toBe(false)
      expect(c.customerMode.tools).toBe('all')
      expect(c.customerMode.commandPalette).toBe(true)
      expect(c.customerMode.branchBar).toBe(true)
      // Legacy aliases still present in defaults for back-compat readers
      expect(c.customerMode.hideChrome).toBe(false)
      expect(c.customerMode.hideHomepage).toBe(false)
      expect(c.customerMode.protoHomepage).toBe('')
      expect(c.customerMode.canvasHomepage).toBe('')
    })

    it('returns full defaults when called with undefined', () => {
      const c = getConfig()
      expect(c.canvas).toBeDefined()
      expect(c.commandPalette).toBeDefined()
    })

    it('merges user config over defaults', () => {
      const c = getConfig({
        repository: { owner: 'test', name: 'repo' },
        canvas: { github: { ghGuard: 'link' } },
      })
      expect(c.repository).toEqual({ owner: 'test', name: 'repo' })
      expect(c.canvas.github.ghGuard).toBe('link')
      // Other defaults preserved
      expect(c.canvas.github.embedBehavior).toBe('link-preview')
      expect(c.canvas.pasteRules).toEqual(builtinPasteRules)
    })

    it('replaces arrays instead of concatenating', () => {
      const customRules = [{ id: 'custom', match: 'https://example.com', widget: 'link-preview' }]
      const c = getConfig({ canvas: { pasteRules: customRules } })
      expect(c.canvas.pasteRules).toEqual(customRules)
      expect(c.canvas.pasteRules).not.toContainEqual(builtinPasteRules[0])
    })

    it('preserves existing keys not in defaults', () => {
      const c = getConfig({ customDomain: 'my-project', featureFlags: { 'show-banner': true } })
      expect(c.customDomain).toBe('my-project')
      expect(c.featureFlags['show-banner']).toBe(true)
      expect(c.featureFlags.browserSessionHandoff).toBe(false)
    })

    it('allows enabling the wrapper browser-session handoff feature flag', () => {
      const c = getConfig({ featureFlags: { browserSessionHandoff: true } })
      expect(c.featureFlags.browserSessionHandoff).toBe(true)
    })

    it('allows disabling Paseo App reuse without changing other flag defaults', () => {
      const c = getConfig({ featureFlags: { usePaseoApp: false } })
      expect(c.featureFlags.usePaseoApp).toBe(false)
      expect(c.featureFlags.browserSessionHandoff).toBe(false)
    })

    it('does not mutate configDefaults', () => {
      const before = JSON.stringify(configDefaults)
      getConfig({ canvas: { github: { ghGuard: 'off' } } })
      expect(JSON.stringify(configDefaults)).toBe(before)
    })
  })

  describe('routes + pages defaults', () => {
    it('defaults routes["/"] to "home" (behavior-preserving)', () => {
      const c = getConfig({})
      expect(c.routes).toEqual({ '/': 'home' })
    })

    it('defaults the home surface props to today’s values', () => {
      const c = getConfig({})
      expect(c.pages.home).toEqual({
        title: 'Hypercanvas',
        subtitle: 'Collaborative workspace for design & code',
      })
    })

    it('defaults the workspace surface props to today’s values', () => {
      const c = getConfig({})
      expect(c.pages.workspace).toEqual({
        title: 'Hypercanvas',
        subtitle: 'Where design work goes',
        logo: null,
        logoIcon: 'iconoir/key-command',
        showAllArtifacts: false,
        showPrototypes: true,
        showCanvases: true,
        showComponents: true,
      })
    })

    it('merges a partial pages override without dropping sibling defaults', () => {
      const c = getConfig({ pages: { home: { title: 'My App' } } })
      expect(c.pages.home.title).toBe('My App')
      expect(c.pages.home.subtitle).toBe('Collaborative workspace for design & code')
      expect(c.pages.workspace.showPrototypes).toBe(true)
    })

    it('replaces the routes map when a user provides one', () => {
      const c = getConfig({ routes: { '/': { dev: 'workspace', prod: 'home' } } })
      expect(c.routes['/']).toEqual({ dev: 'workspace', prod: 'home' })
    })
  })

  describe('resolveRouteTarget', () => {
    it('returns null for an unconfigured path', () => {
      expect(resolveRouteTarget({ '/': 'home' }, '/missing')).toBeNull()
      expect(resolveRouteTarget(undefined, '/')).toBeNull()
    })

    it('returns a string target in every environment', () => {
      expect(resolveRouteTarget({ '/': 'home' }, '/', { dev: true })).toBe('home')
      expect(resolveRouteTarget({ '/': 'home' }, '/', { dev: false })).toBe('home')
    })

    it('picks the dev target in dev and prod target in prod', () => {
      const routes = { '/': { dev: 'workspace', prod: 'home' } }
      expect(resolveRouteTarget(routes, '/', { dev: true })).toBe('workspace')
      expect(resolveRouteTarget(routes, '/', { dev: false })).toBe('home')
    })

    it('falls back to default when the active env key is absent', () => {
      const routes = { '/': { dev: 'workspace', default: 'home' } }
      expect(resolveRouteTarget(routes, '/', { dev: false })).toBe('home')
      expect(resolveRouteTarget(routes, '/', { dev: true })).toBe('workspace')
    })

    it('falls back to the other env key when nothing else matches', () => {
      expect(resolveRouteTarget({ '/': { prod: 'home' } }, '/', { dev: true })).toBe('home')
      expect(resolveRouteTarget({ '/': { dev: 'workspace' } }, '/', { dev: false })).toBe('workspace')
    })

    it('treats an empty-string target as unconfigured', () => {
      expect(resolveRouteTarget({ '/': '' }, '/')).toBeNull()
    })
  })
})
