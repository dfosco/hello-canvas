/**
 * Migrate legacy ad-hoc `.gitignore` blocks (written by setup.js lines 401–431
 * pre-0.6.10, or copied from the pre-fragment `scaffold/gitignore`) into the
 * new fragment-marker form so subsequent scaffolds keep them in sync via the
 * fragments system.
 *
 * Two legacy forms are handled:
 *
 *   1. The setup.js banner (single trailing block):
 *
 *        # Storyboard: runtime state (gitignored) + private tilde-prefixed files
 *        .storyboard/
 *        src/canvas/images/~*
 *        ... etc.
 *
 *   2. The old scaffold/gitignore split form (two separate blocks):
 *
 *        # Runtime/transient state (per-machine, per-session)
 *        .storyboard/agent-sessions/
 *        ... etc.
 *
 *        # Private canvas images (tilde prefix = not committed)
 *        src/canvas/images/~*
 *        ... etc.
 *
 * After migration both end up as:
 *
 *        # <!-- storyboard:scaffold/gitignore:runtime-state --start-->
 *        ... (library-managed body)
 *        # <!-- storyboard:scaffold/gitignore:runtime-state --end-->
 *
 * Idempotent — if the file already contains the marker, leave it alone.
 */

import fs from 'node:fs'

const SETUP_BANNER =
  '# Storyboard: runtime state (gitignored) + private tilde-prefixed files'

// Legacy split form headers from the pre-fragment scaffold/gitignore. We only
// migrate when BOTH are present to avoid false positives on unrelated content.
const SPLIT_RUNTIME_HEADER = '# Runtime/transient state (per-machine, per-session)'
const SPLIT_PRIVATE_HEADER = '# Private canvas images (tilde prefix = not committed)'

// Other related comments that the pre-fragment scaffold/gitignore wrote — we
// strip them too when migrating the split form so we don't leave orphan
// section headers in the file.
const RELATED_HEADERS = [
  '# Real-time canvas selection bridge for Copilot',
  '# Auto-generated scaffold dir (copies of library config defaults — overwritten on every dev-server boot)',
]

const MARKER_START =
  '# <!-- storyboard:scaffold/gitignore:runtime-state --start-->'
const MARKER_END =
  '# <!-- storyboard:scaffold/gitignore:runtime-state --end-->'

const MARKER_PRESENT_SUBSTRING =
  'storyboard:scaffold/gitignore:runtime-state --start'

/**
 * Detect + rewrite legacy block(s) in a `.gitignore` text.
 *
 * @param {string} text
 * @returns {{ text: string, migrated: boolean }}
 */
export function migrateLegacyGitignore(text) {
  if (text.includes(MARKER_PRESENT_SUBSTRING)) {
    return { text, migrated: false }
  }

  // --- Form 1: single trailing banner from setup.js ---
  const setupIdx = text.indexOf(SETUP_BANNER)
  if (setupIdx !== -1) {
    const before = text.slice(0, setupIdx).trimEnd()
    const afterBanner = text.slice(setupIdx)
    const bannerEnd = afterBanner.indexOf('\n')
    const body = bannerEnd === -1 ? '' : afterBanner.slice(bannerEnd + 1).trimEnd()
    const rewritten =
      before +
      '\n\n' +
      MARKER_START + '\n' +
      (body ? body + '\n' : '') +
      MARKER_END + '\n'
    return { text: rewritten, migrated: true }
  }

  // --- Form 2: split runtime + private sections from old scaffold/gitignore ---
  if (text.includes(SPLIT_RUNTIME_HEADER) && text.includes(SPLIT_PRIVATE_HEADER)) {
    return { text: migrateSplitForm(text), migrated: true }
  }

  return { text, migrated: false }
}

/**
 * Apply the migration to an on-disk `.gitignore`. Returns true if the file
 * was rewritten. Safe to call when the file doesn't exist (returns false).
 *
 * @param {string} gitignorePath
 * @returns {boolean}
 */
export function migrateLegacyGitignoreFile(gitignorePath) {
  if (!fs.existsSync(gitignorePath)) return false
  const text = fs.readFileSync(gitignorePath, 'utf-8')
  const { text: next, migrated } = migrateLegacyGitignore(text)
  if (!migrated) return false
  fs.writeFileSync(gitignorePath, next, 'utf-8')
  return true
}

// ---------------------------------------------------------------------------
// Orphaned-line cleanup
// ---------------------------------------------------------------------------
//
// Before the runtime-state marker block existed, the library shipped these
// entries as plain lines OUTSIDE any marker (the whole `scaffold/gitignore`
// was copied verbatim). Later the library either removed them outright or
// moved them INTO the marker block. Because `.gitignore` is create-only +
// fragment-synced, the out-of-block copies linger forever in existing clients
// as orphans. This cleanup converges those clients on every scaffold run.
//
// Two tiers, both keyed off exact trimmed-line matches:
//   - REMOVED — gone from the library source entirely; always safe to drop.
//   - ABSORBED — now live inside the runtime-state marker block; drop the
//     out-of-block copy ONLY when an in-block copy exists, so we never delete
//     the sole occurrence of a still-needed ignore rule.

