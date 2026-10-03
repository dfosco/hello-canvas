/**
 * storyboard branch — Interactive guide to switch to a branch worktree.
 *
 * Deterministic flow (no AI):
 *   1. Ask which branch to work on (or accept --worktree flag)
 *   2. If existing worktree:
 *      a. Stash uncommitted work in source (named stash)
 *      b. Ensure target is on the correct branch
 *      c. Apply source stash in target
 *   3. If new worktree:
 *      a. Stash uncommitted work in source
 *      b. Create worktree (git worktree add + npm install)
 *      c. Pull --rebase from origin
 *      d. Apply source stash in target
 *   4. Confirm to user
 *
 * Also available as post-setup prompt in setup.js.
 *
 * Usage:
 *   npx storyboard branch                    # interactive
 *   npx storyboard branch <name>             # positional, skip prompt
 *   npx storyboard branch --worktree=<name>  # non-interactive flag
 */

import * as p from '@clack/prompts'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { repoRoot, worktreeDir, listWorktrees, getPort, detectWorktreeName } from '../worktree/port.js'
import { hasUncommittedChanges, localBranchExists } from './dev-helpers.js'
import { parseFlags } from './flags.js'
import { dim, green, bold } from './intro.js'

const flagSchema = {
  worktree: { type: 'string', description: 'Target worktree/branch name (non-interactive)' },
  cd: { type: 'boolean', default: false, description: 'Output shell-evaluable cd command (for eval)' },
}

/** Check if a remote branch exists on origin. */
function remoteBranchExists(name, cwd) {
  try {
    const result = execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', name], { cwd, encoding: 'utf8' })
    return result.trim().length > 0
  } catch {
    return false
  }
}

/** Get the current branch name in a given directory. */
function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** Validate a branch name for git. */
function isValidBranchName(name) {
  if (!name || name.trim().length === 0) return 'Branch name cannot be empty'
  const n = name.trim()
  if (/\s/.test(n)) return 'Branch name cannot contain spaces'
  if (/\.\./.test(n)) return 'Branch name cannot contain ".."'
  if (/[~^:\\]/.test(n)) return 'Branch name cannot contain ~, ^, :, or \\'
  if (n.startsWith('-')) return 'Branch name cannot start with "-"'
  if (n.endsWith('.lock')) return 'Branch name cannot end with ".lock"'
  return undefined
}

/** Build a timestamped stash message. */
function stashMessage(from, to) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return `from-${from}-to-${to}-${ts}`
}

/**
 * Stash uncommitted changes (including untracked files) and return the stash ref SHA.
 * Returns null if nothing was stashed.
 */
function stashChanges(cwd, message) {
  if (!hasUncommittedChanges(cwd)) return null

  p.log.step('Stashing uncommitted work…')
  try {
    execFileSync('git', ['stash', 'push', '-u', '-m', message], { cwd, stdio: 'pipe' })
    // Capture the exact stash SHA so we can apply it by ref later
    const sha = execFileSync('git', ['stash', 'list', '--format=%H', '-1'], { cwd, encoding: 'utf8' }).trim()
    p.log.success(`Work stashed: ${dim(message)}`)
    return sha
  } catch {
    p.log.warning('Could not stash changes — proceeding anyway')
    return null
  }
}

/**
 * Apply a specific stash by SHA in the given directory.
 * Uses apply (not pop) so the backup remains in the stash list.
 */
function applyStash(cwd, stashSha) {
  try {
    execFileSync('git', ['stash', 'apply', stashSha], { cwd, stdio: 'pipe' })
    p.log.success('Previous work applied to this branch')
    return true
  } catch {
    p.log.warning('Stash apply had conflicts — resolve them manually')
    p.log.info(`  Your work is safe in ${dim('git stash list')}`)
    return false
  }
}

/**
 * Core logic for switching to an EXISTING worktree.
 *
 * 1. Stash source changes (if any)
 * 2. Ensure target worktree is on the expected branch
 * 3. Apply source stash in target
 */
