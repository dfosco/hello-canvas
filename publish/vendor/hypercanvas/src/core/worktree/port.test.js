import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We test the pure functions by importing and overriding cwd
import { portsFilePath, getPort, resolvePort, slugify, repoRoot, worktreeDir, listWorktrees } from './port.js'

describe('slugify', () => {
  it('lowercases and replaces dots with hyphens', () => {
    expect(slugify('v3.11.0')).toBe('v3-11-0')
  })

  it('replaces underscores and spaces', () => {
    expect(slugify('my_cool.feature')).toBe('my-cool-feature')
  })

  it('lowercases', () => {
    expect(slugify('UPPER.Case')).toBe('upper-case')
  })

  it('collapses consecutive hyphens', () => {
    expect(slugify('a..b__c')).toBe('a-b-c')
  })

  it('trims hyphens per segment', () => {
    expect(slugify('.leading')).toBe('leading')
  })

  it('preserves slashes', () => {
    expect(slugify('feat/my.branch')).toBe('feat/my-branch')
  })
})

describe('portsFilePath', () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sb-port-test-')))
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns root worktrees/ports.json from repo root', () => {
    const result = portsFilePath(tempRoot)
    expect(result).toBe(join(tempRoot, 'worktrees', 'ports.json'))
  })

  it('returns shared ports.json from inside a worktree dir', () => {
    // Simulate worktrees/my-branch/
    const worktreeDir = join(tempRoot, 'worktrees', 'my-branch')
    mkdirSync(worktreeDir, { recursive: true })
    const result = portsFilePath(worktreeDir)
    expect(result).toBe(join(tempRoot, 'worktrees', 'ports.json'))
  })

  it('returns shared ports.json from inside a .worktrees/ dir (legacy)', () => {
    const legacyDir = join(tempRoot, '.worktrees', 'my-branch')
    mkdirSync(legacyDir, { recursive: true })
    const result = portsFilePath(legacyDir)
    expect(result).toBe(join(tempRoot, 'worktrees', 'ports.json'))
  })

  it('returns shared ports.json from worktree even when ports.json does not exist', () => {
    // This is the key bug fix — first run from a worktree with no ports.json
    const worktreeDir = join(tempRoot, 'worktrees', 'first-run')
    mkdirSync(worktreeDir, { recursive: true })
    const result = portsFilePath(worktreeDir)
    // Must point to root, NOT to worktrees/first-run/worktrees/ports.json
    expect(result).toBe(join(tempRoot, 'worktrees', 'ports.json'))
    expect(result).not.toContain('first-run/worktrees')
  })
})

describe('getPort / resolvePort', () => {
  let tempRoot
  let originalCwd

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sb-port-test-')))
    mkdirSync(join(tempRoot, 'worktrees'), { recursive: true })
    originalCwd = process.cwd()
    process.chdir(tempRoot)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns 1234 for main', () => {
    expect(getPort('main')).toBe(1234)
  })

  it('falls back to the base port for worktrees without an assignment', () => {
    expect(getPort('my-feature')).toBe(1234)
    // No new assignment is persisted under the single-instance model.
    expect(existsSync(join(tempRoot, 'worktrees', 'ports.json'))).toBe(false)
  })

  it('returns the same port on subsequent calls', () => {
    const first = getPort('stable-branch')
    const second = getPort('stable-branch')
    expect(first).toBe(second)
  })

  it('honors a legacy assignment already present in ports.json', () => {
    const portsFile = join(tempRoot, 'worktrees', 'ports.json')
    writeFileSync(portsFile, JSON.stringify({ main: 1234, legacy: 1235 }))
    expect(getPort('legacy')).toBe(1235)
    expect(getPort('unassigned')).toBe(1234)
  })

  it('resolvePort returns fallback when no ports.json exists', () => {
    expect(resolvePort('unknown')).toBe(1234)
  })

  it('resolvePort returns assigned port', () => {
    const portsFile = join(tempRoot, 'worktrees', 'ports.json')
    writeFileSync(portsFile, JSON.stringify({ main: 1234, known: 1235 }))
    expect(resolvePort('known')).toBe(1235)
  })

  it('handles corrupted ports.json gracefully', () => {
    const portsFile = join(tempRoot, 'worktrees', 'ports.json')
    writeFileSync(portsFile, 'not valid json')
    // Should not throw — starts fresh
    const port = getPort('recovery')
    expect(port).toBe(1234)
  })
})

