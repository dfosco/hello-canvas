import { init } from './loader.js'
import { hash, resolveFlowRoute, getFlowMeta, resolveSceneRoute, getSceneMeta, buildPrototypeIndex, appendTokens } from './viewfinder.js'

const makeIndex = () => ({
  flows: {
    default: { title: 'Default Scene' },
    Dashboard: { heading: 'Dashboard' },
    'custom-route': { route: 'Overview', title: 'Custom' },
    'absolute-route': { route: '/Forms', title: 'Absolute' },
    'no-route': { title: 'No route key' },
    'meta-route': { flowMeta: { route: 'Repositories' }, title: 'Meta Route' },
    'meta-author': { flowMeta: { author: 'dfosco' }, title: 'With Author' },
    'meta-authors': { flowMeta: { author: ['dfosco', 'heyamie', 'branonconor'] }, title: 'Multi Author' },
    'meta-both': { flowMeta: { route: '/Overview', author: 'octocat' }, title: 'Both' },
    'inferred-route': { _route: '/Dashboard', title: 'Inferred' },
    'inferred-default': { _route: '/Settings', meta: { default: true }, title: 'Default Flow' },
    'explicit-wins': { route: '/Forms', _route: '/Dashboard', title: 'Explicit Wins' },
  },
  objects: {},
  records: {},
})

beforeEach(() => {
  init(makeIndex())
})

describe('hash', () => {
  it('returns a number', () => {
    expect(typeof hash('test')).toBe('number')
  })

  it('is deterministic', () => {
    expect(hash('hello')).toBe(hash('hello'))
  })

  it('produces different values for different strings', () => {
    expect(hash('foo')).not.toBe(hash('bar'))
  })

  it('returns non-negative values', () => {
    expect(hash('abc')).toBeGreaterThanOrEqual(0)
    expect(hash('')).toBeGreaterThanOrEqual(0)
    expect(hash('a very long string with lots of characters')).toBeGreaterThanOrEqual(0)
  })
})

