/**
 * Git helpers for storyboard dev CLI.
 * Extracted for testability — no side effects on import.
 */

import { execFileSync } from 'child_process'

/**
 * Check if the working tree has uncommitted changes (staged or unstaged).
 */
export function hasUncommittedChanges(cwd) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim()
    return status.length > 0
  } catch {
    return false
  }
}

/**
 * Check if a local branch exists.
 */
export function localBranchExists(name, cwd) {
  try {
    execFileSync('git', ['show-ref', '--verify', `refs/heads/${name}`], { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the default branch for the repo root (main, master, or origin/HEAD target).
 * Returns null if none can be determined.
 */
export function resolveDefaultBranch(cwd) {
  // Verify we're actually inside a git repository
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore' })
  } catch {
    return null
  }
  for (const candidate of ['main', 'master']) {
    if (localBranchExists(candidate, cwd)) return candidate
  }
  // Try origin/HEAD
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd, encoding: 'utf8' }).trim()
    const name = ref.replace('refs/remotes/origin/', '')
    if (name && localBranchExists(name, cwd)) return name
  } catch { /* no origin/HEAD */ }
  return null
}
