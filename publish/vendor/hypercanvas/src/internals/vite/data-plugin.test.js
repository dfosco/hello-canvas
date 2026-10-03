import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import storyboardDataPlugin, { resolveTemplateVars, computeTemplateVars, parseDataFile, buildDataDiscovery } from './data-plugin.js'

const RESOLVED_ID = '\0virtual:storyboard-data-index'

let tmpDir

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'sb-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function createPlugin(root) {
  const plugin = storyboardDataPlugin()
  plugin.configResolved({ root: root ?? tmpDir })
  return plugin
}

function writeDataFiles(dir) {
  writeFileSync(
    path.join(dir, 'default.scene.json'),
    JSON.stringify({ title: 'Test' }),
  )
  writeFileSync(
    path.join(dir, 'user.object.json'),
    JSON.stringify({ name: 'Jane' }),
  )
  writeFileSync(
    path.join(dir, 'posts.record.json'),
    JSON.stringify([{ id: '1', title: 'First' }]),
  )
}

describe('storyboardDataPlugin', () => {
  it("has name 'storyboard-data'", () => {
    const plugin = storyboardDataPlugin()
    expect(plugin.name).toBe('storyboard-data')
  })

  it("has enforce 'pre'", () => {
    const plugin = storyboardDataPlugin()
    expect(plugin.enforce).toBe('pre')
  })

  it('config() excludes @dfosco/hypercanvas from optimizeDeps', () => {
    const plugin = storyboardDataPlugin()
    const config = plugin.config()
    expect(config.optimizeDeps.exclude).toContain('@dfosco/hypercanvas')
  })

  it('config() includes markdown pipeline stack in optimizeDeps so Vite pre-bundles transitive CJS deps', () => {
    const plugin = storyboardDataPlugin()
    const config = plugin.config()
    expect(config.optimizeDeps.include).toContain('remark-parse')
    expect(config.optimizeDeps.include).toContain('remark-gfm')
    expect(config.optimizeDeps.include).toContain('rehype-sanitize')
  })

  it("resolveId returns resolved ID for 'virtual:storyboard-data-index'", () => {
    const plugin = createPlugin()
    expect(plugin.resolveId('virtual:storyboard-data-index')).toBe(RESOLVED_ID)
  })

  it('resolveId returns undefined for other IDs', () => {
    const plugin = createPlugin()
    expect(plugin.resolveId('some-other-module')).toBeUndefined()
  })

  it('load generates valid module code with init() call', () => {
    writeDataFiles(tmpDir)
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain("import { init, initKnobs } from '@dfosco/hypercanvas/core'")
    expect(code).toContain('init({ flows, objects, records, prototypes, folders, canvases, stories })')
    expect(code).toContain('"Test"')
    expect(code).toContain('"Jane"')
    expect(code).toContain('"First"')
    // Backward-compat alias
    expect(code).toContain('const scenes = flows')
    expect(code).toContain('export { flows, scenes, objects, records, prototypes, prototypeKnobs, componentKnobs, folders, canvases, canvasAliases, stories }')
  })

  it('rebuilds the virtual data index when the active Notebook root changes', () => {
    const firstRoot = path.join(tmpDir, 'first')
    const secondRoot = path.join(tmpDir, 'second')
    mkdirSync(firstRoot)
    mkdirSync(secondRoot)
    writeFileSync(path.join(firstRoot, 'first.flow.json'), JSON.stringify({ title: 'First Notebook' }))
    writeFileSync(path.join(secondRoot, 'second.flow.json'), JSON.stringify({ title: 'Second Notebook' }))
    const previousRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT

    try {
      process.env.HYPERCANVAS_NOTEBOOK_ROOT = firstRoot
      const plugin = createPlugin(tmpDir)
      expect(plugin.load(RESOLVED_ID)).toContain('First Notebook')

      process.env.HYPERCANVAS_NOTEBOOK_ROOT = secondRoot
      const switchedCode = plugin.load(RESOLVED_ID)
      expect(switchedCode).toContain('Second Notebook')
      expect(switchedCode).not.toContain('First Notebook')
    } finally {
      if (previousRoot === undefined) delete process.env.HYPERCANVAS_NOTEBOOK_ROOT
      else process.env.HYPERCANVAS_NOTEBOOK_ROOT = previousRoot
    }
  })

  it('load returns null for other IDs', () => {
    const plugin = createPlugin()
    expect(plugin.load('other-id')).toBeNull()
  })

  it('duplicate data files throw an error', () => {
    writeFileSync(
      path.join(tmpDir, 'dup.scene.json'),
      JSON.stringify({ a: 1 }),
    )
    const subDir = path.join(tmpDir, 'nested')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(
      path.join(subDir, 'dup.scene.json'),
      JSON.stringify({ a: 2 }),
    )

    const plugin = createPlugin()
    expect(() => plugin.load(RESOLVED_ID)).toThrow(/Duplicate flow "dup"/)
  })

  it('allows same object name in global and prototype without clash', () => {
    mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true })
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'data', 'user.object.json'),
      JSON.stringify({ name: 'Global' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'user.object.json'),
      JSON.stringify({ name: 'Local' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // Both should exist without error
    expect(code).toContain('"user"')
    expect(code).toContain('"Dashboard/user"')
    expect(code).toContain('"Global"')
    expect(code).toContain('"Local"')
  })

  it('allows same object name in different prototypes without clash', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'A'), { recursive: true })
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'B'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'A', 'nav.object.json'),
      JSON.stringify({ from: 'A' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'B', 'nav.object.json'),
      JSON.stringify({ from: 'B' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"A/nav"')
    expect(code).toContain('"B/nav"')
  })

  it('handles JSONC files (with comments)', () => {
    writeFileSync(
      path.join(tmpDir, 'commented.scene.jsonc'),
      '{\n  // This is a comment\n  "title": "JSONC Scene"\n}\n',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"JSONC Scene"')
  })

  it('normalizes .scene files into flow category in the index', () => {
    writeFileSync(
      path.join(tmpDir, 'legacy.scene.json'),
      JSON.stringify({ title: 'Legacy Scene' }),
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // .scene.json files should be normalized to the flows category
    expect(code).toContain('"Legacy Scene"')
    expect(code).toContain('init({ flows, objects, records, prototypes, folders, canvases, stories })')
  })

  it('buildStart resets the index cache', () => {
    writeDataFiles(tmpDir)
    const plugin = createPlugin()

    // First load builds the index
    const code1 = plugin.load(RESOLVED_ID)
    expect(code1).toContain('"Test"')

    // Add a new file
    writeFileSync(
      path.join(tmpDir, 'extra.scene.json'),
      JSON.stringify({ title: 'Extra' }),
    )

    // Without buildStart, cached index is used — "Extra" won't appear
    const code2 = plugin.load(RESOLVED_ID)
    expect(code2).not.toContain('"Extra"')

    // After buildStart, index is rebuilt
    plugin.buildStart()
    const code3 = plugin.load(RESOLVED_ID)
    expect(code3).toContain('"Extra"')
  })
})

describe('prototype scoping', () => {
  it('prefixes flows inside src/prototypes/{Name}/ with the prototype name', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'default.flow.json'),
      JSON.stringify({ title: 'Dashboard Default' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'signup.flow.json'),
      JSON.stringify({ title: 'Dashboard Signup' }),
    )
    // Global flow in src/data/
    mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'data', 'default.flow.json'),
      JSON.stringify({ title: 'Global Default' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Dashboard/default"')
    expect(code).toContain('"Dashboard/signup"')
    expect(code).toContain('"default"')
    expect(code).toContain('"Dashboard Default"')
    expect(code).toContain('"Global Default"')
  })

  it('prefixes records inside src/prototypes/{Name}/ with the prototype name', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Blog'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Blog', 'posts.record.json'),
      JSON.stringify([{ id: '1', title: 'Scoped Post' }]),
    )
    // Global record
    mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'data', 'posts.record.json'),
      JSON.stringify([{ id: '1', title: 'Global Post' }]),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Blog/posts"')
    expect(code).toContain('"posts"')
    expect(code).toContain('"Scoped Post"')
    expect(code).toContain('"Global Post"')
  })

  it('prefixes objects inside src/prototypes/{Name}/', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'helpers.object.json'),
      JSON.stringify({ util: true }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // Object should be scoped as "Dashboard/helpers"
    expect(code).toContain('"Dashboard/helpers"')
  })

  it('allows same flow name in different prototypes without clash', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'A'), { recursive: true })
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'B'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'A', 'default.flow.json'),
      JSON.stringify({ from: 'A' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'B', 'default.flow.json'),
      JSON.stringify({ from: 'B' }),
    )

    const plugin = createPlugin()
    // Should not throw (no duplicate)
    const code = plugin.load(RESOLVED_ID)
    expect(code).toContain('"A/default"')
    expect(code).toContain('"B/default"')
  })

  it('normalizes .scene.json inside prototypes to scoped flow', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Legacy'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Legacy', 'old.scene.json'),
      JSON.stringify({ compat: true }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // Should be indexed as a scoped flow, not a scene
    expect(code).toContain('"Legacy/old"')
    expect(code).toContain('flows')
  })
})