describe('resolveFlowRoute', () => {
  const routes = ['Dashboard', 'Overview', 'Forms', 'Repositories']

  it('matches flow name to route (exact case)', () => {
    expect(resolveFlowRoute('Dashboard', routes)).toBe('/Dashboard')
  })

  it('matches flow name to route (case-insensitive)', () => {
    expect(resolveFlowRoute('dashboard', routes)).toBe('/Dashboard')
  })

  it('uses route key from flow data when no route matches', () => {
    expect(resolveFlowRoute('custom-route', routes)).toBe('/Overview?flow=custom-route')
  })

  it('handles absolute route key (with leading slash)', () => {
    expect(resolveFlowRoute('absolute-route', routes)).toBe('/Forms?flow=absolute-route')
  })

  it('falls back to root when no match and no route key', () => {
    expect(resolveFlowRoute('no-route', routes)).toBe('/?flow=no-route')
  })

  it('falls back to root for default flow', () => {
    expect(resolveFlowRoute('default', routes)).toBe('/?flow=default')
  })

  it('falls back to root when flow does not exist', () => {
    expect(resolveFlowRoute('nonexistent', routes)).toBe('/?flow=nonexistent')
  })

  it('works with empty routes array', () => {
    expect(resolveFlowRoute('Dashboard', [])).toBe('/?flow=Dashboard')
  })

  it('works with no routes argument', () => {
    expect(resolveFlowRoute('custom-route')).toBe('/Overview?flow=custom-route')
  })

  it('encodes special characters in flow name', () => {
    init({
      flows: { 'has spaces': { title: 'Spaces' } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('has spaces', [])).toBe('/?flow=has%20spaces')
  })

  it('uses flowMeta.route when no route matches', () => {
    expect(resolveFlowRoute('meta-route', routes)).toBe('/Repositories?flow=meta-route')
  })

  it('uses flowMeta.route with absolute path', () => {
    expect(resolveFlowRoute('meta-both', routes)).toBe('/Overview?flow=meta-both')
  })

  it('prefers top-level route over flowMeta.route', () => {
    init({
      flows: { conflict: { route: 'Forms', flowMeta: { route: 'Dashboard' } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('conflict', [])).toBe('/Forms?flow=conflict')
  })

  it('uses _route when no explicit route exists', () => {
    expect(resolveFlowRoute('inferred-route', routes)).toBe('/Dashboard?flow=inferred-route')
  })

  it('prefers explicit route over _route', () => {
    expect(resolveFlowRoute('explicit-wins', routes)).toBe('/Forms?flow=explicit-wins')
  })

  it('omits ?flow= when meta.default is true (inferred route)', () => {
    expect(resolveFlowRoute('inferred-default', routes)).toBe('/Settings')
  })

  it('omits ?flow= when meta.default is true (explicit route)', () => {
    init({
      flows: { 'default-explicit': { route: '/Overview', meta: { default: true } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('default-explicit', [])).toBe('/Overview')
  })

  it('still appends ?flow= when meta.default is absent even with _route', () => {
    expect(resolveFlowRoute('inferred-route', [])).toBe('/Dashboard?flow=inferred-route')
  })
})

describe('getFlowMeta', () => {
  it('returns flowMeta when present', () => {
    expect(getFlowMeta('meta-author')).toEqual({ author: 'dfosco' })
  })

  it('returns flowMeta with both fields', () => {
    expect(getFlowMeta('meta-both')).toEqual({ route: '/Overview', author: 'octocat' })
  })

  it('returns flowMeta with array author', () => {
    expect(getFlowMeta('meta-authors')).toEqual({ author: ['dfosco', 'heyamie', 'branonconor'] })
  })

  it('returns null when no flowMeta', () => {
    expect(getFlowMeta('default')).toBeNull()
  })

  it('returns null for nonexistent flow', () => {
    expect(getFlowMeta('nonexistent')).toBeNull()
  })
})

// ── Deprecated aliases ──

describe('resolveSceneRoute (deprecated alias)', () => {
  it('is the same function as resolveFlowRoute', () => {
    expect(resolveSceneRoute).toBe(resolveFlowRoute)
  })

  it('resolves a flow route', () => {
    expect(resolveSceneRoute('Dashboard', ['Dashboard'])).toBe('/Dashboard')
  })
})

describe('getSceneMeta (deprecated alias)', () => {
  it('is the same function as getFlowMeta', () => {
    expect(getSceneMeta).toBe(getFlowMeta)
  })

  it('returns flow meta', () => {
    expect(getSceneMeta('meta-author')).toEqual({ author: 'dfosco' })
  })
})

// ── buildPrototypeIndex ──

describe('buildPrototypeIndex', () => {
  it('passes hideFlows from prototype metadata', () => {
    init({
      flows: { 'MyProto/only-flow': { meta: { title: 'Only Flow' } } },
      objects: {},
      records: {},
      prototypes: {
        MyProto: { meta: { title: 'My Proto', hideFlows: true } },
      },
    })
    const { prototypes } = buildPrototypeIndex([])
    const proto = prototypes.find(p => p.dirName === 'MyProto')
    expect(proto.hideFlows).toBe(true)
    expect(proto.flows).toHaveLength(1)
  })

  it('defaults hideFlows to true when not set', () => {
    init({
      flows: { 'Other/flow-a': { meta: { title: 'A' } } },
      objects: {},
      records: {},
      prototypes: {
        Other: { meta: { title: 'Other Proto' } },
      },
    })
    const { prototypes } = buildPrototypeIndex([])
    const proto = prototypes.find(p => p.dirName === 'Other')
    expect(proto.hideFlows).toBe(true)
  })

  it('reads hideFlows from top-level prototype metadata (outside meta key)', () => {
    init({
      flows: { 'TopLevel/only-flow': { meta: { title: 'Only Flow' } } },
      objects: {},
      records: {},
      prototypes: {
        TopLevel: { meta: { title: 'Top Level' }, hideFlows: true },
      },
    })
    const { prototypes } = buildPrototypeIndex([])
    const proto = prototypes.find(p => p.dirName === 'TopLevel')
    expect(proto.hideFlows).toBe(true)
  })

  it('groups prototypes into folders when folder field is set', () => {
    init({
      flows: {
        'Example/basic': { meta: { title: 'Basic' } },
        'Signup/default': { meta: { title: 'Default' } },
      },
      objects: {},
      records: {},
      prototypes: {
        Example: { meta: { title: 'Examples' }, folder: 'Getting Started' },
        Signup: { meta: { title: 'Sign Up' }, folder: 'Getting Started' },
      },
      folders: {
        'Getting Started': { meta: { title: 'Getting Started', description: 'Intro prototypes', icon: '📚' } },
      },
    })
    const result = buildPrototypeIndex([])
    expect(result.folders).toHaveLength(1)
    expect(result.prototypes).toHaveLength(0)

    const folder = result.folders[0]
    expect(folder.name).toBe('Getting Started')
    expect(folder.description).toBe('Intro prototypes')
    expect(folder.icon).toBe('📚')
    expect(folder.prototypes).toHaveLength(2)
    expect(folder.prototypes.map(p => p.dirName)).toContain('Example')
    expect(folder.prototypes.map(p => p.dirName)).toContain('Signup')
  })

  it('keeps prototypes without a folder as ungrouped', () => {
    init({
      flows: {
        'Grouped/flow-a': {},
        'Standalone/flow-b': {},
      },
      objects: {},
      records: {},
      prototypes: {
        Grouped: { meta: { title: 'Grouped' }, folder: 'MyFolder' },
        Standalone: { meta: { title: 'Standalone' } },
      },
      folders: {
        MyFolder: { meta: { title: 'My Folder' } },
      },
    })
    const result = buildPrototypeIndex([])
    expect(result.folders).toHaveLength(1)
    expect(result.prototypes).toHaveLength(1)
    expect(result.prototypes[0].dirName).toBe('Standalone')
    expect(result.folders[0].prototypes).toHaveLength(1)
    expect(result.folders[0].prototypes[0].dirName).toBe('Grouped')
  })

  it('creates implicit folder when prototype references a folder with no metadata', () => {
    init({
      flows: { 'Proto/flow': {} },
      objects: {},
      records: {},
      prototypes: {
        Proto: { meta: { title: 'Proto' }, folder: 'Implicit' },
      },
    })
    const result = buildPrototypeIndex([])
    expect(result.folders).toHaveLength(1)
    expect(result.folders[0].name).toBe('Implicit')
    expect(result.folders[0].prototypes).toHaveLength(1)
  })

  it('uses folder directory name as display name when no title in metadata', () => {
    init({
      flows: {},
      objects: {},
      records: {},
      prototypes: {},
      folders: {
        'My Folder': {},
      },
    })
    const result = buildPrototypeIndex([])
    expect(result.folders).toHaveLength(1)
    expect(result.folders[0].name).toBe('My Folder')
  })

  it('returns empty folders array when no folders exist', () => {
    init({
      flows: { 'A/flow': {} },
      objects: {},
      records: {},
      prototypes: { A: { meta: { title: 'A' } } },
    })
    const result = buildPrototypeIndex([])
    expect(result.folders).toHaveLength(0)
    expect(result.prototypes).toHaveLength(1)
  })

  it('passes through lastModified from prototype metadata', () => {
    const ts = '2025-01-15T10:30:00-05:00'
    init({
      flows: { 'App/home': {} },
      objects: {},
      records: {},
      prototypes: { App: { meta: { title: 'My App' }, lastModified: ts } },
    })
    const result = buildPrototypeIndex([])
    expect(result.prototypes[0].lastModified).toBe(ts)
  })

  it('defaults lastModified to null when not provided', () => {
    init({
      flows: { 'App/home': {} },
      objects: {},
      records: {},
      prototypes: { App: { meta: { title: 'My App' } } },
    })
    const result = buildPrototypeIndex([])
    expect(result.prototypes[0].lastModified).toBeNull()
  })

  it('sorts drafts canvas-group pages by pageOrder despite the drafts/ id prefix', () => {
    const meta = {
      title: 'Security Vision',
      pageOrder: [
        'security-vision/1-security-vision',
        'security-vision/2-confidence-scores',
        'security-vision/3-final-updates',
      ],
    }
    // Pages are registered in reverse discovery order; their ids keep `drafts/`
    // but pageOrder is authored without it (the correct convention).
    init({
      flows: {},
      objects: {},
      records: {},
      canvases: {
        'drafts/security-vision/3-final-updates': {
          title: '3 Final Updates', _group: 'security-vision', _isPrivate: true, _canvasMeta: meta,
        },
        'drafts/security-vision/2-confidence-scores': {
          title: '2 Confidence Scores', _group: 'security-vision', _isPrivate: true, _canvasMeta: meta,
        },
        'drafts/security-vision/1-security-vision': {
          title: '1 Security Vision', _group: 'security-vision', _isPrivate: true, _canvasMeta: meta,
        },
      },
    })
    const result = buildPrototypeIndex([])
    const card = result.canvases.find(c => c._group === 'security-vision')
    expect(card).toBeTruthy()
    // Title comes from .meta.json, not a page title.
    expect(card.name).toBe('Security Vision')
    expect(card.pages.map(p => p.id)).toEqual([
      'drafts/security-vision/1-security-vision',
      'drafts/security-vision/2-confidence-scores',
      'drafts/security-vision/3-final-updates',
    ])
  })
})

// ── appendTokens ──

describe('appendTokens', () => {
  it('returns url unchanged when tokens is null', () => {
    expect(appendTokens('/foo', null)).toBe('/foo')
  })

  it('returns url unchanged when tokens is undefined', () => {
    expect(appendTokens('/foo', undefined)).toBe('/foo')
  })

  it('returns url unchanged when tokens is empty', () => {
    expect(appendTokens('/foo', {})).toBe('/foo')
  })

  it('appends single token with ?', () => {
    expect(appendTokens('/foo', { token: 'abc' })).toBe('/foo?token=abc')
  })

  it('appends multiple tokens', () => {
    const result = appendTokens('/foo', { token: 'abc', model: 'gpt-4' })
    expect(result).toBe('/foo?token=abc&model=gpt-4')
  })

  it('uses & separator when url already has query params', () => {
    expect(appendTokens('/foo?flow=bar', { token: 'abc' })).toBe('/foo?flow=bar&token=abc')
  })

  it('filters out reserved key "flow"', () => {
    expect(appendTokens('/foo', { flow: 'bad', token: 'good' })).toBe('/foo?token=good')
  })

  it('filters out reserved key "scene"', () => {
    expect(appendTokens('/foo', { scene: 'bad', token: 'good' })).toBe('/foo?token=good')
  })

  it('filters out null and undefined values', () => {
    expect(appendTokens('/foo', { a: null, b: undefined, c: 'ok' })).toBe('/foo?c=ok')
  })

  it('filters out object and array values', () => {
    expect(appendTokens('/foo', { a: { nested: true }, b: [1, 2], c: 'ok' })).toBe('/foo?c=ok')
  })

  it('encodes special characters', () => {
    expect(appendTokens('/foo', { key: 'hello world' })).toBe('/foo?key=hello%20world')
  })

  it('handles numeric and boolean values', () => {
    expect(appendTokens('/foo', { count: 42, active: true })).toBe('/foo?count=42&active=true')
  })
})

// ── resolveFlowRoute with tokens ──

describe('resolveFlowRoute with tokens', () => {
  it('appends tokens to a flow with explicit route', () => {
    init({
      flows: { 'with-tokens': { route: '/Overview', tokens: { token: 'sk-abc' } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('with-tokens', [])).toBe('/Overview?flow=with-tokens&token=sk-abc')
  })

  it('appends tokens to a known-route match', () => {
    init({
      flows: { Dashboard: { heading: 'Hi', tokens: { model: 'gpt-4' } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('Dashboard', ['Dashboard'])).toBe('/Dashboard?model=gpt-4')
  })

  it('appends tokens to inferred route', () => {
    init({
      flows: { 'inferred': { _route: '/Settings', tokens: { key: 'val' } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('inferred', [])).toBe('/Settings?flow=inferred&key=val')
  })

  it('appends tokens to default flow fallback', () => {
    init({
      flows: { 'no-route': { title: 'No route', tokens: { api: '123' } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('no-route', [])).toBe('/?flow=no-route&api=123')
  })

  it('does not append tokens when flow has none', () => {
    init({
      flows: { simple: { route: '/Page' } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('simple', [])).toBe('/Page?flow=simple')
  })

  it('appends tokens with meta.default route (no ?flow=)', () => {
    init({
      flows: { 'default-tokens': { _route: '/Home', meta: { default: true }, tokens: { key: 'val' } } },
      objects: {},
      records: {},
    })
    expect(resolveFlowRoute('default-tokens', [])).toBe('/Home?key=val')
  })
})
