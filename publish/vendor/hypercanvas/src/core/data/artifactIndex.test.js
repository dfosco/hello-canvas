import { buildBranchArtifactHref, fetchArtifactIndex, mergeArtifactIndexIntoPrototypeIndex } from './artifactIndex.js'

function makeLocalIndex() {
  return {
    folders: [{
      name: 'Folder',
      dirName: 'folder',
      description: null,
      icon: null,
      isPrivate: false,
      prototypes: [{ name: 'Folder Proto', dirName: 'FolderProto', folder: 'folder', flows: [], lastModified: null }],
      canvases: [{ name: 'Folder Canvas', dirName: 'folder/canvas', folder: 'folder', route: '/canvas/folder/canvas', isCanvas: true }],
    }],
    prototypes: [{ name: 'Dashboard', dirName: 'Dashboard', folder: null, flows: [], lastModified: null }],
    canvases: [{ name: 'Design System', dirName: 'widget/design-system', folder: null, route: '/canvas/widget/design-system', isCanvas: true }],
    globalFlows: [],
    sorted: { title: { prototypes: [], canvases: [], folders: [] }, updated: { prototypes: [], canvases: [], folders: [] } },
  }
}

function makeRemoteIndex() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-04T09:18:42Z',
    branches: [],
    prototypes: {},
    canvases: {},
  }
}

describe('fetchArtifactIndex', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null on 404', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchArtifactIndex('/storyboard/branch--feature-foo/')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/storyboard/artifacts.index.json')
  })

  it('returns null on bad JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json') } })))

    await expect(fetchArtifactIndex('/storyboard/')).resolves.toBeNull()
  })

  it('returns null when schemaVersion is not supported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 2 }) })))

    await expect(fetchArtifactIndex('/storyboard/')).resolves.toBeNull()
  })

  it('returns parsed JSON on the happy path', async () => {
    const index = { schemaVersion: 1, prototypes: {}, canvases: {}, branches: [] }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => index })))

    await expect(fetchArtifactIndex('/storyboard/')).resolves.toBe(index)
  })
})

describe('buildBranchArtifactHref', () => {
  it.each([
    ['/', '', '/Repositories', '/Repositories'],
    ['/storyboard/', '', '/Repositories', '/storyboard/Repositories'],
    ['/storyboard/', 'branch--feature-foo/', '/Repositories', '/storyboard/branch--feature-foo/Repositories'],
    ['/storyboard/', 'branch--feature-foo', 'Repositories', '/storyboard/branch--feature-foo/Repositories'],
    ['/branch--x/', 'branch--feature-foo/', '/canvas/widget/design-system', '/branch--feature-foo/canvas/widget/design-system'],
    ['/storyboard/branch--x/', 'branch--feature-foo/', '/Repositories', '/storyboard/branch--feature-foo/Repositories'],
    ['/branch--x/storyboard/', 'branch--feature-foo/', '/Repositories', '/storyboard/branch--feature-foo/Repositories'],
  ])('composes %s + %s + %s', (branchBasePath, folder, route, expected) => {
    const href = buildBranchArtifactHref(branchBasePath, folder, route)
    expect(href).toBe(expected)
    expect(href).not.toMatch(/\/\/+/)
  })
})