describe('flow route inference', () => {
  it('injects _route for flows inside src/prototypes/', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'default.flow.json'),
      JSON.stringify({ title: 'Dashboard Flow' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"_route":"/Dashboard"')
  })

  it('injects _route for flows inside .folder/ directories', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'MyFolder.folder', 'Example'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'MyFolder.folder', 'Example', 'basic.flow.json'),
      JSON.stringify({ title: 'Example Flow' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // .folder/ should be stripped from the inferred route
    expect(code).toContain('"_route":"/Example"')
    expect(code).not.toContain('MyFolder')
  })

  it('injects _route with nested path for deeply placed flows', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'App', 'settings'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'App', 'settings', 'prefs.flow.json'),
      JSON.stringify({ title: 'Settings Prefs' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"_route":"/App/settings"')
  })

  it('does NOT inject _route for global flows outside src/prototypes/', () => {
    mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'data', 'global.flow.json'),
      JSON.stringify({ title: 'Global Flow' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).not.toContain('"_route"')
  })

  it('does NOT inject _route when flow has explicit route field', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'custom.flow.json'),
      JSON.stringify({ route: '/custom-page', title: 'Custom Route' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // Should have the explicit route but NOT _route
    expect(code).toContain('"route":"/custom-page"')
    expect(code).not.toContain('"_route"')
  })

  it('does not log info when multiple flows share the same route', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'happy.flow.json'),
      JSON.stringify({ title: 'Happy Path' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'error.flow.json'),
      JSON.stringify({ title: 'Error State' }),
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const routeLog = logSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('Route "/Dashboard" has 2 flows')
    )
    expect(routeLog).toBeUndefined()
    logSpy.mockRestore()
  })

  it('warns when multiple flows on same route have meta.default: true', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'a.flow.json'),
      JSON.stringify({ meta: { default: true }, title: 'A' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'b.flow.json'),
      JSON.stringify({ meta: { default: true }, title: 'B' }),
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const warnCall = warnSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('meta.default: true')
    )
    expect(warnCall).toBeTruthy()
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