describe('repoRoot', () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sb-root-test-')))
    mkdirSync(join(tempRoot, 'worktrees', 'my-branch'), { recursive: true })
    mkdirSync(join(tempRoot, '.worktrees', 'legacy-branch'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns cwd when at repo root', () => {
    expect(repoRoot(tempRoot)).toBe(tempRoot)
  })

  it('returns parent of worktrees when inside a worktree', () => {
    const wt = join(tempRoot, 'worktrees', 'my-branch')
    expect(repoRoot(wt)).toBe(tempRoot)
  })

  it('returns parent of .worktrees when inside a legacy worktree', () => {
    const wt = join(tempRoot, '.worktrees', 'legacy-branch')
    expect(repoRoot(wt)).toBe(tempRoot)
  })

})

describe('portsFilePath', () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sb-port-wl-')))
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns worktrees/ports.json from the repo root', () => {
    expect(portsFilePath(tempRoot)).toBe(join(tempRoot, 'worktrees', 'ports.json'))
  })
})

describe('worktreeDir', () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sb-wtdir-test-')))
    mkdirSync(join(tempRoot, 'worktrees'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns repo root for main', () => {
    expect(worktreeDir('main', tempRoot)).toBe(tempRoot)
  })

  it('returns worktrees/<name> for branches', () => {
    expect(worktreeDir('my-feature', tempRoot)).toBe(join(tempRoot, 'worktrees', 'my-feature'))
  })

  it('returns .worktrees/<name> when only legacy dir exists', () => {
    const legacyDir = join(tempRoot, '.worktrees', 'legacy-branch')
    mkdirSync(legacyDir, { recursive: true })
    expect(worktreeDir('legacy-branch', tempRoot)).toBe(legacyDir)
  })

  it('prefers worktrees/<name> over .worktrees/<name> when both exist', () => {
    const currentDir = join(tempRoot, 'worktrees', 'both-branch')
    const legacyDir = join(tempRoot, '.worktrees', 'both-branch')
    mkdirSync(currentDir, { recursive: true })
    mkdirSync(legacyDir, { recursive: true })
    expect(worktreeDir('both-branch', tempRoot)).toBe(currentDir)
  })

  it('falls back to worktrees/<name> when neither exists', () => {
    expect(worktreeDir('new-branch', tempRoot)).toBe(join(tempRoot, 'worktrees', 'new-branch'))
  })
})

describe('listWorktrees', () => {
  let tempRoot

  beforeEach(() => {
    tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'sb-list-test-')))
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns empty array when worktrees does not exist', () => {
    expect(listWorktrees(tempRoot)).toEqual([])
  })

  it('returns only directories with a .git file', () => {
    const wtDir = join(tempRoot, 'worktrees')
    mkdirSync(wtDir)

    // Valid worktree — has .git file
    mkdirSync(join(wtDir, 'valid'))
    writeFileSync(join(wtDir, 'valid', '.git'), 'gitdir: /some/path')

    // Not a worktree — no .git file
    mkdirSync(join(wtDir, 'no-git'))

    // Not a directory — file
    writeFileSync(join(wtDir, 'ports.json'), '{}')

    const result = listWorktrees(tempRoot)
    expect(result).toEqual(['valid'])
  })

  it('returns multiple worktrees', () => {
    const wtDir = join(tempRoot, 'worktrees')
    mkdirSync(wtDir)

    for (const name of ['alpha', 'beta', 'gamma']) {
      mkdirSync(join(wtDir, name))
      writeFileSync(join(wtDir, name, '.git'), 'gitdir: /some/path')
    }

    const result = listWorktrees(tempRoot)
    expect(result.sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('includes worktrees from .worktrees/ (legacy)', () => {
    const legacyDir = join(tempRoot, '.worktrees')
    mkdirSync(legacyDir)

    mkdirSync(join(legacyDir, 'legacy-branch'))
    writeFileSync(join(legacyDir, 'legacy-branch', '.git'), 'gitdir: /some/path')

    const result = listWorktrees(tempRoot)
    expect(result).toEqual(['legacy-branch'])
  })

  it('deduplicates names found in both worktrees/ and .worktrees/', () => {
    const currentDir = join(tempRoot, 'worktrees')
    const legacyDir = join(tempRoot, '.worktrees')
    mkdirSync(currentDir)
    mkdirSync(legacyDir)

    mkdirSync(join(currentDir, 'shared'))
    writeFileSync(join(currentDir, 'shared', '.git'), 'gitdir: /some/path')
    mkdirSync(join(legacyDir, 'shared'))
    writeFileSync(join(legacyDir, 'shared', '.git'), 'gitdir: /some/path')
    mkdirSync(join(legacyDir, 'legacy-only'))
    writeFileSync(join(legacyDir, 'legacy-only', '.git'), 'gitdir: /some/path')

    const result = listWorktrees(tempRoot)
    expect(result.sort()).toEqual(['legacy-only', 'shared'])
  })
})
