import { describe, it, expect } from 'vitest'
import { cleanupOrphanedGitignore } from './migrateLegacyGitignore.js'

const BLOCK_START = '# <!-- storyboard:scaffold/gitignore:runtime-state --start-->'
const BLOCK_END = '# <!-- storyboard:scaffold/gitignore:runtime-state --end-->'

describe('cleanupOrphanedGitignore', () => {
  it('removes legacy lines that were removed from the library entirely', () => {
    const input = [
      '# misc',
      '.DS_Store',
      '',
      '.github/skills/_archive',
      '.github/skills/primer-primitives',
      '# Agent symlinks are build targets — source of truth is .agents/agents/',
      '# storyboard setup creates symlinks for Copilot CLI and Claude Code',
      '.github/agents/_buddy.md',
      '.github/agents/prompt-agent.md',
      '',
      BLOCK_START,
      '.storyboard/',
      BLOCK_END,
      '',
      '# custom',
      'my-dir/',
    ].join('\n')

    const { text, cleaned } = cleanupOrphanedGitignore(input)
    expect(cleaned).toBe(true)
    expect(text).not.toContain('.github/skills/_archive')
    expect(text).not.toContain('.github/agents/_buddy.md')
    expect(text).not.toContain('# Agent symlinks are build targets')
    // User content + the marker block are preserved.
    expect(text).toContain('.DS_Store')
    expect(text).toContain('my-dir/')
    expect(text).toContain(BLOCK_START)
    expect(text).toContain('.storyboard/')
  })

  it('removes an absorbed line outside the block only when it also lives inside', () => {
    const input = [
      '_*.md',
      '.claude/agents/',
      '',
      BLOCK_START,
      '.storyboard/',
      '_*.md',
      '.claude/agents/',
      BLOCK_END,
    ].join('\n')

    const { text, cleaned } = cleanupOrphanedGitignore(input)
    expect(cleaned).toBe(true)
    // The in-block copies survive; the out-of-block duplicates are gone.
    const lines = text.split('\n')
    const startIdx = lines.findIndex((l) => l.includes('runtime-state --start'))
    const endIdx = lines.findIndex((l) => l.includes('runtime-state --end'))
    const outside = lines.slice(0, startIdx)
    const inside = lines.slice(startIdx + 1, endIdx)
    expect(outside).not.toContain('_*.md')
    expect(outside).not.toContain('.claude/agents/')
    expect(inside).toContain('_*.md')
    expect(inside).toContain('.claude/agents/')
  })

  it('does NOT remove an absorbed line that has no in-block copy (sole occurrence)', () => {
    const input = [
      '_*.md',
      '',
      BLOCK_START,
      '.storyboard/',
      BLOCK_END,
    ].join('\n')

    const { text, cleaned } = cleanupOrphanedGitignore(input)
    // No block copy of `_*.md` → keep the only occurrence, nothing to clean.
    expect(cleaned).toBe(false)
    expect(text).toContain('_*.md')
  })

  it('collapses blank-line runs left behind by removals', () => {
    const input = [
      '.DS_Store',
      '',
      '.github/skills/_archive',
      '',
      BLOCK_START,
      '.storyboard/',
      BLOCK_END,
    ].join('\n')

    const { text } = cleanupOrphanedGitignore(input)
    expect(text).not.toMatch(/\n\n\n/)
  })

  it('is a no-op when there are no orphan lines', () => {
    const input = [
      '# misc',
      '.DS_Store',
      '',
      BLOCK_START,
      '.storyboard/',
      BLOCK_END,
    ].join('\n')

    const { text, cleaned } = cleanupOrphanedGitignore(input)
    expect(cleaned).toBe(false)
    expect(text).toBe(input)
  })

  it('leaves removed-tier lines alone if they appear inside the block', () => {
    // Defensive: the block body is never touched.
    const input = [
      BLOCK_START,
      '.github/skills/_archive',
      BLOCK_END,
    ].join('\n')

    const { text, cleaned } = cleanupOrphanedGitignore(input)
    expect(cleaned).toBe(false)
    expect(text).toContain('.github/skills/_archive')
  })
})