describe('mergeArtifactIndexIntoPrototypeIndex', () => {
  it('returns the input unchanged when remoteIndex is null', () => {
    const localIndex = makeLocalIndex()
    expect(mergeArtifactIndexIntoPrototypeIndex(localIndex, null, 'main')).toBe(localIndex)
  })

  it('adds branches to local prototypes and canvases sorted main-first and excluding current branch', () => {
    const localIndex = makeLocalIndex()
    const remoteIndex = makeRemoteIndex()
    remoteIndex.prototypes.Dashboard = {
      id: 'Dashboard',
      branches: [
        { branch: 'zeta', folder: 'branch--zeta/', title: 'Dashboard Z', route: '/Repositories', folderName: 'apps' },
        { branch: 'feature/foo', folder: 'branch--feature-foo/', title: 'Dashboard Feature', route: '/Repositories', folderName: 'apps' },
        { branch: 'main', folder: '', title: 'Dashboard Main', route: '/Repositories', folderName: 'apps' },
        { branch: 'alpha', folder: 'branch--alpha/', title: 'Dashboard A', route: '/Repositories', folderName: 'apps' },
      ],
    }
    remoteIndex.canvases['widget/design-system'] = {
      id: 'widget/design-system',
      branches: [
        { branch: 'feature/foo', folder: 'branch--feature-foo/', name: 'Design Feature', route: '/canvas/widget/design-system', folderName: 'widget' },
        { branch: 'main', folder: '', name: 'Design Main', route: '/canvas/widget/design-system', folderName: 'widget' },
        { branch: 'beta', folder: 'branch--beta/', name: 'Design Beta', route: '/canvas/widget/design-system', folderName: 'widget' },
      ],
    }

    const merged = mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'feature/foo')

    expect(merged.prototypes.find(proto => proto.dirName === 'Dashboard').branches.map(branch => branch.branch)).toEqual(['main', 'alpha', 'zeta'])
    expect(merged.canvases.find(canvas => canvas.dirName === 'widget/design-system').branches.map(branch => branch.branch)).toEqual(['main', 'beta'])
  })

  it('adds branches to local folder prototypes and canvases', () => {
    const localIndex = makeLocalIndex()
    const remoteIndex = makeRemoteIndex()
    remoteIndex.prototypes.FolderProto = {
      id: 'FolderProto',
      branches: [
        { branch: 'main', folder: '', title: 'Folder Proto', route: '/FolderProto', folderName: 'folder' },
        { branch: 'topic', folder: 'branch--topic/', title: 'Folder Proto', route: '/FolderProto', folderName: 'folder' },
      ],
    }
    remoteIndex.canvases['folder/canvas'] = {
      id: 'folder/canvas',
      branches: [
        { branch: 'main', folder: '', name: 'Folder Canvas', route: '/canvas/folder/canvas', folderName: 'folder' },
        { branch: 'topic', folder: 'branch--topic/', name: 'Folder Canvas', route: '/canvas/folder/canvas', folderName: 'folder' },
      ],
    }

    const merged = mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'main')

    expect(merged.folders[0].prototypes[0].branches.map(branch => branch.branch)).toEqual(['topic'])
    expect(merged.folders[0].canvases[0].branches.map(branch => branch.branch)).toEqual(['topic'])
  })

  it('matches canvases across branches by folder-independent name (no duplicate when a canvas moved folders)', () => {
    // Local canvas lives at the root ("design-system"); the remote index has the
    // same canvas keyed under a folder path ("widget/design-system") because it
    // sits inside a folder on other branches. They are the same canvas and must
    // collapse into a single card — never a duplicate branch-only entry.
    const localIndex = makeLocalIndex()
    localIndex.canvases = [
      { name: 'Design System', dirName: 'design-system', folder: null, route: '/canvas/design-system', isCanvas: true },
    ]
    const remoteIndex = makeRemoteIndex()
    remoteIndex.canvases['widget/design-system'] = {
      id: 'widget/design-system',
      branches: [
        { branch: 'main', folder: '', name: 'Design System', route: '/canvas/design-system', folderName: null },
        { branch: 'topic', folder: 'branch--topic/', name: 'Design System', route: '/canvas/widget/design-system', folderName: 'widget' },
      ],
    }

    const merged = mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'main')

    const matches = merged.canvases.filter(canvas => canvas.name === 'Design System')
    expect(matches).toHaveLength(1)
    expect(matches[0].dirName).toBe('design-system')
    expect(matches[0].isBranchOnly).toBeFalsy()
    expect(matches[0].branches.map(branch => branch.branch)).toEqual(['topic'])
  })

  it('merges branches for the same canvas split across folder-path keys in a legacy index', () => {
    // A legacy (pre-collapse) index can hold the same canvas under two keys —
    // one at the root, one under a folder. The merge must fold both branch
    // lists into a single local card.
    const localIndex = makeLocalIndex()
    localIndex.canvases = [
      { name: 'Design System', dirName: 'design-system', folder: null, route: '/canvas/design-system', isCanvas: true },
    ]
    const remoteIndex = makeRemoteIndex()
    remoteIndex.canvases['design-system'] = {
      id: 'design-system',
      branches: [{ branch: 'main', folder: '', name: 'Design System', route: '/canvas/design-system', folderName: null }],
    }
    remoteIndex.canvases['widget/design-system'] = {
      id: 'widget/design-system',
      branches: [{ branch: 'topic', folder: 'branch--topic/', name: 'Design System', route: '/canvas/widget/design-system', folderName: 'widget' }],
    }

    const merged = mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'main')

    const matches = merged.canvases.filter(canvas => canvas.name === 'Design System')
    expect(matches).toHaveLength(1)
    expect(matches[0].branches.map(branch => branch.branch)).toEqual(['topic'])
  })

  it('synthesizes remote-only prototype and canvas cards with prefixed IDs', () => {
    const localIndex = makeLocalIndex()
    const remoteIndex = makeRemoteIndex()
    remoteIndex.prototypes.Remote = {
      id: 'Remote',
      branches: [
        { branch: 'main', folder: '', title: 'Remote Prototype', description: 'From main', route: '/Remote', isExternal: false, externalUrl: null, folderName: 'experiments', lastModified: '2026-01-01T00:00:00Z' },
      ],
    }
    remoteIndex.canvases['experiments/remote-canvas'] = {
      id: 'experiments/remote-canvas',
      branches: [
        { branch: 'feature/canvas', folder: 'branch--feature-canvas/', name: 'Remote Canvas', route: '/canvas/experiments/remote-canvas', folderName: 'experiments', lastModified: '2026-01-02T00:00:00Z' },
      ],
    }

    const merged = mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'main')
    const proto = merged.prototypes.find(entry => entry.id === 'branch-proto:Remote')
    const canvas = merged.canvases.find(entry => entry.id === 'branch-canvas:experiments/remote-canvas')

    expect(proto).toMatchObject({ isBranchOnly: true, name: 'Remote Prototype', description: 'From main', folder: 'experiments' })
    expect(proto.branches.map(branch => branch.branch)).toEqual(['main'])
    expect(canvas).toMatchObject({ isBranchOnly: true, name: 'Remote Canvas', folder: 'experiments', route: '/canvas/experiments/remote-canvas' })
    expect(canvas.branches.map(branch => branch.branch)).toEqual(['feature/canvas'])
  })

  it('prefers main for synthesized metadata, otherwise the latest lastModified branch', () => {
    const localIndex = makeLocalIndex()
    const remoteIndex = makeRemoteIndex()
    remoteIndex.prototypes.MainWins = {
      id: 'MainWins',
      branches: [
        { branch: 'feature/newer', folder: 'branch--feature-newer/', title: 'Feature Title', description: 'Feature desc', route: '/MainWins', folderName: 'feature-folder', lastModified: '2026-02-01T00:00:00Z' },
        { branch: 'main', folder: '', title: 'Main Title', description: 'Main desc', route: '/MainWins', folderName: 'main-folder', lastModified: '2026-01-01T00:00:00Z' },
      ],
    }
    remoteIndex.prototypes.LatestWins = {
      id: 'LatestWins',
      branches: [
        { branch: 'older', folder: 'branch--older/', title: 'Older Title', description: 'Older desc', route: '/LatestWins', folderName: 'old-folder', lastModified: '2026-01-01T00:00:00Z' },
        { branch: 'newer', folder: 'branch--newer/', title: 'Newer Title', description: 'Newer desc', route: '/LatestWins', folderName: 'new-folder', lastModified: '2026-03-01T00:00:00Z' },
      ],
    }

    const merged = mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'main')
    const mainWins = merged.prototypes.find(entry => entry.id === 'branch-proto:MainWins')
    const latestWins = merged.prototypes.find(entry => entry.id === 'branch-proto:LatestWins')

    expect(mainWins).toMatchObject({ name: 'Main Title', description: 'Main desc', folder: 'main-folder' })
    expect(latestWins).toMatchObject({ name: 'Newer Title', description: 'Newer desc', folder: 'new-folder' })
  })

  it('does not mutate inputs', () => {
    const localIndex = makeLocalIndex()
    const remoteIndex = makeRemoteIndex()
    remoteIndex.prototypes.Dashboard = {
      id: 'Dashboard',
      branches: [{ branch: 'main', folder: '', title: 'Dashboard', route: '/Dashboard', folderName: 'apps' }],
    }
    const before = JSON.stringify({ localIndex, remoteIndex })

    mergeArtifactIndexIntoPrototypeIndex(localIndex, remoteIndex, 'feature/foo')

    expect(JSON.stringify({ localIndex, remoteIndex })).toBe(before)
    expect(localIndex.prototypes[0]).not.toHaveProperty('branches')
  })
})
