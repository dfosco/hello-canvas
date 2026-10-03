import { describe, it, expect } from 'vitest'
import { hasUncommittedChanges, localBranchExists, resolveDefaultBranch } from './dev-helpers.js'
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// These tests run against the real git repo — they verify the helpers
// work correctly with actual git state.

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()

describe('hasUncommittedChanges', () => {
  it('returns a boolean', () => {
    const result = hasUncommittedChanges(repoRoot)
    expect(typeof result).toBe('boolean')
  })

  it('returns false for non-existent directory', () => {
    expect(hasUncommittedChanges('/tmp/nonexistent-repo-12345')).toBe(false)
  })
})

describe('localBranchExists', () => {
  it('returns true for a branch that exists', () => {
    const testRepo = mkdtempSync(join(tmpdir(), 'storyboard-dev-helpers-'))
    try {
      execFileSync('git', ['init', '--quiet', '-b', 'fixture'], { cwd: testRepo })
      execFileSync('git', [
        '-c', 'user.name=Storyboard Test',
        '-c', 'user.email=storyboard-test@example.com',
        'commit', '--quiet', '--allow-empty', '-m', 'create fixture branch',
      ], { cwd: testRepo })
      expect(localBranchExists('fixture', testRepo)).toBe(true)
    } finally {
      rmSync(testRepo, { recursive: true, force: true })
    }
  })

  it('returns false for a branch that does not exist', () => {
    expect(localBranchExists('__nonexistent-branch-xyz-99999__', repoRoot)).toBe(false)
  })

  it('returns false for invalid cwd', () => {
    expect(localBranchExists('main', '/tmp/nonexistent-repo-12345')).toBe(false)
  })
})

describe('resolveDefaultBranch', () => {
  it('returns a string or null', () => {
    const result = resolveDefaultBranch(repoRoot)
    expect(result === null || typeof result === 'string').toBe(true)
  })

  it('prefers main over master when main exists', () => {
    // If main exists in this repo, it should be the default
    if (localBranchExists('main', repoRoot)) {
      expect(resolveDefaultBranch(repoRoot)).toBe('main')
    }
  })

  it('returns null for non-git directory', () => {
    expect(resolveDefaultBranch('/tmp')).toBe(null)
  })
})