const ORPHAN_REMOVED_LINES = [
  '.github/skills/_archive',
  '.github/skills/primer-primitives',
  '.github/skills/primer-components-catalog',
  '.github/skills/primer-screenshot-builder',
  '.github/skills/primer-screenshot-patterns',
  '.github/skills/primer-url-builder',
  '.github/skills/playwright-cli',
  '# Agent symlinks are build targets — source of truth is .agents/agents/',
  '# storyboard setup creates symlinks for Copilot CLI and Claude Code',
  '.github/agents/_buddy-rails.md',
  '.github/agents/_buddy.md',
  '.github/agents/terminal-agent.md',
  '.github/agents/prompt-agent.md',
  'assets/canvas/images/drafts/',
  'src/canvas/**/drafts/',
  'src/prototypes/**/drafts/',
]

const ORPHAN_ABSORBED_LINES = [
  '.worktrees',
  'worktrees',
  '.claude/agents/',
  '_*.md',
  '.sync-target',
]

/**
 * Remove storyboard-managed orphan lines that live outside the runtime-state
 * marker block. Idempotent — once a client is clean, this is a no-op.
 *
 * @param {string} text
 * @returns {{ text: string, cleaned: boolean }}
 */
export function cleanupOrphanedGitignore(text) {
  const lines = text.split(/\r?\n/)

  // Locate the runtime-state marker block so we never touch its body.
  let blockStart = -1
  let blockEnd = -1
  for (let i = 0; i < lines.length; i++) {
    if (blockStart === -1 && lines[i].includes('storyboard:scaffold/gitignore:runtime-state --start')) {
      blockStart = i
    } else if (lines[i].includes('storyboard:scaffold/gitignore:runtime-state --end')) {
      blockEnd = i
    }
  }
  const hasBlock = blockStart !== -1 && blockEnd !== -1 && blockEnd > blockStart

  // Which ABSORBED lines actually appear inside the block? Only those are safe
  // to strip from outside (the block keeps the rule alive).
  const insideBlock = new Set()
  if (hasBlock) {
    for (let i = blockStart + 1; i < blockEnd; i++) insideBlock.add(lines[i].trim())
  }

  const removedSet = new Set(ORPHAN_REMOVED_LINES)
  const out = []
  let cleaned = false
  for (let i = 0; i < lines.length; i++) {
    const isInsideBlock = hasBlock && i > blockStart && i < blockEnd
    if (!isInsideBlock) {
      const trimmed = lines[i].trim()
      if (removedSet.has(trimmed)) {
        cleaned = true
        continue
      }
      if (insideBlock.has(trimmed) && ORPHAN_ABSORBED_LINES.includes(trimmed)) {
        cleaned = true
        continue
      }
    }
    out.push(lines[i])
  }

  if (!cleaned) return { text, cleaned: false }

  // Collapse runs of 2+ blank lines (left behind by removals) into one.
  const collapsed = []
  for (const line of out) {
    if (line.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') {
      continue
    }
    collapsed.push(line)
  }

  return { text: collapsed.join('\n'), cleaned: true }
}

/**
 * Apply orphan cleanup to an on-disk `.gitignore`. Returns true if rewritten.
 *
 * @param {string} gitignorePath
 * @returns {boolean}
 */
export function cleanupOrphanedGitignoreFile(gitignorePath) {
  if (!fs.existsSync(gitignorePath)) return false
  const text = fs.readFileSync(gitignorePath, 'utf-8')
  const { text: next, cleaned } = cleanupOrphanedGitignore(text)
  if (!cleaned) return false
  fs.writeFileSync(gitignorePath, next, 'utf-8')
  return true
}

/**
 * Rewrite Form 2 (split runtime + private sections) into marker form.
 *
 * Walk lines top-to-bottom; when we hit one of the known legacy section
 * headers, consume all following lines until we see a blank line OR a line
 * that doesn't look like part of that section (= doesn't start with `#`,
 * `.storyboard/`, `src/canvas/`, `assets/`, or `.sync-target`).
 *
 * All consumed sections are dropped from the output, and a single marker
 * block is appended at the end. The fragment-replace pass then populates
 * the body from the library source.
 */
function migrateSplitForm(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  const droppedSections = new Set([
    SPLIT_RUNTIME_HEADER,
    SPLIT_PRIVATE_HEADER,
    ...RELATED_HEADERS,
  ])

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (droppedSections.has(line.trim())) {
      // Consume until the next blank line (exclusive of that blank).
      i++
      while (i < lines.length && lines[i].trim() !== '') i++
      // Also consume the blank line itself if present, to avoid double blanks.
      if (i < lines.length && lines[i].trim() === '') i++
      continue
    }
    out.push(line)
    i++
  }

  // Trim trailing blank lines, then append the marker block.
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()

  out.push('')
  out.push(MARKER_START)
  out.push(MARKER_END)
  out.push('')

  return out.join('\n')
}