function switchToExistingWorktree(targetBranch, { sourceDir, fromBranch }) {
  const targetDir = worktreeDir(targetBranch)

  // 1. Stash source changes
  const sourceStashSha = stashChanges(sourceDir, stashMessage(fromBranch, targetBranch))

  // 2. Ensure target is on the correct branch
  const targetCurrentBranch = currentBranch(targetDir)

  if (targetCurrentBranch !== targetBranch) {
    // Target worktree is on a different branch — check if it's clean
    if (hasUncommittedChanges(targetDir)) {
      p.log.error(
        `Worktree ${bold(targetBranch)} is on branch ${bold(targetCurrentBranch)} with uncommitted changes.`
      )
      p.log.info(`  Clean up the worktree first:`)
      p.log.info(`    ${green('cd')} ${dim(`worktrees/${targetBranch}`)}`)
      p.log.info(`    ${dim('git stash')} ${dim('or')} ${dim('git commit')}`)
      p.log.info(`    ${dim(`git checkout ${targetBranch}`)}`)
      if (sourceStashSha) {
        p.log.info(`\n  Your source stash is safe — apply it later with:`)
        p.log.info(`    ${dim(`git stash apply ${sourceStashSha.slice(0, 8)}`)}`)
      }
      p.outro('')
      process.exit(1)
    }

    // Clean worktree on wrong branch — switch it
    p.log.step(`Switching worktree from ${bold(targetCurrentBranch)} to ${bold(targetBranch)}…`)
    try {
      execFileSync('git', ['checkout', targetBranch], { cwd: targetDir, stdio: 'pipe' })
      p.log.success(`Now on branch ${bold(targetBranch)}`)
    } catch (err) {
      p.log.error(`Could not switch branch: ${err.message || 'git checkout failed'}`)
      if (sourceStashSha) {
        p.log.info(`  Your source stash is safe: ${dim(`git stash apply ${sourceStashSha.slice(0, 8)}`)}`)
      }
      p.outro('')
      process.exit(1)
    }
  } else {
    p.log.success(`Worktree ${bold(targetBranch)} is on the correct branch`)
  }

  // 3. Apply source stash in target
  if (sourceStashSha) {
    if (hasUncommittedChanges(targetDir)) {
      p.log.warning(`Target worktree has uncommitted changes — skipping stash apply`)
      p.log.info(`  Apply your stash manually: ${dim(`git stash apply ${sourceStashSha.slice(0, 8)}`)}`)
    } else {
      applyStash(targetDir, sourceStashSha)
    }
  }

  // 4. Summary
  const lines = [
    `  Worktree ready: ${green(`worktrees/${targetBranch}`)}`,
  ]
  if (sourceStashSha) {
    lines.push(`  Your uncommitted work has been safely moved`)
  }
  lines.push('')
  lines.push(`  ${green('cd')} ${dim(`worktrees/${targetBranch}`)}`)
  lines.push(`  ${green('npx storyboard dev')}  ${dim('to start developing')}`)
  lines.push('')
  lines.push(`  ${dim('Tip: auto-cd with')} ${green('eval "$(npx sb branch --cd)"')}`)

  p.note(lines.join('\n'), `Branch ${bold(targetBranch)} is ready`)
  p.outro('')
  return targetDir
}

/**
 * Core logic for creating a NEW worktree.
 *
 * 1. Stash source changes
 * 2. Resolve branch (local/remote/new)
 * 3. Create worktree + npm install
 * 4. Pull --rebase
 * 5. Apply source stash
 */
function createNewWorktree(targetBranch, { sourceDir, fromBranch, root }) {
  // 1. Stash source changes
  const sourceStashSha = stashChanges(sourceDir, stashMessage(fromBranch, targetBranch))

  // 2. Resolve branch
  const hasLocal = localBranchExists(targetBranch, root)
  const hasRemote = !hasLocal && remoteBranchExists(targetBranch, root)
  const isNew = !hasLocal && !hasRemote

  if (isNew) {
    p.log.step(`Creating new branch ${bold(targetBranch)} from ${bold(fromBranch)}`)
  } else if (hasRemote) {
    p.log.step(`Fetching ${bold(targetBranch)} from origin…`)
    try {
      execFileSync('git', ['fetch', 'origin', targetBranch], { cwd: root, stdio: 'pipe' })
      try {
        execFileSync('git', ['branch', targetBranch, `origin/${targetBranch}`], { cwd: root, stdio: 'pipe' })
      } catch { /* may already exist after fetch */ }
    } catch {
      p.log.warning('Could not fetch from origin — using local state')
    }
  } else {
    p.log.step(`Using existing branch ${bold(targetBranch)}`)
  }

  // 3. Create the worktree
  const targetDir = resolve(root, 'worktrees', targetBranch)
  const spin = p.spinner()

  try {
    // For new branches, use current branch as start-point (not main's HEAD)
    const gitArgs = isNew
      ? ['worktree', 'add', targetDir, '-b', targetBranch, fromBranch]
      : ['worktree', 'add', targetDir, targetBranch]

    spin.start(`Creating worktree worktrees/${targetBranch}`)
    execFileSync('git', gitArgs, { cwd: root, stdio: 'pipe' })
    spin.stop(`Worktree created: worktrees/${targetBranch}`)
  } catch (err) {
    spin.stop('Failed to create worktree')
    p.log.error(err.message || 'git worktree add failed')
    process.exit(1)
  }

  // Install dependencies
  try {
    spin.start('Installing dependencies')
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    execFileSync(npmBin, ['install'], { cwd: targetDir, stdio: 'pipe' })
    spin.stop('Dependencies installed')
  } catch {
    spin.stop('npm install failed — you may need to run it manually')
  }

  // Assign a dev server port
  getPort(targetBranch)

  // 4. Pull --rebase from origin
  if (!isNew) {
    try {
      spin.start('Pulling latest changes')
      execFileSync('git', ['pull', '--rebase', 'origin', targetBranch], { cwd: targetDir, stdio: 'pipe' })
      spin.stop('Up to date with origin')
    } catch {
      spin.stop(dim('No remote changes (or origin not available)'))
    }
  }

  // 5. Apply source stash
  if (sourceStashSha) {
    applyStash(targetDir, sourceStashSha)
  }

  // 6. Summary
  const lines = [
    `  Your branch is set up as a worktree in ${green(`worktrees/${targetBranch}`)}`,
  ]
  if (sourceStashSha) {
    lines.push(`  Your uncommitted work has been safely moved`)
  }
  lines.push('')
  lines.push(`  ${green('cd')} ${dim(`worktrees/${targetBranch}`)}`)
  lines.push(`  ${green('npx storyboard dev')}  ${dim('to start developing')}`)
  lines.push('')
  lines.push(`  ${dim('Tip: auto-cd with')} ${green('eval "$(npx sb branch --cd)"')}`)

  p.note(lines.join('\n'), `Branch ${bold(targetBranch)} is ready`)
  p.outro('')
  return targetDir
}