describe('folder grouping', () => {
  it('discovers .folder.json files and keys them by folder directory name', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Getting Started.folder'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Getting Started.folder', 'getting-started.folder.json'),
      JSON.stringify({ meta: { title: 'Getting Started', description: 'Intro' } }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Getting Started"')
    expect(code).toContain('"Intro"')
    expect(code).toContain('folders')
  })

  it('scopes prototypes inside .folder/ directories correctly', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'MyFolder.folder', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'MyFolder.folder', 'Dashboard', 'default.flow.json'),
      JSON.stringify({ title: 'Dashboard Default' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'MyFolder.folder', 'Dashboard', 'dashboard.prototype.json'),
      JSON.stringify({ meta: { title: 'Dashboard' } }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // Flow should be scoped to prototype, not folder
    expect(code).toContain('"Dashboard/default"')
    expect(code).not.toContain('"MyFolder.folder/default"')
    expect(code).not.toContain('"MyFolder/default"')
    // Prototype should have folder field injected
    expect(code).toContain('"folder":"MyFolder"')
  })

  it('scopes objects inside .folder/ directories to their prototype', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'X.folder', 'Proto'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'X.folder', 'Proto', 'helpers.object.json'),
      JSON.stringify({ util: true }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    // Object should be scoped to prototype, not folder
    expect(code).toContain('"Proto/helpers"')
    expect(code).not.toContain('"X/helpers"')
  })

  it('scopes records inside .folder/ directories to their prototype', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'X.folder', 'Blog'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'X.folder', 'Blog', 'posts.record.json'),
      JSON.stringify([{ id: '1', title: 'Post' }]),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Blog/posts"')
    expect(code).not.toContain('"X/posts"')
  })

  it('keeps duplicate prototype-scoped flows out of the runtime index and reports their conflict', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'A.folder', 'Settings'), { recursive: true })
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'B.folder', 'Settings'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'A.folder', 'Settings', 'default.flow.json'),
      JSON.stringify({ from: 'A' }),
    )
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'B.folder', 'Settings', 'default.flow.json'),
      JSON.stringify({ from: 'B' }),
    )

    const discovery = buildDataDiscovery(tmpDir)
    expect(discovery.flows['Settings/default']).toBeUndefined()
    expect(discovery._dataScopeConflicts).toEqual([
      expect.objectContaining({ name: 'Settings/default', suffix: 'flow', paths: expect.any(Array) }),
    ])
  })

  it('throws on nested .folder/ directories', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Outer.folder', 'Inner.folder', 'Proto'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Outer.folder', 'Inner.folder', 'Proto', 'default.flow.json'),
      JSON.stringify({ title: 'Nested' }),
    )

    const plugin = createPlugin()
    expect(() => plugin.load(RESOLVED_ID)).toThrow(/Nested .folder directories are not supported/)
  })

  it('throws on empty nested .folder/ directories', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Outer.folder', 'Inner.folder'), { recursive: true })

    const plugin = createPlugin()
    expect(() => plugin.load(RESOLVED_ID)).toThrow(/Nested .folder directories are not supported/)
  })
})

