import { init, loadFlow, listFlows, flowExists, loadScene, listScenes, sceneExists, loadRecord, findRecord, loadObject, deepMerge, resolveFlowName, resolveRecordName, resolveObjectName, listFolders, getFolderMetadata, listStories, getStoryData } from './loader.js'

const makeIndex = () => ({
  flows: {
    default: {
      title: 'Default Scene',
      user: { $ref: 'jane-doe' },
    },
    Dashboard: {
      $global: ['navigation'],
      heading: 'Dashboard',
      nav: 'scene-wins',
    },
    empty: {},
    'with-nested-ref': {
      team: {
        lead: { $ref: 'jane-doe' },
      },
    },
    'circular-a': {
      thing: { $ref: 'circular-obj-a' },
    },
  },
  objects: {
    'jane-doe': {
      name: 'Jane Doe',
      role: 'admin',
    },
    navigation: {
      nav: 'global-nav',
      links: ['home', 'about'],
    },
    'circular-obj-a': {
      nested: { $ref: 'circular-obj-b' },
    },
    'circular-obj-b': {
      nested: { $ref: 'circular-obj-a' },
    },
    'team-info': {
      team: 'Engineering',
      lead: { $ref: 'jane-doe' },
    },
  },
  records: {
    posts: [
      { id: 'post-1', title: 'First Post' },
      { id: 'post-2', title: 'Second Post' },
    ],
    'bad-record': { notAnArray: true },
  },
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  init(makeIndex())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('init', () => {
  it('throws on null', () => {
    expect(() => init(null)).toThrow()
  })

  it('throws on undefined', () => {
    expect(() => init(undefined)).toThrow()
  })

  it('throws on non-object', () => {
    expect(() => init('string')).toThrow()
  })

  it('stores data so loadFlow works', () => {
    init(makeIndex())
    const flow = loadFlow('default')
    expect(flow.title).toBe('Default Scene')
  })

  it('handles missing properties gracefully', () => {
    init({})
    expect(flowExists('anything')).toBe(false)
  })

  it('accepts { scenes } for backward compat', () => {
    init({ scenes: { legacy: { title: 'Legacy' } }, objects: {}, records: {} })
    expect(flowExists('legacy')).toBe(true)
  })
})

describe('loadFlow', () => {
  it('loads flow by name', () => {
    const flow = loadFlow('empty')
    expect(flow).toEqual({})
  })

  it('resolves $ref to objects', () => {
    const flow = loadFlow('default')
    expect(flow.user).toEqual({ name: 'Jane Doe', role: 'admin' })
  })

  it('resolves nested $ref', () => {
    const flow = loadFlow('with-nested-ref')
    expect(flow.team.lead).toEqual({ name: 'Jane Doe', role: 'admin' })
  })

  it('resolves $global and merges into root, flow wins conflicts', () => {
    const flow = loadFlow('Dashboard')
    expect(flow.links).toEqual(['home', 'about'])
    expect(flow.heading).toBe('Dashboard')
    // flow value should win over global value
    expect(flow.nav).toBe('scene-wins')
  })

  it('throws for missing flow', () => {
    expect(() => loadFlow('nonexistent')).toThrow()
  })

  it('case-insensitive lookup', () => {
    const flow = loadFlow('dashboard')
    expect(flow.heading).toBe('Dashboard')
  })

  it('returns deep clone (mutations do not affect index)', () => {
    const flow1 = loadFlow('empty')
    flow1.injected = true
    const flow2 = loadFlow('empty')
    expect(flow2.injected).toBeUndefined()
  })

  it('resolves $global on repeated calls (no index mutation)', () => {
    const first = loadFlow('Dashboard')
    expect(first.links).toEqual(['home', 'about'])
    expect(first.heading).toBe('Dashboard')

    // Second call must return the same resolved data — $global must not
    // be deleted from the index by the first call
    const second = loadFlow('Dashboard')
    expect(second.links).toEqual(['home', 'about'])
    expect(second.heading).toBe('Dashboard')
    expect(second.nav).toBe('scene-wins')
  })

  it('default param loads "default" flow', () => {
    const flow = loadFlow()
    expect(flow.title).toBe('Default Scene')
  })

  it('detects circular $ref and throws', () => {
    expect(() => loadFlow('circular-a')).toThrow(/circular/i)
  })
})

describe('flowExists', () => {
  it('returns true for existing flow', () => {
    expect(flowExists('default')).toBe(true)
  })

  it('returns false for missing flow', () => {
    expect(flowExists('nope')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(flowExists('dashboard')).toBe(true)
    expect(flowExists('DASHBOARD')).toBe(true)
  })
})

describe('listFlows', () => {
  it('returns all flow names', () => {
    const names = listFlows()
    expect(names).toContain('default')
    expect(names).toContain('Dashboard')
    expect(names).toContain('empty')
  })

  it('returns an array', () => {
    expect(Array.isArray(listFlows())).toBe(true)
  })

  it('returns empty array when no flows registered', () => {
    init({ flows: {}, objects: {}, records: {} })
    expect(listFlows()).toEqual([])
  })
})

// ── Deprecated aliases ──

describe('loadScene (deprecated alias)', () => {
  it('is the same function as loadFlow', () => {
    expect(loadScene).toBe(loadFlow)
  })

  it('loads flow data', () => {
    const scene = loadScene('default')
    expect(scene.title).toBe('Default Scene')
  })
})

describe('sceneExists (deprecated alias)', () => {
  it('is the same function as flowExists', () => {
    expect(sceneExists).toBe(flowExists)
  })

  it('returns true for existing flow', () => {
    expect(sceneExists('default')).toBe(true)
  })
})

describe('listScenes (deprecated alias)', () => {
  it('is the same function as listFlows', () => {
    expect(listScenes).toBe(listFlows)
  })

  it('returns all flow names', () => {
    expect(listScenes()).toContain('default')
  })
})

describe('loadRecord', () => {
  it('loads record array by name', () => {
    const records = loadRecord('posts')
    expect(records).toHaveLength(2)
    expect(records[0].id).toBe('post-1')
  })

  it('throws for missing record', () => {
    expect(() => loadRecord('nonexistent')).toThrow()
  })

  it('throws for non-array record', () => {
    expect(() => loadRecord('bad-record')).toThrow(/array/i)
  })

  it('returns deep clone', () => {
    const records1 = loadRecord('posts')
    records1[0].title = 'Modified'
    const records2 = loadRecord('posts')
    expect(records2[0].title).toBe('First Post')
  })
})

describe('findRecord', () => {
  it('finds entry by id', () => {
    const entry = findRecord('posts', 'post-2')
    expect(entry).toEqual({ id: 'post-2', title: 'Second Post' })
  })

  it('returns null for missing id', () => {
    const entry = findRecord('posts', 'nonexistent')
    expect(entry).toBeNull()
  })

  it('throws for missing record', () => {
    expect(() => findRecord('nonexistent', 'any')).toThrow()
  })
})

describe('deepMerge', () => {
  it('merges nested objects', () => {
    const target = { a: { b: 1, c: 2 } }
    const source = { a: { d: 3 } }
    const result = deepMerge(target, source)
    expect(result).toEqual({ a: { b: 1, c: 2, d: 3 } })
  })

  it('source wins conflicts', () => {
    const target = { a: 1 }
    const source = { a: 2 }
    expect(deepMerge(target, source)).toEqual({ a: 2 })
  })

  it('arrays are replaced not concatenated', () => {
    const target = { items: [1, 2, 3] }
    const source = { items: [4, 5] }
    expect(deepMerge(target, source)).toEqual({ items: [4, 5] })
  })

  it('handles null/undefined values', () => {
    const target = { a: 1, b: 2 }
    const source = { a: null, c: undefined }
    const result = deepMerge(target, source)
    expect(result.a).toBeNull()
    expect(result.c).toBeUndefined()
  })
})

describe('loadObject', () => {
  it('loads object by name', () => {
    const obj = loadObject('jane-doe')
    expect(obj).toEqual({ name: 'Jane Doe', role: 'admin' })
  })

  it('resolves $ref within object', () => {
    const obj = loadObject('team-info')
    expect(obj.team).toBe('Engineering')
    expect(obj.lead).toEqual({ name: 'Jane Doe', role: 'admin' })
  })

  it('throws for missing object', () => {
    expect(() => loadObject('nonexistent')).toThrow()
  })

  it('returns deep clone (mutations do not affect index)', () => {
    const obj1 = loadObject('jane-doe')
    obj1.name = 'Modified'
    const obj2 = loadObject('jane-doe')
    expect(obj2.name).toBe('Jane Doe')
  })

  it('detects circular $ref and throws', () => {
    expect(() => loadObject('circular-obj-a')).toThrow(/circular/i)
  })
})

describe('resolveFlowName', () => {
  beforeEach(() => {
    init({
      flows: {
        default: { title: 'Global Default' },
        signup: { title: 'Global Signup' },
        'Dashboard/default': { title: 'Dashboard Default' },
        'Dashboard/signup': { title: 'Dashboard Signup' },
        'Blog/default': { title: 'Blog Default' },
      },
      objects: {},
      records: {},
    })
  })

  it('returns scoped name when it exists', () => {
    expect(resolveFlowName('Dashboard', 'default')).toBe('Dashboard/default')
    expect(resolveFlowName('Dashboard', 'signup')).toBe('Dashboard/signup')
  })

  it('falls back to global name when scoped does not exist', () => {
    expect(resolveFlowName('Blog', 'signup')).toBe('signup')
  })

  it('returns global name when scope is null', () => {
    expect(resolveFlowName(null, 'default')).toBe('default')
    expect(resolveFlowName(null, 'signup')).toBe('signup')
  })

  it('returns scoped name for error messages when neither exists', () => {
    expect(resolveFlowName('Dashboard', 'nonexistent')).toBe('Dashboard/nonexistent')
  })

  it('returns plain name for error messages when scope is null and name does not exist', () => {
    expect(resolveFlowName(null, 'nonexistent')).toBe('nonexistent')
  })

  it('handles already-scoped names (explicit cross-prototype)', () => {
    expect(resolveFlowName('Blog', 'Dashboard/signup')).toBe('Dashboard/signup')
  })
})

describe('resolveRecordName', () => {
  beforeEach(() => {
    init({
      flows: {},
      objects: {},
      records: {
        posts: [{ id: '1' }],
        'Dashboard/metrics': [{ id: 'm1' }],
        'Dashboard/posts': [{ id: 'd1' }],
      },
    })
  })

  it('returns scoped name when it exists', () => {
    expect(resolveRecordName('Dashboard', 'metrics')).toBe('Dashboard/metrics')
    expect(resolveRecordName('Dashboard', 'posts')).toBe('Dashboard/posts')
  })

  it('falls back to global when scoped does not exist', () => {
    expect(resolveRecordName('Blog', 'posts')).toBe('posts')
  })

  it('returns global when scope is null', () => {
    expect(resolveRecordName(null, 'posts')).toBe('posts')
  })
})

describe('resolveObjectName', () => {
  beforeEach(() => {
    init({
      flows: {},
      objects: {
        'jane-doe': { name: 'Jane Global' },
        'Dashboard/jane-doe': { name: 'Jane Dashboard' },
        'Dashboard/helpers': { util: true },
      },
      records: {},
    })
  })

  it('returns scoped name when it exists', () => {
    expect(resolveObjectName('Dashboard', 'jane-doe')).toBe('Dashboard/jane-doe')
    expect(resolveObjectName('Dashboard', 'helpers')).toBe('Dashboard/helpers')
  })

  it('falls back to global when scoped does not exist', () => {
    expect(resolveObjectName('Blog', 'jane-doe')).toBe('jane-doe')
  })

  it('returns global when scope is null', () => {
    expect(resolveObjectName(null, 'jane-doe')).toBe('jane-doe')
  })

  it('returns scoped name for error messages when neither exists', () => {
    expect(resolveObjectName('Dashboard', 'nonexistent')).toBe('Dashboard/nonexistent')
  })

  it('returns plain name when scope is null and name does not exist', () => {
    expect(resolveObjectName(null, 'nonexistent')).toBe('nonexistent')
  })
})

describe('scoped object loading', () => {
  beforeEach(() => {
    init({
      flows: {
        'Dashboard/default': {
          $global: ['nav'],
          user: { $ref: 'jane-doe' },
          heading: 'Dashboard',
        },
      },
      objects: {
        'jane-doe': { name: 'Jane Global' },
        nav: { links: ['home'] },
        'Dashboard/jane-doe': { name: 'Jane Dashboard' },
        'Dashboard/nav': { links: ['dashboard-home', 'settings'] },
      },
      records: {},
    })
  })

  it('loadObject with scope resolves scoped object', () => {
    const obj = loadObject('jane-doe', 'Dashboard')
    expect(obj.name).toBe('Jane Dashboard')
  })

  it('loadObject with scope falls back to global', () => {
    const obj = loadObject('jane-doe', 'Blog')
    expect(obj.name).toBe('Jane Global')
  })

  it('loadObject without scope uses global', () => {
    const obj = loadObject('jane-doe')
    expect(obj.name).toBe('Jane Global')
  })

  it('loadFlow resolves $ref with prototype scope', () => {
    const flow = loadFlow('Dashboard/default')
    expect(flow.user.name).toBe('Jane Dashboard')
  })

  it('loadFlow resolves $global with prototype scope', () => {
    const flow = loadFlow('Dashboard/default')
    expect(flow.links).toEqual(['dashboard-home', 'settings'])
  })
})

describe('error hints for scoped data', () => {
  beforeEach(() => {
    init({
      flows: {
        'Dashboard/signup': { title: 'Dashboard Signup' },
        default: { title: 'Global Default' },
      },
      objects: {},
      records: {
        'Blog/posts': [{ id: '1' }],
        tags: [{ id: 'js' }],
      },
    })
  })

  it('loadFlow error suggests scoped alternatives', () => {
    expect(() => loadFlow('signup')).toThrow(/Did you mean: Dashboard\/signup/)
  })

  it('loadRecord error suggests scoped alternatives', () => {
    expect(() => loadRecord('posts')).toThrow(/Did you mean: Blog\/posts/)
  })

  it('loadFlow error for truly missing name has no hint', () => {
    expect(() => loadFlow('xyz')).toThrow(/Failed to load flow: xyz/)
    expect(() => loadFlow('xyz')).not.toThrow(/Did you mean/)
  })

  it('loadRecord error for truly missing name has no hint', () => {
    expect(() => loadRecord('xyz')).toThrow(/Record not found: xyz/)
    expect(() => loadRecord('xyz')).not.toThrow(/Did you mean/)
  })
})

// ── Folder functions ──

describe('listFolders', () => {
  it('returns empty array when no folders registered', () => {
    init(makeIndex())
    expect(listFolders()).toEqual([])
  })

  it('returns folder names when folders are registered', () => {
    init({
      ...makeIndex(),
      folders: {
        'Getting Started': { meta: { title: 'Getting Started' } },
        Advanced: { meta: { title: 'Advanced' } },
      },
    })
    expect(listFolders()).toEqual(['Getting Started', 'Advanced'])
  })
})

describe('getFolderMetadata', () => {
  it('returns null when folder does not exist', () => {
    init(makeIndex())
    expect(getFolderMetadata('nonexistent')).toBeNull()
  })

  it('returns folder metadata when folder exists', () => {
    init({
      ...makeIndex(),
      folders: {
        'My Folder': { meta: { title: 'My Folder', description: 'A folder' } },
      },
    })
    const meta = getFolderMetadata('My Folder')
    expect(meta).toEqual({ meta: { title: 'My Folder', description: 'A folder' } })
  })
})

describe('listStories', () => {
  it('returns empty array when no stories are indexed', () => {
    init(makeIndex())
    expect(listStories()).toEqual([])
  })

  it('returns story names when stories are indexed', () => {
    init({
      ...makeIndex(),
      stories: {
        'button-patterns': { _storyModule: '/src/button-patterns.story.jsx' },
        'card': { _storyModule: '/src/card.story.jsx' },
      },
    })
    expect(listStories()).toEqual(['button-patterns', 'card'])
  })
})

describe('getStoryData', () => {
  it('returns null for unknown story', () => {
    init(makeIndex())
    expect(getStoryData('nonexistent')).toBeNull()
  })

  it('returns story data when story exists', () => {
    const mockImport = vi.fn()
    init({
      ...makeIndex(),
      stories: {
        'button-patterns': {
          _storyModule: '/src/button-patterns.story.jsx',
          _storyImport: mockImport,
        },
      },
    })
    const story = getStoryData('button-patterns')
    expect(story).toBeTruthy()
    expect(story._storyModule).toBe('/src/button-patterns.story.jsx')
    expect(story._storyImport).toBe(mockImport)
  })
})

describe('init with stories', () => {
  it('defaults stories to empty object when not provided', () => {
    init({ flows: {}, objects: {}, records: {} })
    expect(listStories()).toEqual([])
  })

  it('stores stories when provided', () => {
    init({
      flows: {},
      objects: {},
      records: {},
      stories: {
        test: { _storyModule: '/test.story.jsx' },
      },
    })
    expect(listStories()).toEqual(['test'])
    expect(getStoryData('test')).toBeTruthy()
  })
})