// ─── Main ───

export async function runBranchGuide(branchArg) {
  const root = repoRoot()
  const existing = listWorktrees()
  const fromWorktree = detectWorktreeName()
  const sourceDir = fromWorktree === 'main' ? root : worktreeDir(fromWorktree)
  const fromBranch = currentBranch(sourceDir)

  // 1. Get branch name — select from existing or type a new one
  let targetBranch = branchArg?.trim()

  if (!targetBranch) {
    if (existing.length > 0) {
      // Build select options from existing worktrees + "new branch" option
      const NEW_BRANCH = Symbol('new')
      const options = [
        ...existing.map(name => ({ value: name, label: name })),
        { value: NEW_BRANCH, label: dim('Create a new branch…') },
      ]

      const selected = await p.select({
        message: 'Which branch do you want to work on?',
        options,
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        process.exit(0)
      }

      if (selected === NEW_BRANCH) {
        const newName = await p.text({
          message: 'New branch name:',
          placeholder: 'e.g. 4.3.0--my-feature',
          validate: isValidBranchName,
        })
        if (p.isCancel(newName)) {
          p.cancel('Cancelled')
          process.exit(0)
        }
        targetBranch = newName.trim()
      } else {
        targetBranch = selected
      }
    } else {
      // No existing worktrees — just ask for a name
      const result = await p.text({
        message: 'Branch name for new worktree:',
        placeholder: 'e.g. 4.3.0--my-feature',
        validate: isValidBranchName,
      })

      if (p.isCancel(result)) {
        p.cancel('Cancelled')
        process.exit(0)
      }
      targetBranch = result.trim()
    }
  }

  // 2. Show equivalent non-interactive command (when user used TUI to select)
  if (!branchArg) {
    p.log.info(`${dim('Non-interactive:')} ${green(`npx sb branch --worktree=${targetBranch}`)}`)
  }

  // 3. Route to existing or new worktree flow
  const wtDir = worktreeDir(targetBranch)
  if (existsSync(resolve(wtDir, '.git'))) {
    return switchToExistingWorktree(targetBranch, { sourceDir, fromBranch })
  } else {
    return createNewWorktree(targetBranch, { sourceDir, fromBranch, root })
  }
}

// ─── Direct invocation ───

const { flags, positional } = parseFlags(process.argv.slice(3), flagSchema)
const branchArg = flags.worktree || positional[0] || undefined

// When --cd is set, redirect all TUI output (Clack) to stderr so that
// stdout contains only the shell-evaluable `cd <path>` command.
// Usage: eval "$(npx sb branch --worktree=<name> --cd)"
const realStdoutWrite = process.stdout.write.bind(process.stdout)
if (flags.cd) {
  process.stdout.write = (chunk, encoding, callback) =>
    process.stderr.write(chunk, encoding, callback)
}

p.intro('storyboard branch')
runBranchGuide(branchArg).then((targetDir) => {
  if (flags.cd && targetDir) {
    process.stdout.write = realStdoutWrite
    realStdoutWrite(`cd ${JSON.stringify(targetDir)}\n`)
  }
})