describe('underscore prefix ignoring', () => {
  it('ignores _-prefixed data files', () => {
    writeFileSync(
      path.join(tmpDir, '_draft.flow.json'),
      JSON.stringify({ title: 'Draft' }),
    )
    writeFileSync(
      path.join(tmpDir, 'visible.flow.json'),
      JSON.stringify({ title: 'Visible' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Visible"')
    expect(code).not.toContain('"Draft"')
  })

  it('ignores data files inside _-prefixed directories', () => {
    mkdirSync(path.join(tmpDir, '_archive'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, '_archive', 'old.flow.json'),
      JSON.stringify({ title: 'Archived' }),
    )
    writeFileSync(
      path.join(tmpDir, 'current.flow.json'),
      JSON.stringify({ title: 'Current' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Current"')
    expect(code).not.toContain('"Archived"')
  })

  it('ignores prototype.json inside _-prefixed directories', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', '_WIP'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', '_WIP', 'wip.prototype.json'),
      JSON.stringify({ meta: { title: 'Work in Progress' } }),
    )
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Live'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Live', 'live.prototype.json'),
      JSON.stringify({ meta: { title: 'Live' } }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Live"')
    expect(code).not.toContain('"Work in Progress"')
  })

  it('does not ignore files with _ in the middle of the name', () => {
    writeFileSync(
      path.join(tmpDir, 'my_flow.flow.json'),
      JSON.stringify({ title: 'Has Underscore' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"Has Underscore"')
  })
})

describe('resolveTemplateVars', () => {
  it('replaces variables in a simple string', () => {
    const result = resolveTemplateVars('/${currentDir}/page', { currentDir: 'src/data' })
    expect(result).toBe('/src/data/page')
  })

  it('replaces multiple variables in one string', () => {
    const result = resolveTemplateVars('${currentProto} in ${currentProtoDir}', {
      currentProto: 'src/prototypes/main.folder/Example',
      currentProtoDir: 'src/prototypes/main.folder',
    })
    expect(result).toBe('src/prototypes/main.folder/Example in src/prototypes/main.folder')
  })

  it('replaces variables in nested objects', () => {
    const input = {
      nav: { url: '/${currentDir}/page', label: 'Go' },
      meta: { proto: '${currentProto}' },
    }
    const vars = { currentDir: 'src/data', currentProto: 'src/prototypes/App' }
    const result = resolveTemplateVars(input, vars)

    expect(result.nav.url).toBe('/src/data/page')
    expect(result.nav.label).toBe('Go')
    expect(result.meta.proto).toBe('src/prototypes/App')
  })

  it('replaces variables in arrays', () => {
    const input = ['/${currentDir}/a', '/${currentDir}/b']
    const result = resolveTemplateVars(input, { currentDir: 'here' })
    expect(result).toEqual(['/here/a', '/here/b'])
  })

  it('replaces variables in deeply nested structures', () => {
    const input = {
      items: [
        { links: [{ url: '/${currentDir}/x' }] },
      ],
    }
    const result = resolveTemplateVars(input, { currentDir: 'deep' })
    expect(result.items[0].links[0].url).toBe('/deep/x')
  })

  it('does not modify non-string values', () => {
    const input = { count: 42, active: true, empty: null }
    const result = resolveTemplateVars(input, { currentDir: 'test' })
    expect(result).toEqual({ count: 42, active: true, empty: null })
  })

  it('returns input unchanged when no variables match', () => {
    const input = { url: '/static/path', name: 'no vars here' }
    const result = resolveTemplateVars(input, { currentDir: 'test' })
    expect(result).toEqual(input)
  })

  it('leaves unknown variable patterns as-is', () => {
    const result = resolveTemplateVars('${unknownVar}/path', { currentDir: 'test' })
    expect(result).toBe('${unknownVar}/path')
  })

  it('does not mutate the original object', () => {
    const input = { url: '/${currentDir}/page' }
    const original = JSON.parse(JSON.stringify(input))
    resolveTemplateVars(input, { currentDir: 'test' })
    expect(input).toEqual(original)
  })

  it('handles empty vars object', () => {
    const input = { url: '/${currentDir}/page' }
    const result = resolveTemplateVars(input, {})
    expect(result.url).toBe('/${currentDir}/page')
  })

  it('handles multiple occurrences of the same variable', () => {
    const result = resolveTemplateVars('${currentDir}/${currentDir}', { currentDir: 'x' })
    expect(result).toBe('x/x')
  })
})

describe('computeTemplateVars', () => {
  it('computes currentDir for a file in src/data/', () => {
    const root = '/project'
    const absPath = '/project/src/data/nav.object.json'
    const vars = computeTemplateVars(absPath, root)

    expect(vars.currentDir).toBe('src/data')
    expect(vars.currentProto).toBe('')
    expect(vars.currentProtoDir).toBe('')
  })

  it('computes all three vars for a file in a prototype inside a folder', () => {
    const root = '/project'
    const absPath = '/project/src/prototypes/main.folder/Example/sidenav.object.json'
    const vars = computeTemplateVars(absPath, root)

    expect(vars.currentDir).toBe('src/prototypes/main.folder/Example')
    expect(vars.currentProto).toBe('src/prototypes/main.folder/Example')
    expect(vars.currentProtoDir).toBe('src/prototypes/main.folder')
  })

  it('computes vars for a file in a subdirectory of a prototype', () => {
    const root = '/project'
    const absPath = '/project/src/prototypes/main.folder/Example/data/deep.object.json'
    const vars = computeTemplateVars(absPath, root)

    expect(vars.currentDir).toBe('src/prototypes/main.folder/Example/data')
    expect(vars.currentProto).toBe('src/prototypes/main.folder/Example')
    expect(vars.currentProtoDir).toBe('src/prototypes/main.folder')
  })

  it('computes vars for a file in a prototype without a folder', () => {
    const root = '/project'
    const absPath = '/project/src/prototypes/Dashboard/nav.object.json'
    const vars = computeTemplateVars(absPath, root)

    expect(vars.currentDir).toBe('src/prototypes/Dashboard')
    expect(vars.currentProto).toBe('src/prototypes/Dashboard')
    expect(vars.currentProtoDir).toBe('')
  })

  it('computes vars for a root-level file', () => {
    const root = '/project'
    const absPath = '/project/config.object.json'
    const vars = computeTemplateVars(absPath, root)

    expect(vars.currentDir).toBe('.')
    expect(vars.currentProto).toBe('')
    expect(vars.currentProtoDir).toBe('')
  })

  it('returns empty currentProto for a file directly inside a .folder (not in a prototype)', () => {
    const root = '/project'
    const absPath = '/project/src/prototypes/main.folder/nav.object.json'
    const vars = computeTemplateVars(absPath, root)

    expect(vars.currentDir).toBe('src/prototypes/main.folder')
    expect(vars.currentProto).toBe('')
    expect(vars.currentProtoDir).toBe('src/prototypes/main.folder')
  })
})

describe('template variable integration', () => {
  it('resolves ${currentDir} in object files', () => {
    mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'data', 'nav.object.json'),
      JSON.stringify({ url: '/${currentDir}/page' }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('/src/data/page')
    expect(code).not.toContain('${currentDir}')
  })

  it('resolves ${currentProto} and ${currentProtoDir} in prototype files', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'App.folder', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'App.folder', 'Dashboard', 'nav.object.json'),
      JSON.stringify({
        proto: '${currentProto}',
        folder: '${currentProtoDir}',
        dir: '${currentDir}',
      }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('src/prototypes/App.folder/Dashboard')
    expect(code).toContain('src/prototypes/App.folder')
    expect(code).not.toContain('${currentProto}')
    expect(code).not.toContain('${currentProtoDir}')
    expect(code).not.toContain('${currentDir}')
  })

  it('resolves variables in flow files', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Example.folder', 'Demo'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Example.folder', 'Demo', 'default.flow.json'),
      JSON.stringify({
        nav: [{ label: 'Home', url: '/${currentDir}' }],
      }),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('/src/prototypes/Example.folder/Demo')
    expect(code).not.toContain('${currentDir}')
  })

  it('resolves variables in record files', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Blog'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Blog', 'posts.record.json'),
      JSON.stringify([
        { id: '1', link: '/${currentProto}/post/1' },
      ]),
    )

    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('/src/prototypes/Blog/post/1')
    expect(code).not.toContain('${currentProto}')
  })

  it('warns when ${currentProto} is used outside a prototype', () => {
    mkdirSync(path.join(tmpDir, 'src', 'data'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'data', 'nav.object.json'),
      JSON.stringify({ url: '/${currentProto}/page' }),
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const warnCall = warnSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('${currentProto}')
    )
    expect(warnCall).toBeTruthy()
    warnSpy.mockRestore()
  })

  it('warns when ${currentProtoDir} is used outside a .folder', () => {
    mkdirSync(path.join(tmpDir, 'src', 'prototypes', 'Dashboard'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'prototypes', 'Dashboard', 'nav.object.json'),
      JSON.stringify({ folder: '${currentProtoDir}' }),
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const warnCall = warnSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('${currentProtoDir}')
    )
    expect(warnCall).toBeTruthy()
    warnSpy.mockRestore()
  })
})

// ── Canvas watcher / HMR tests ──────────────────────────────────────

