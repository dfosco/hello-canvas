import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildFileTree, isPathAllowed, GLOBAL_IGNORE_DIRS } from '../tree.js'

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tree-test-'))
}

describe('GLOBAL_IGNORE_DIRS', () => {
  it('includes node_modules, .git, dist, worktrees, .storyboard', () => {
    expect(GLOBAL_IGNORE_DIRS.has('node_modules')).toBe(true)
    expect(GLOBAL_IGNORE_DIRS.has('.git')).toBe(true)
    expect(GLOBAL_IGNORE_DIRS.has('dist')).toBe(true)
    expect(GLOBAL_IGNORE_DIRS.has('worktrees')).toBe(true)
    expect(GLOBAL_IGNORE_DIRS.has('.storyboard')).toBe(true)
  })
})

describe('isPathAllowed', () => {
  let root

  beforeEach(() => { root = makeTmpDir() })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  it('allows a plain file inside root', () => {
    const abs = path.join(root, 'src', 'index.js')
    expect(isPathAllowed(root, abs, {})).toBe(true)
  })

  it('rejects path outside repo root', () => {
    expect(isPathAllowed(root, '/etc/passwd', {})).toBe(false)
  })

  it('rejects path inside node_modules', () => {
    const abs = path.join(root, 'node_modules', 'lodash', 'index.js')
    expect(isPathAllowed(root, abs, {})).toBe(false)
  })

  it('rejects path inside .git', () => {
    const abs = path.join(root, '.git', 'config')
    expect(isPathAllowed(root, abs, {})).toBe(false)
  })

  it('rejects path inside .storyboard', () => {
    const abs = path.join(root, '.storyboard', 'terminals', 'session.jsonl')
    expect(isPathAllowed(root, abs, {})).toBe(false)
  })

  it('rejects path inside assets/canvas/images', () => {
    const abs = path.join(root, 'assets', 'canvas', 'images', 'photo.png')
    expect(isPathAllowed(root, abs, {})).toBe(false)
  })

  it('allows path when allowedRoots matches', () => {
    const abs = path.join(root, 'src', 'docs', 'readme.md')
    const config = { fileWidget: { allowedRoots: ['src/docs'] } }
    expect(isPathAllowed(root, abs, config)).toBe(true)
  })

  it('rejects path outside allowedRoots', () => {
    const abs = path.join(root, 'private', 'secret.txt')
    const config = { fileWidget: { allowedRoots: ['src/docs'] } }
    expect(isPathAllowed(root, abs, config)).toBe(false)
  })

  it('allowedRoots empty array = allow anywhere (minus global ignores)', () => {
    const abs = path.join(root, 'src', 'index.js')
    const config = { fileWidget: { allowedRoots: [] } }
    expect(isPathAllowed(root, abs, config)).toBe(true)
  })

  it('global ignore always beats allowedRoots', () => {
    const abs = path.join(root, 'node_modules', 'foo', 'bar.js')
    const config = { fileWidget: { allowedRoots: ['node_modules/foo'] } }
    expect(isPathAllowed(root, abs, config)).toBe(false)
  })
})

describe('buildFileTree', () => {
  let root

  beforeEach(() => { root = makeTmpDir() })
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

  function write(relPath, content = '') {
    const abs = path.join(root, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
  }

  it('returns empty array for empty root', () => {
    expect(buildFileTree(root)).toEqual([])
  })

  it('includes text files', () => {
    write('readme.md', '# hi')
    write('src/index.js', 'export default 1')
    const tree = buildFileTree(root)
    const names = tree.map((n) => n.name)
    expect(names).toContain('readme.md')
    expect(names).toContain('src')
  })

  it('excludes binary files', () => {
    write('photo.png', '\x89PNG\r\n')
    const tree = buildFileTree(root)
    expect(tree.find((n) => n.name === 'photo.png')).toBeUndefined()
  })

  it('excludes node_modules', () => {
    write('node_modules/lodash/index.js', '')
    const tree = buildFileTree(root)
    expect(tree.find((n) => n.name === 'node_modules')).toBeUndefined()
  })

  it('excludes .git', () => {
    write('.git/config', '')
    const tree = buildFileTree(root)
    expect(tree.find((n) => n.name === '.git')).toBeUndefined()
  })

  it('excludes .storyboard', () => {
    write('.storyboard/terminals/session.jsonl', '')
    const tree = buildFileTree(root)
    expect(tree.find((n) => n.name === '.storyboard')).toBeUndefined()
  })

  it('returns nested tree with correct shape', () => {
    write('src/components/Button.jsx', '')
    const tree = buildFileTree(root)
    const src = tree.find((n) => n.name === 'src')
    expect(src).toBeDefined()
    expect(src.kind).toBe('dir')
    expect(src.path).toBe('src')
    const components = src.children.find((n) => n.name === 'components')
    expect(components).toBeDefined()
    const btn = components.children.find((n) => n.name === 'Button.jsx')
    expect(btn).toBeDefined()
    expect(btn.kind).toBe('file')
    expect(btn.path).toBe('src/components/Button.jsx')
  })

  it('respects startDir option', () => {
    write('src/index.js', '')
    write('other/file.ts', '')
    const tree = buildFileTree(root, { startDir: 'src' })
    // Should only see files under src/
    const names = tree.map((n) => n.name)
    expect(names).toContain('index.js')
    // other should not appear
    expect(tree.find((n) => n.name === 'other')).toBeUndefined()
  })

  it('respects allowedRoots config', () => {
    write('src/index.js', '')
    write('private/secret.md', '')
    const config = { fileWidget: { allowedRoots: ['src'] } }
    const tree = buildFileTree(root, { config })
    // private dir should be excluded
    expect(tree.find((n) => n.name === 'private')).toBeUndefined()
    expect(tree.find((n) => n.name === 'src')).toBeDefined()
  })

  it('sorts dirs before files, alphabetically within each group', () => {
    write('z-file.md', '')
    write('a-file.md', '')
    write('z-dir/x.js', '')
    write('a-dir/x.js', '')
    const tree = buildFileTree(root)
    const dirs = tree.filter((n) => n.kind === 'dir').map((n) => n.name)
    const files = tree.filter((n) => n.kind === 'file').map((n) => n.name)
    expect(dirs[0]).toBe('a-dir')
    expect(dirs[1]).toBe('z-dir')
    expect(files[0]).toBe('a-file.md')
    expect(files[1]).toBe('z-file.md')
    // dirs come before files
    const kindOrder = tree.map((n) => n.kind)
    const firstFileIdx = kindOrder.indexOf('file')
    const lastDirIdx = kindOrder.lastIndexOf('dir')
    expect(lastDirIdx).toBeLessThan(firstFileIdx)
  })

  it('omits directories that become empty after filtering', () => {
    write('empty-dir/photo.png', '\x89PNG')
    const tree = buildFileTree(root)
    expect(tree.find((n) => n.name === 'empty-dir')).toBeUndefined()
  })
})
