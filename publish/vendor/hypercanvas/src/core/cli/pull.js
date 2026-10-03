/**
 * storyboard pull — Pull latest changes from remote (untracked-safe).
 *
 * Deterministic flow (no AI):
 *   1. Stash uncommitted work (including untracked files)
 *   2. Pull --rebase from origin
 *   3. If conflict: abort rebase, restore stash, inform user
 *   4. If clean: re-apply stash
 *
 * Usage:
 *   npx storyboard pull
 *   npx sb pull
 */

import * as p from '@clack/prompts'
import { execFileSync } from 'child_process'
import { detectWorktreeName, worktreeDir, repoRoot } from '../worktree/port.js'
import { hasUncommittedChanges } from './dev-helpers.js'
import { dim, green, bold } from './intro.js'

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

p.intro('storyboard pull')

const wtName = detectWorktreeName()
const root = repoRoot()
const cwd = wtName === 'main' ? root : worktreeDir(wtName)
const branch = currentBranch(cwd)

p.log.info(`Branch: ${bold(branch)}`)

// 1. Stash uncommitted work (including untracked files)
let stashSha = null
if (hasUncommittedChanges(cwd)) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const message = `pull-stash-${branch}-${ts}`
  p.log.step('Stashing uncommitted work…')
  try {
    execFileSync('git', ['stash', 'push', '-u', '-m', message], { cwd, stdio: 'pipe' })
    stashSha = execFileSync('git', ['stash', 'list', '--format=%H', '-1'], { cwd, encoding: 'utf8' }).trim()
    p.log.success(`Work stashed: ${dim(message)}`)
  } catch {
    p.log.warning('Could not stash changes — proceeding anyway')
  }
}

// 2. Pull --rebase from origin
const spin = p.spinner()
spin.start('Pulling latest changes')

let pullFailed = false
try {
  execFileSync('git', ['pull', '--rebase', 'origin', branch], { cwd, stdio: 'pipe' })
  spin.stop('Up to date with origin')
} catch (err) {
  spin.stop('Pull failed — conflict detected')
  pullFailed = true
  void err // unused but kept for debugging

  // 3. Abort the rebase to restore clean state
  try {
    execFileSync('git', ['rebase', '--abort'], { cwd, stdio: 'pipe' })
    p.log.step('Rebase aborted — working tree restored')
  } catch {
    // May not be in rebase state
  }

  // Re-apply stash if we stashed
  if (stashSha) {
    try {
      execFileSync('git', ['stash', 'apply', stashSha], { cwd, stdio: 'pipe' })
      p.log.success('Stashed work restored')
    } catch {
      p.log.warning(`Could not restore stash — find it with: ${dim('git stash list')}`)
    }
  }

  p.log.error('Could not pull — there are conflicts with the remote branch.')
  p.log.info('')
  p.log.info(`  Resolve conflicts manually:`)
  p.log.info(`    ${green('git pull --rebase origin ' + branch)}`)
  p.log.info(`    ${dim('Fix conflicts, then:')} ${green('git rebase --continue')}`)
  p.log.info('')
  p.log.info(`  Or ask an agent to help resolve the conflicts.`)
  p.outro('')
  process.exit(1)
}

// 4. Re-apply stash
if (stashSha) {
  try {
    execFileSync('git', ['stash', 'apply', stashSha], { cwd, stdio: 'pipe' })
    p.log.success('Previous work restored')
  } catch {
    p.log.warning('Stash apply had conflicts — resolve them manually')
    p.log.info(`  Your work is safe in ${dim('git stash list')}`)
  }
}

if (!pullFailed) {
  p.log.success(`${bold(branch)} is up to date`)
}

p.outro('')
