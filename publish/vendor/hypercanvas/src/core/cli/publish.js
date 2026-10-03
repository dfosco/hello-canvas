/**
 * storyboard publish — Push local commits to the remote branch (untracked-safe).
 *
 * Deterministic flow (no AI):
 *   1. Stash uncommitted work (including untracked files)
 *   2. Pull --rebase from origin (stay up to date)
 *   3. If conflict: abort rebase, restore stash, inform user
 *   4. Push to origin
 *   5. Re-apply stash
 *
 * Usage:
 *   npx storyboard publish
 *   npx sb publish
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

// eslint-disable-next-line no-unused-vars -- reserved for future use
function hasUnpushedCommits(cwd, branch) {
  try {
    const count = execFileSync(
      'git', ['rev-list', '--count', `origin/${branch}..${branch}`],
      { cwd, encoding: 'utf8' }
    ).trim()
    return parseInt(count, 10) > 0
  } catch {
    // Remote branch may not exist yet — that's fine, we'll push anyway
    return true
  }
}

p.intro('storyboard publish')

const wtName = detectWorktreeName()
const root = repoRoot()
const cwd = wtName === 'main' ? root : worktreeDir(wtName)
const branch = currentBranch(cwd)

p.log.info(`Branch: ${bold(branch)}`)

// 1. Stash uncommitted work (including untracked files)
let stashSha = null
if (hasUncommittedChanges(cwd)) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const message = `publish-stash-${branch}-${ts}`
  p.log.step('Stashing uncommitted work…')
  try {
    execFileSync('git', ['stash', 'push', '-u', '-m', message], { cwd, stdio: 'pipe' })
    stashSha = execFileSync('git', ['stash', 'list', '--format=%H', '-1'], { cwd, encoding: 'utf8' }).trim()
    p.log.success(`Work stashed: ${dim(message)}`)
  } catch {
    p.log.warning('Could not stash changes — proceeding anyway')
  }
}

// 2. Pull --rebase from origin first
const pullSpin = p.spinner()
pullSpin.start('Pulling latest from remote')

try {
  execFileSync('git', ['pull', '--rebase', 'origin', branch], { cwd, stdio: 'pipe' })
  pullSpin.stop('Up to date with origin')
} catch {
  pullSpin.stop('Pull failed — conflict detected')

  // Abort rebase to restore clean state
  try {
    execFileSync('git', ['rebase', '--abort'], { cwd, stdio: 'pipe' })
    p.log.step('Rebase aborted — working tree restored')
  } catch {
    // May not be in rebase state
  }

  // Re-apply stash
  if (stashSha) {
    try {
      execFileSync('git', ['stash', 'apply', stashSha], { cwd, stdio: 'pipe' })
      p.log.success('Stashed work restored')
    } catch {
      p.log.warning(`Could not restore stash — find it with: ${dim('git stash list')}`)
    }
  }

  p.log.error('Could not publish — there are conflicts with the remote branch.')
  p.log.info('')
  p.log.info(`  Resolve conflicts manually:`)
  p.log.info(`    ${green('git pull --rebase origin ' + branch)}`)
  p.log.info(`    ${dim('Fix conflicts, then:')} ${green('git rebase --continue')}`)
  p.log.info(`    ${green('git push origin ' + branch)}`)
  p.log.info('')
  p.log.info(`  Or ask an agent to help resolve the conflicts.`)
  p.outro('')
  process.exit(1)
}

// 3. Push to origin
const pushSpin = p.spinner()
pushSpin.start('Publishing to remote')

try {
  execFileSync('git', ['push', 'origin', branch], { cwd, stdio: 'pipe' })
  pushSpin.stop('Published to origin')
} catch (err) {
  pushSpin.stop('Push failed')
  void err // unused but kept for debugging

  // Re-apply stash before exiting
  if (stashSha) {
    try {
      execFileSync('git', ['stash', 'apply', stashSha], { cwd, stdio: 'pipe' })
      p.log.success('Stashed work restored')
    } catch {
      p.log.warning(`Could not restore stash — find it with: ${dim('git stash list')}`)
    }
  }

  p.log.error('Could not push to remote.')
  p.log.info('')
  p.log.info(`  Try manually:`)
  p.log.info(`    ${green('git push origin ' + branch)}`)
  p.log.info('')
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

p.log.success(`${bold(branch)} published to origin`)
p.outro('')
