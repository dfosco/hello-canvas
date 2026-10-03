/**
 * storyboard code [branch] — Open a worktree in VS Code.
 *
 * Usage:
 *   storyboard code              # open current worktree or repo root
 *   storyboard code main         # open repo root
 *   storyboard code <branch>     # open worktrees/<branch>/
 */

import * as p from '@clack/prompts'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { detectWorktreeName, repoRoot, worktreeDir, listWorktrees } from '../worktree/port.js'

const branch = process.argv[3] || undefined

p.intro('storyboard code')

function openInCode(dir) {
  try {
    execFileSync('code', [dir], { stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

const root = repoRoot()

if (!branch) {
  // No argument — open current directory
  const name = detectWorktreeName()
  const dir = name === 'main' ? root : worktreeDir(name)
  if (openInCode(dir)) {
    p.outro(`Opened ${name === 'main' ? 'repo root' : `worktrees/${name}/`}`)
  } else {
    p.log.error('Could not open VS Code. Is the `code` CLI installed?')
    p.log.info('Run `npx storyboard setup` to install it, or open VS Code and run:')
    p.log.info('  Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH"')
    process.exit(1)
  }
} else if (branch === 'main') {
  if (openInCode(root)) {
    p.outro('Opened repo root')
  } else {
    p.log.error('Could not open VS Code.')
    process.exit(1)
  }
} else {
  const dir = worktreeDir(branch)
  if (!existsSync(resolve(dir, '.git'))) {
    // List available worktrees as a hint
    const available = listWorktrees()
    p.log.error(`Worktree "${branch}" does not exist.`)
    if (available.length > 0) {
      p.log.info(`Available worktrees: ${available.join(', ')}`)
    }
    process.exit(1)
  }
  if (openInCode(dir)) {
    p.outro(`Opened worktrees/${branch}/`)
  } else {
    p.log.error('Could not open VS Code.')
    process.exit(1)
  }
}