describe('canvas watcher behavior', () => {
  /** Helper: create a mock Vite dev server for configureServer */
  function createMockServer(root) {
    const listeners = {}
    const wsSent = []
    const invalidatedModules = []
    const middlewareHandlers = []

    return {
      wsSent,
      invalidatedModules,
      listeners,
      config: { root, base: '/' },
      watcher: {
        add: vi.fn(),
        on(event, fn) {
          if (!listeners[event]) listeners[event] = []
          listeners[event].push(fn)
        },
      },
      moduleGraph: {
        getModuleById(id) {
          if (id === RESOLVED_ID) return { id: RESOLVED_ID }
          return null
        },
        invalidateModule(mod) {
          invalidatedModules.push(mod.id)
        },
      },
      ws: {
        send(msg) { wsSent.push(msg) },
      },
      middlewares: {
        handlers: middlewareHandlers,
        use(fn) { middlewareHandlers.push(fn) },
      },
    }
  }

  /** Emit a watcher event on the mock server */
  function emit(server, event, filePath) {
    for (const fn of (server.listeners[event] || [])) {
      fn(filePath)
    }
  }

  function writeCanvasFile(dir, name, title) {
    const canvasDir = path.join(dir, 'src', 'canvas')
    mkdirSync(canvasDir, { recursive: true })
    const evt = { event: 'canvas_created', title: title || name, timestamp: Date.now() }
    writeFileSync(path.join(canvasDir, `${name}.canvas.jsonl`), JSON.stringify(evt) + '\n')
  }

  async function invokeMiddleware(server, req) {
    const response = {
      statusCode: 200,
      headers: null,
      body: '',
      writeHead(statusCode, headers) {
        this.statusCode = statusCode
        this.headers = headers
      },
      end(body = '') { this.body += body },
    }
    const request = {
      ...req,
      [Symbol.asyncIterator]: async function* () {
        if (req.body) yield req.body
      },
    }
    for (const handler of server.middlewares.handlers) {
      let passed = false
      await handler(request, response, () => { passed = true })
      if (!passed) break
    }
    return response
  }

  it('reads and writes storyboard.config.json in the external Notebook root', async () => {
    const notebookRoot = path.join(tmpDir, 'notebook')
    mkdirSync(notebookRoot, { recursive: true })
    writeFileSync(
      path.join(notebookRoot, 'storyboard.config.json'),
      '{\n  "featureFlags": {\n    "fromNotebook": false\n  }\n}\n',
    )
    const previousRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT
    process.env.HYPERCANVAS_NOTEBOOK_ROOT = notebookRoot

    try {
      const plugin = createPlugin(tmpDir)
      const server = createMockServer(tmpDir)
      plugin.configureServer(server)

      const getResponse = await invokeMiddleware(server, { method: 'GET', url: '/_storyboard/config' })
      expect(getResponse.statusCode).toBe(200)
      expect(JSON.parse(getResponse.body).raw).toContain('fromNotebook')

      const putResponse = await invokeMiddleware(server, {
        method: 'PUT',
        url: '/_storyboard/config',
        body: JSON.stringify({ updates: { 'featureFlags.fromNotebook': true } }),
      })
      expect(putResponse.statusCode).toBe(200)
      expect(JSON.parse(readFileSync(path.join(notebookRoot, 'storyboard.config.json'), 'utf8')).featureFlags.fromNotebook).toBe(true)
      expect(existsSync(path.join(tmpDir, 'storyboard.config.json'))).toBe(false)
    } finally {
      if (previousRoot === undefined) delete process.env.HYPERCANVAS_NOTEBOOK_ROOT
      else process.env.HYPERCANVAS_NOTEBOOK_ROOT = previousRoot
    }
  })

  it('soft-invalidates virtual module on canvas content change (no full-reload)', () => {
    writeCanvasFile(tmpDir, 'test-canvas', 'Original Title')
    const plugin = createPlugin()
    // Force initial buildResult
    plugin.load(RESOLVED_ID)

    const server = createMockServer(tmpDir)
    plugin.configureServer(server)

    // Simulate a canvas file content change
    const canvasPath = path.join(tmpDir, 'src', 'canvas', 'test-canvas.canvas.jsonl')
    emit(server, 'change', canvasPath)

    // Should have sent custom HMR event (not full-reload)
    const customEvents = server.wsSent.filter(m => m.type === 'custom')
    const fullReloads = server.wsSent.filter(m => m.type === 'full-reload')

    expect(customEvents.length).toBe(1)
    expect(customEvents[0].event).toBe('storyboard:canvas-file-changed')
    expect(customEvents[0].data.canvasId).toBe('test-canvas')
    expect(fullReloads.length).toBe(0)

    // Should have invalidated the virtual module
    expect(server.invalidatedModules).toContain(RESOLVED_ID)
  })

  it('includes metadata in HMR event for canvas content changes', () => {
    writeCanvasFile(tmpDir, 'meta-canvas', 'My Canvas Title')
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const server = createMockServer(tmpDir)
    plugin.configureServer(server)

    emit(server, 'change', path.join(tmpDir, 'src', 'canvas', 'meta-canvas.canvas.jsonl'))

    const event = server.wsSent.find(m => m.type === 'custom')
    expect(event.data.metadata).toBeDefined()
    expect(event.data.metadata.title).toBe('My Canvas Title')
  })

  it('soft-invalidates on canvas file add (new canvas)', () => {
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const server = createMockServer(tmpDir)
    plugin.configureServer(server)

    // Create the file after the server is configured
    writeCanvasFile(tmpDir, 'new-canvas', 'Brand New')
    emit(server, 'add', path.join(tmpDir, 'src', 'canvas', 'new-canvas.canvas.jsonl'))

    const customEvents = server.wsSent.filter(m => m.type === 'custom')
    const fullReloads = server.wsSent.filter(m => m.type === 'full-reload')

    expect(customEvents.length).toBe(1)
    expect(customEvents[0].data.canvasId).toBe('new-canvas')
    expect(customEvents[0].data.metadata).toBeDefined()
    expect(fullReloads.length).toBe(0)
    expect(server.invalidatedModules).toContain(RESOLVED_ID)
  })

  it('keeps external Notebook canvas IDs content-relative in watcher events', () => {
    const notebookRoot = path.join(tmpDir, 'notebook')
    const canvasDir = path.join(notebookRoot, 'canvas')
    mkdirSync(canvasDir, { recursive: true })
    const canvasPath = path.join(canvasDir, 'welcome.canvas.jsonl')
    writeFileSync(canvasPath, `${JSON.stringify({ event: 'canvas_created', title: 'Welcome Canvas' })}\n`)
    const previousRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT
    process.env.HYPERCANVAS_NOTEBOOK_ROOT = notebookRoot

    try {
      const plugin = createPlugin(tmpDir)
      plugin.load(RESOLVED_ID)
      const server = createMockServer(tmpDir)
      plugin.configureServer(server)

      emit(server, 'add', canvasPath)

      const event = server.wsSent.find(message => message.type === 'custom')
      expect(event.data.canvasId).toBe('welcome')
      expect(event.data.canvasId).not.toBe('canvas/welcome')
    } finally {
      if (previousRoot === undefined) delete process.env.HYPERCANVAS_NOTEBOOK_ROOT
      else process.env.HYPERCANVAS_NOTEBOOK_ROOT = previousRoot
    }
  })

  it('soft-invalidates on canvas file unlink after timeout (true delete)', async () => {
    writeCanvasFile(tmpDir, 'doomed-canvas', 'Gone Soon')
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const server = createMockServer(tmpDir)
    plugin.configureServer(server)

    emit(server, 'unlink', path.join(tmpDir, 'src', 'canvas', 'doomed-canvas.canvas.jsonl'))

    // Immediately after unlink — no event yet (deferred by 1500ms)
    expect(server.wsSent.length).toBe(0)

    // Wait for deferred timer
    await new Promise(resolve => setTimeout(resolve, 1600))

    const customEvents = server.wsSent.filter(m => m.type === 'custom')
    expect(customEvents.length).toBe(1)
    expect(customEvents[0].data.canvasId).toBe('doomed-canvas')
    expect(customEvents[0].data.removed).toBe(true)
    expect(server.invalidatedModules).toContain(RESOLVED_ID)
  })

  it('cancels deferred unlink on add (atomic write / in-place save)', async () => {
    writeCanvasFile(tmpDir, 'saved-canvas', 'Saved')
    const plugin = createPlugin()
    plugin.load(RESOLVED_ID)

    const server = createMockServer(tmpDir)
    plugin.configureServer(server)

    const canvasPath = path.join(tmpDir, 'src', 'canvas', 'saved-canvas.canvas.jsonl')

    // Simulate atomic write: unlink then add within 1500ms
    emit(server, 'unlink', canvasPath)
    emit(server, 'add', canvasPath)

    // Should have sent one event immediately (the add cancelling the unlink)
    const customEvents = server.wsSent.filter(m => m.type === 'custom')
    expect(customEvents.length).toBe(1)
    expect(customEvents[0].data.canvasId).toBe('saved-canvas')
    expect(customEvents[0].data.removed).toBeUndefined()
    expect(server.invalidatedModules).toContain(RESOLVED_ID)

    // Wait past the unlink timer — should NOT get a second event
    await new Promise(resolve => setTimeout(resolve, 1600))
    const allCustom = server.wsSent.filter(m => m.type === 'custom')
    expect(allCustom.length).toBe(1)
  })

  it('handleHotUpdate returns empty array for canvas files (suppresses full-reload)', () => {
    const plugin = createPlugin()
    const result = plugin.handleHotUpdate({
      file: path.join(tmpDir, 'src', 'canvas', 'test.canvas.jsonl'),
      server: createMockServer(tmpDir),
      modules: [],
    })
    expect(result).toEqual([])
  })

  it('handleHotUpdate does not send duplicate HMR events', () => {
    const plugin = createPlugin()
    const server = createMockServer(tmpDir)
    plugin.handleHotUpdate({
      file: path.join(tmpDir, 'src', 'canvas', 'test.canvas.jsonl'),
      server,
      modules: [],
    })
    // handleHotUpdate should NOT send events (invalidate() handles it)
    expect(server.wsSent.length).toBe(0)
  })

  it('generated virtual module includes server-event listener for canvas updates', () => {
    writeCanvasFile(tmpDir, 'hmr-canvas', 'HMR Test')
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('window.addEventListener')
    expect(code).toContain('storyboard:canvas-file-changed')
    expect(code).toContain('import.meta.hot.on("storyboard:canvas-file-changed"')
    expect(code).toContain('data.removed')
    expect(code).toContain('data.metadata')
    // Should merge into existing entries to preserve build-time fields
    expect(code).toContain('Object.assign')
  })

  it('page refresh after canvas add yields updated module with new canvas', () => {
    const plugin = createPlugin()
    // First load — no canvases
    const code1 = plugin.load(RESOLVED_ID)
    expect(code1).not.toContain('"refresh-canvas"')

    // Simulate adding a canvas and clearing buildResult (what softInvalidate does)
    writeCanvasFile(tmpDir, 'refresh-canvas', 'After Refresh')

    // Manually clear buildResult by loading a fresh plugin instance with the same root
    const plugin2 = createPlugin()
    const code2 = plugin2.load(RESOLVED_ID)
    expect(code2).toContain('"refresh-canvas"')
    expect(code2).toContain('After Refresh')
  })

  // ── Story file discovery ──────────────────────────────────────────

  it('discovers .story.jsx files and generates _storyImport', () => {
    writeDataFiles(tmpDir)
    writeFileSync(
      path.join(tmpDir, 'button-patterns.story.jsx'),
      'export function Primary() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"button-patterns"')
    expect(code).toContain('_storyModule')
    expect(code).toContain('_storyImport')
    expect(code).toContain('.story.jsx')
  })

  it('uses Vite filesystem imports for stories in an external Notebook', () => {
    const notebookRoot = path.join(tmpDir, 'notebook')
    const applicationRoot = path.join(tmpDir, 'application')
    const storyPath = path.join(notebookRoot, 'components', 'Slider', 'slider.story.jsx')
    mkdirSync(path.dirname(storyPath), { recursive: true })
    mkdirSync(applicationRoot)
    writeFileSync(storyPath, 'export function Default() { return null }')

    const plugin = storyboardDataPlugin({
      notebookRuntime: { status: () => ({ root: notebookRoot }) },
    })
    plugin.configResolved({ root: applicationRoot })
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain(`"_storyModule":"/@fs/${storyPath}"`)
    expect(code).toContain(`import("/@fs/${storyPath}")`)
    expect(code).not.toContain('import("/components/Slider/slider.story.jsx")')
  })

  it('discovers .story.tsx files', () => {
    writeDataFiles(tmpDir)
    writeFileSync(
      path.join(tmpDir, 'card.story.tsx'),
      'export function Default() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"card"')
    expect(code).toContain('card.story.tsx')
  })

  it('skips _-prefixed story files', () => {
    writeDataFiles(tmpDir)
    writeFileSync(
      path.join(tmpDir, '_draft.story.jsx'),
      'export function Draft() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).not.toContain('"_draft"')
  })

  it('throws on duplicate story names', () => {
    writeDataFiles(tmpDir)
    mkdirSync(path.join(tmpDir, 'a'), { recursive: true })
    mkdirSync(path.join(tmpDir, 'b'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'a', 'dupe.story.jsx'),
      'export function A() { return null }',
    )
    writeFileSync(
      path.join(tmpDir, 'b', 'dupe.story.jsx'),
      'export function B() { return null }',
    )
    const plugin = createPlugin()
    expect(() => plugin.load(RESOLVED_ID)).toThrow(/Duplicate story "dupe"/)
  })

  it('includes stories in the init() call and exports', () => {
    writeDataFiles(tmpDir)
    writeFileSync(
      path.join(tmpDir, 'test.story.jsx'),
      'export function Test() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('const stories = {')
    expect(code).toContain('init({ flows, objects, records, prototypes, folders, canvases, stories })')
    expect(code).toContain('export { flows, scenes, objects, records, prototypes, prototypeKnobs, componentKnobs, folders, canvases, canvasAliases, stories }')
  })

  it('infers /components/ route for stories in src/canvas/', () => {
    writeDataFiles(tmpDir)
    mkdirSync(path.join(tmpDir, 'src', 'canvas'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'canvas', 'button-patterns.story.jsx'),
      'export function Primary() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"button-patterns"')
    expect(code).toContain('"/components/button-patterns"')
    expect(code).toContain('_route')
  })

  it('infers /components/ route for stories in src/components/', () => {
    writeDataFiles(tmpDir)
    mkdirSync(path.join(tmpDir, 'src', 'components'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, 'src', 'components', 'text-input.story.jsx'),
      'export function Default() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"text-input"')
    expect(code).toContain('"/components/text-input"')
  })

  it('stories outside src/canvas/ or src/components/ have no inferred route', () => {
    writeDataFiles(tmpDir)
    writeFileSync(
      path.join(tmpDir, 'orphan.story.jsx'),
      'export function Default() { return null }',
    )
    const plugin = createPlugin()
    const code = plugin.load(RESOLVED_ID)

    expect(code).toContain('"orphan"')
    // Should not have _route since it's not in a recognized directory
    expect(code).not.toContain('"/orphan"')
  })
})

describe('parseDataFile — canvas path-based IDs', () => {
  it('flat canvas in src/canvas/ gets basename-only ID', () => {
    const result = parseDataFile('src/canvas/overview.canvas.jsonl')
    expect(result.name).toBe('overview')
    expect(result.inferredRoute).toBe('/canvas/overview')
    expect(result.group).toBeNull()
  })

  it('canvas inside .folder/ gets path-based ID', () => {
    const result = parseDataFile('src/canvas/research.folder/interviews.canvas.jsonl')
    expect(result.name).toBe('research/interviews')
    expect(result.inferredRoute).toBe('/canvas/research/interviews')
    expect(result.group).toBe('research')
  })

  it('duplicate basenames in different folders get distinct IDs', () => {
    const a = parseDataFile('src/canvas/alpha.folder/overview.canvas.jsonl')
    const b = parseDataFile('src/canvas/beta.folder/overview.canvas.jsonl')
    expect(a.name).toBe('alpha/overview')
    expect(b.name).toBe('beta/overview')
    expect(a.name).not.toBe(b.name)
  })

  it('prototype-scoped canvas gets path-based ID', () => {
    const result = parseDataFile('src/prototypes/Dashboard/plan.canvas.jsonl')
    expect(result.name).toBe('Dashboard/plan')
    expect(result.inferredRoute).toBe('/canvas/Dashboard/plan')
  })

  it('prototype inside .folder/ strips folder from ID', () => {
    const result = parseDataFile('src/prototypes/main.folder/Dashboard/plan.canvas.jsonl')
    expect(result.name).toBe('Dashboard/plan')
    expect(result.inferredRoute).toBe('/canvas/Dashboard/plan')
  })

  it('skips _-prefixed canvas files', () => {
    expect(parseDataFile('src/canvas/_draft.canvas.jsonl')).toBeNull()
  })

  it('skips canvas files in _-prefixed directories', () => {
    expect(parseDataFile('src/canvas/_hidden/public.canvas.jsonl')).toBeNull()
  })

  it('includes canvas files inside drafts/ dirs and preserves legacy routes', () => {
    const file = parseDataFile('src/canvas/drafts/scratch.canvas.jsonl')
    expect(file).not.toBeNull()
    expect(file.name).toBe('drafts/scratch')
    // Public route drops `drafts/` so locally-gitignored canvases reuse the
    // same URL as their non-prefixed counterpart.
    expect(file.inferredRoute).toBe('/canvas/scratch')
    const inDir = parseDataFile('src/canvas/drafts/private/notes.canvas.jsonl')
    expect(inDir).not.toBeNull()
    expect(inDir.name).toBe('drafts/private/notes')
    expect(inDir.inferredRoute).toBe('/canvas/private/notes')
    const inSubdir = parseDataFile('src/canvas/dfosco-explorations/drafts/notes.canvas.jsonl')
    expect(inSubdir).not.toBeNull()
    expect(inSubdir.name).toBe('dfosco-explorations/drafts/notes')
    expect(inSubdir.inferredRoute).toBe('/canvas/dfosco-explorations/notes')
  })

  it('canvas outside known directories gets basename-only ID', () => {
    const result = parseDataFile('random/path/notes.canvas.jsonl')
    expect(result.name).toBe('notes')
    expect(result.inferredRoute).toBeNull()
  })

  it('sets group for grouped canvases', () => {
    const result = parseDataFile('src/canvas/ux.folder/onboarding.canvas.jsonl')
    expect(result.group).toBe('ux')
  })

  it('sets group to null for ungrouped canvases', () => {
    const result = parseDataFile('src/canvas/standalone.canvas.jsonl')
    expect(result.group).toBeNull()
  })
})

describe('buildDataDiscovery — legacy drafts paths', () => {
  function writePage(dir, name, title) {
    const evt = { event: 'canvas_created', title, timestamp: Date.now() }
    writeFileSync(path.join(dir, `${name}.canvas.jsonl`), JSON.stringify(evt) + '\n')
  }

  it('attaches .meta.json to a drafts/ canvas group (drafts-stripped key reconciliation)', () => {
    const groupDir = path.join(tmpDir, 'src', 'canvas', 'drafts', 'security-vision')
    mkdirSync(groupDir, { recursive: true })
    writePage(groupDir, '1-security-vision', 'Security Vision')
    writePage(groupDir, '2-confidence-scores', 'Confidence Scores')
    writeFileSync(
      path.join(groupDir, 'security-vision.meta.json'),
      JSON.stringify({
        title: 'Security Vision',
        pageOrder: ['security-vision/1-security-vision', 'security-vision/2-confidence-scores'],
      }),
    )

    const discovery = buildDataDiscovery(tmpDir)
    const page = discovery.canvases['drafts/security-vision/1-security-vision']
    expect(page).toBeTruthy()
    expect(page._group).toBe('security-vision')
    // Before the fix this was null because the meta was keyed under
    // "drafts/security-vision" while the group lookup used "security-vision".
    expect(page._canvasMeta).toBeTruthy()
    expect(page._canvasMeta.title).toBe('Security Vision')
  })

  it('includes prototype stories and data under drafts while reporting colliding data scopes', () => {
    const publicProto = path.join(tmpDir, 'src', 'prototypes', 'Dashboard')
    const draftProto = path.join(tmpDir, 'src', 'prototypes', 'drafts', 'Dashboard')
    mkdirSync(publicProto, { recursive: true })
    mkdirSync(draftProto, { recursive: true })
    writeFileSync(path.join(publicProto, 'user.object.json'), JSON.stringify({ label: 'public' }))
    writeFileSync(path.join(draftProto, 'user.object.json'), JSON.stringify({ label: 'draft' }))
    writeFileSync(path.join(draftProto, 'Preview.story.jsx'), 'export function Preview() { return null }')

    const discovery = buildDataDiscovery(tmpDir)
    expect(discovery._dataScopeConflicts).toHaveLength(1)
    expect(discovery._dataScopeConflicts[0].name).toBe('Dashboard/user')
    expect(discovery.objects['Dashboard/user']).toBeUndefined()
    expect(discovery.stories.Preview).toBeTruthy()
  })
})

describe('buildDataDiscovery — content-only Notebook boundaries', () => {
  it('excludes generated publish canvases from the editable index', () => {
    const sourceDir = path.join(tmpDir, 'canvas')
    const publishDir = path.join(tmpDir, 'publish', 'canvas')
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(publishDir, { recursive: true })
    const event = JSON.stringify({ event: 'canvas_created', title: 'Welcome', timestamp: Date.now() }) + '\n'
    writeFileSync(path.join(sourceDir, 'welcome.canvas.jsonl'), event)
    writeFileSync(path.join(publishDir, 'welcome.canvas.jsonl'), event)

    const discovery = buildDataDiscovery(tmpDir, { contentOnly: true })
    expect(Object.keys(discovery.canvases)).toEqual(['welcome'])
  })
})

describe('storyboardDataPlugin — notebook prototype route map', () => {
  const VIRTUAL_ID = 'virtual:storyboard-notebook-prototype-routes'

  afterEach(() => {
    delete process.env.HYPERCANVAS_NOTEBOOK_ROOT
  })

  it('resolves itself and serves Notebook prototypes when a Notebook root is active', () => {
    const notebook = mkdtempSync(path.join(tmpdir(), 'sb-nb-routes-'))
    try {
      mkdirSync(path.join(notebook, 'prototypes', 'Landing'), { recursive: true })
      writeFileSync(path.join(notebook, 'prototypes', 'Landing', 'index.jsx'), 'export default function Landing() {}')
      process.env.HYPERCANVAS_NOTEBOOK_ROOT = notebook

      const plugin = storyboardDataPlugin()
      plugin.configResolved({ root: tmpDir })

      expect(plugin.resolveId(VIRTUAL_ID)).toBe(VIRTUAL_ID)
      const source = plugin.load(VIRTUAL_ID)
      expect(source).toContain('"/src/prototypes/Landing/index.jsx"')
      expect(source).toContain(path.join(notebook, 'prototypes', 'Landing', 'index.jsx'))
    } finally {
      rmSync(notebook, { recursive: true, force: true })
    }
  })

  it('serves an empty map without an active Notebook (scaffold repos keep their glob routes)', () => {
    const plugin = storyboardDataPlugin()
    plugin.configResolved({ root: tmpDir })
    const source = plugin.load(VIRTUAL_ID)
    expect(source).toContain('export const PROTOTYPE_ROUTES = {')
    expect(source).toContain('export const PROTOTYPE_MODALS = {')
    expect(source).not.toContain('import(')
  })
})
