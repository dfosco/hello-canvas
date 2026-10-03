/**
 * Publication Git operations.
 *
 * Repository ownership (DOCS/publishing.md):
 * - Default mode: the Notebook root IS the repository; `publish/` is a
 *   generated directory inside it, never a nested repository. A repository
 *   above the Notebook root is rejected — a publish never stages or pushes a
 *   parent repository.
 * - External mode: the bound project directory is the repository.
 *
 * Staging respects `.gitignore`; the private `.storyboard/` runtime directory
 * is always excluded. Reconciliation pulls and rebases before push; a conflict
 * aborts the rebase, restores tracked and untracked local work, and never
 * pushes. Publishing never force-pushes.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { publishingError } from './errors.js'
import { recordOperationOutput } from './operations.js'
import { NOTEBOOK_PUBLISH_DIR, NOTEBOOK_RUNTIME_DIR } from '../notebook.js'

function isGitInspection(args) {
  const [command, subcommand] = args
  if (['rev-parse', 'ls-files', 'status', 'diff', 'show'].includes(command)) return true
  if (command === 'config' && args.length === 2) return true
  if (command === 'remote' && subcommand !== 'add') return true
  return false
}

export function runGit(cwd, args) {
  const bundledGit = process.env.HYPERCANVAS_BUNDLED_GIT
  const execute = (command) => {
    const label = `$ ${command === 'git' ? 'git' : 'bundled git'} ${args[0] || ''}`.trim()
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = String(result.stdout ?? '')
    const stderr = String(result.stderr ?? '')
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    if (!isGitInspection(args)) {
      recordOperationOutput(label, output || (result.status === 0 ? '' : 'Command failed without output.'))
    }
    if (result.error) {
      result.error.stdout = stdout
      result.error.stderr = stderr
      throw result.error
    }
    if (result.status !== 0) {
      const error = Object.assign(new Error(stderr.trim() || `Git ${args[0]} failed.`), {
        stdout,
        stderr,
        status: result.status,
        signal: result.signal,
      })
      throw error
    }
    return stdout
  }
  try {
    return { ok: true, output: execute('git'), runtime: 'system' }
  } catch (error) {
    if (error?.code === 'ENOENT' && bundledGit) {
      try { return { ok: true, output: execute(bundledGit), runtime: 'bundled' } } catch (bundledError) {
        const output = [bundledError?.stdout, bundledError?.stderr].filter(Boolean).join('\n').trim()
        throw publishingError('GIT_FAILED', `Bundled Git ${args[0]} failed.`, output)
      }
    }
    if (error?.code === 'ENOENT') {
      throw publishingError('GIT_UNAVAILABLE', 'Git is unavailable. Install Git or enable the bundled Git runtime.', null, 'Install Git, then retry the publish.')
    }
    const output = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim()
    throw publishingError('GIT_FAILED', `Git ${args[0]} failed.`, output)
  }
}

function canonical(candidate) {
  const resolved = path.resolve(candidate)
  try { return fs.realpathSync.native(resolved) } catch {
    const missing = []
    let cursor = resolved
    while (!fs.existsSync(cursor)) {
      missing.unshift(path.basename(cursor))
      const parent = path.dirname(cursor)
      if (parent === cursor) return resolved
      cursor = parent
    }
    return path.join(fs.realpathSync.native(cursor), ...missing)
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Repository root containing `dir`, or null when none exists. */
export function findRepositoryRoot(dir) {
  try {
    return canonical(String(runGit(dir, ['rev-parse', '--show-toplevel']).output).trim())
  } catch (error) {
    if (error?.code === 'GIT_FAILED') return null
    throw error
  }
}

/**
 * Resolve the repository root for a repository mode. Rejects enclosing parent
 * repositories in default mode and nested repositories inside `publish/`.
 */
export function resolveRepositoryRoot({ notebookRoot, mode, projectDir }) {
  const canonicalNotebook = canonical(notebookRoot)
  if (mode === 'default') {
    const canonicalProject = canonical(projectDir)
    if (canonicalProject !== path.join(canonicalNotebook, NOTEBOOK_PUBLISH_DIR)) {
      throw publishingError('INVALID_DESTINATION', 'Default publishing expects the Notebook publish/ project directory.')
    }
    const existing = findRepositoryRoot(canonicalNotebook)
    if (existing && existing !== canonicalNotebook) {
      throw publishingError(
        'PARENT_REPOSITORY',
        `The Notebook is inside an existing Git repository (${existing}). Publishing would stage or push that parent repository.`,
        existing,
        'Publish the parent repository manually, or move the Notebook outside it, then retry.',
      )
    }
    return canonicalNotebook
  }
  const canonicalProject = canonical(projectDir)
  if (isInside(canonicalNotebook, canonicalProject)) {
    throw publishingError('DESTINATION_INSIDE_NOTEBOOK', 'External publish destinations must be outside the Notebook.')
  }
  const existing = findRepositoryRoot(path.dirname(canonicalProject))
  if (existing && isInside(existing, canonicalProject) && existing !== canonicalProject) {
    throw publishingError(
      'PARENT_REPOSITORY',
      `The external destination is inside an existing Git repository (${existing}).`,
      existing,
      'Choose a destination outside that repository, then retry.',
    )
  }
  return canonical(projectDir)
}

/** Initialize a repository when missing; returns the repository root. */
export function ensureRepository({ repositoryRoot, branch = 'main' }) {
  if (!findRepositoryRoot(repositoryRoot)) {
    try {
      runGit(repositoryRoot, ['init', '-b', branch])
    } catch (error) {
      if (error?.code !== 'GIT_FAILED') throw error
      runGit(repositoryRoot, ['init'])
      runGit(repositoryRoot, ['branch', '-M', branch])
    }
  }
  return repositoryRoot
}

function gitIdentityMissing(repositoryRoot) {
  try {
    const name = String(runGit(repositoryRoot, ['config', 'user.name']).output ?? '').trim()
    const email = String(runGit(repositoryRoot, ['config', 'user.email']).output ?? '').trim()
    return !name || !email
  } catch { return true }
}

/**
 * Ensure a commit identity exists. A missing identity gets a repository-local
 * publishing identity; existing configuration is never changed.
 */
export function ensureCommitIdentity(repositoryRoot) {
  if (!gitIdentityMissing(repositoryRoot)) return false
  runGit(repositoryRoot, ['config', 'user.name', 'Hypercanvas Publish'])
  runGit(repositoryRoot, ['config', 'user.email', 'publish@hypercanvas.invalid'])
  return true
}

/**
 * Stage the publication through the correct repository root. Default mode
 * stages all unignored Notebook content (respecting `.gitignore`) with the
 * private runtime directory explicitly excluded; external mode stages the
 * site project. Git ignore rules decide what user content is public.
 */
export function stagePublication({ repositoryRoot }) {
  // A malformed/old ignore file may have allowed runtime state to be
  // committed previously. Remove it from the index without touching private
  // files on disk. Then stage explicit tracked and non-ignored paths so Git
  // never warns about an ignored `.storyboard/` path passed via `.`.
  runGit(repositoryRoot, ['rm', '--cached', '-r', '-f', '--ignore-unmatch', '--', NOTEBOOK_RUNTIME_DIR])
  const output = String(runGit(repositoryRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).output ?? '')
  const runtimePrefix = `${NOTEBOOK_RUNTIME_DIR}/`
  const paths = output.split('\0').filter((entry) => entry && entry !== NOTEBOOK_RUNTIME_DIR && !entry.startsWith(runtimePrefix))
  const chunkSize = 256
  for (let index = 0; index < paths.length; index += chunkSize) {
    runGit(repositoryRoot, ['add', '-A', '--', ...paths.slice(index, index + chunkSize)])
  }
}

export function hasStagedChanges(repositoryRoot) {
  const output = String(runGit(repositoryRoot, ['diff', '--cached', '--name-only', '-z']).output ?? '')
  return output.length > 0
}

/** Commit staged changes; a no-op commit is not an error. */
export function commitPublication({ repositoryRoot, message }) {
  if (!hasStagedChanges(repositoryRoot)) return { committed: false }
  try {
    runGit(repositoryRoot, ['commit', '-m', message])
    return { committed: true }
  } catch (error) {
    if (/no user identity|please tell me who you are|unknown switch/i.test(error?.detail || '')) {
      throw publishingError('GIT_IDENTITY_UNAVAILABLE', 'Git has no commit identity configured.', error?.detail, 'Configure git user.name and user.email, then retry.')
    }
    throw error
  }
}

function branchExists(repositoryRoot, branch) {
  try {
    runGit(repositoryRoot, ['rev-parse', '--verify', `refs/heads/${branch}`])
    return true
  } catch { return false }
}

function remoteBranchExists(repositoryRoot, { remote, branch }) {
  try {
    runGit(repositoryRoot, ['rev-parse', '--verify', `refs/remotes/${remote}/${branch}`])
    return true
  } catch { return false }
}

/** All branch names advertised by a remote (used for ownership checks). */
export function remoteBranches({ repositoryRoot, remote = 'origin' }) {
  const output = String(runGit(repositoryRoot, ['ls-remote', '--heads', remote]).output ?? '')
  return output.split('\n')
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((ref) => ref?.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
}

/** Whether HEAD resolves to a commit, including when the working tree is dirty. */
export function hasCommit(repositoryRoot) {
  try {
    runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch { return false }
}

function hasRemote(repositoryRoot, remote) {
  try {
    // Read the configured URL verbatim. `git remote get-url` expands
    // url.*.insteadOf rewrites and can make a GitHub origin appear to be a
    // different repository (or local path) during ownership checks.
    const output = String(runGit(repositoryRoot, ['config', '--get', `remote.${remote}.url`]).output ?? '').trim()
    return Boolean(output)
  } catch { return false }
}

function stashWithRuntimeExcluded(repositoryRoot) {
  const infoExclude = String(runGit(repositoryRoot, ['rev-parse', '--git-path', 'info/exclude']).output ?? '').trim()
  const excludePath = path.isAbsolute(infoExclude) ? infoExclude : path.resolve(repositoryRoot, infoExclude)
  const existed = fs.existsSync(excludePath)
  const original = existed ? fs.readFileSync(excludePath) : null
  const text = original?.toString('utf8') ?? ''
  const hasRuntimeRule = text.split(/\r?\n/).some((line) => line.trim() === `/${NOTEBOOK_RUNTIME_DIR}/` || line.trim() === `${NOTEBOOK_RUNTIME_DIR}/`)
  if (!hasRuntimeRule) {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true })
    fs.writeFileSync(excludePath, `${text}${text && !text.endsWith('\n') ? '\n' : ''}/${NOTEBOOK_RUNTIME_DIR}/\n`)
  }
  try {
    return runGit(repositoryRoot, ['stash', 'push', '-u', '-m', 'hypercanvas-publish-reconcile'])
  } finally {
    if (!hasRuntimeRule) {
      if (existed) fs.writeFileSync(excludePath, original)
      else fs.rmSync(excludePath, { force: true })
    }
  }
}

export function remoteUrl({ repositoryRoot, remote = 'origin' }) {
  return hasRemote(repositoryRoot, remote)
    ? String(runGit(repositoryRoot, ['config', '--get', `remote.${remote}.url`]).output ?? '').trim()
    : null
}

/**
 * Safely reconcile with the remote before push: stash uncommitted work
 * (including untracked), fetch, then rebase the local branch onto the remote
 * branch. On conflict: abort the rebase, restore the stash, and throw
 * REMOTE_CONFLICT — nothing is pushed and local work is intact.
 */
export function reconcileWithRemote({ repositoryRoot, branch, remote = 'origin' }) {
  if (!hasRemote(repositoryRoot, remote)) return { reconciled: false, reason: 'no-remote' }
  // An unborn repository cannot stash its first Notebook contents. It is safe
  // to publish only when the selected remote branch is empty; otherwise stop
  // before committing so the user's staged and untracked work remains intact.
  if (!hasCommit(repositoryRoot)) {
    const fetched = fetchRemote({ repositoryRoot, remote, branch })
    if (fetched.fetched && remoteBranchExists(repositoryRoot, { remote, branch })) {
      throw publishingError('REMOTE_CONFLICT', `Remote branch ${branch} already has history, but this local repository has no commit to rebase. Nothing was committed or pushed.`, null, 'Clone the publication and rebind this Notebook, or resolve the repository history manually, then retry.')
    }
    return { reconciled: true, stashed: false, reason: 'unborn-local-repository' }
  }
  let stashCreated = false
  try {
    // Stash the complete worktree, not paths derived from the generated
    // publication. Partial stashes can leave staged deletions behind (or fail
    // to restore their index entries) when generation replaces a prior site.
    // Temporarily ignore private runtime state for `-u`; it is restored before
    // reconciliation and never enters the publication stash.
    const result = stashWithRuntimeExcluded(repositoryRoot)
    stashCreated = !/No local changes to save/i.test(String(result.output ?? ''))
  } catch (error) {
    if (!/no local changes/i.test(error?.detail || '')) {
      throw publishingError('GIT_FAILED', 'Could not stash local work before reconciling.', error?.detail)
    }
  }
  try {
    const fetched = fetchRemote({ repositoryRoot, remote, branch })
    if (fetched.fetched && remoteBranchExists(repositoryRoot, { remote, branch }) && branchExists(repositoryRoot, branch)) {
      runGit(repositoryRoot, ['rebase', `${remote}/${branch}`])
    }
    return { reconciled: true, stashed: stashCreated }
  } catch (error) {
    try { runGit(repositoryRoot, ['rebase', '--abort']) } catch { /* not mid-rebase */ }
    if (stashCreated) {
      try { runGit(repositoryRoot, ['stash', 'pop', '--index']) } catch {
        throw publishingError('REMOTE_CONFLICT', 'The remote branch has conflicting commits. Local work is preserved in the stash (git stash list).', [error?.detail].filter(Boolean).join('\n'), 'Resolve conflicts manually (git pull --rebase), then retry.')
      }
    }
    const detail = [error?.detail].filter(Boolean).join('\n')
    if (/non-fast-forward|fetch first|rejected|conflict/i.test(detail)) {
      throw publishingError('REMOTE_CONFLICT', `Remote branch ${branch} has commits that conflict with this publish. Nothing was pushed.`, detail, 'Resolve conflicts manually (git pull --rebase), then retry.')
    }
    throw error
  }
}

function restoreStash(repositoryRoot) {
  try {
    runGit(repositoryRoot, ['stash', 'pop', '--index'])
    return true
  } catch { return false }
}

/**
 * Full reconciliation including restoring stashed uncommitted work on
 * success. Kept separate from reconcileWithRemote for testability.
 */
export function reconcileAndRestore({ repositoryRoot, branch, remote = 'origin' }) {
  const result = reconcileWithRemote({ repositoryRoot, branch, remote })
  if (result.stashed && !restoreStash(repositoryRoot)) {
    throw publishingError('GIT_FAILED', 'Could not restore stashed local work after reconciling.', null, 'Find it with: git stash list')
  }
  return result
}

/**
 * Push the local branch to the remote. Non-fast-forward failures surface as
 * REMOTE_CONFLICT — publishing never force-pushes.
 */
export function pushToRemote({ repositoryRoot, branch, remote = 'origin', setUpstream = true }) {
  const args = ['push']
  if (setUpstream && !remoteBranchExists(repositoryRoot, { remote, branch })) args.push('-u')
  args.push(remote, `HEAD:refs/heads/${branch}`)
  try {
    runGit(repositoryRoot, args)
    return { pushed: true }
  } catch (error) {
    const detail = [error?.detail].filter(Boolean).join('\n')
    if (/non-fast-forward|fetch first|rejected/i.test(detail)) {
      throw publishingError('REMOTE_CONFLICT', `Remote branch ${branch} has commits that are not in this publish. Nothing was force-pushed.`, detail, 'Pull and reconcile the branch, then retry.')
    }
    if (/Could not read from remote|Authentication failed|Permission denied|does not appear to be a git repository/i.test(detail)) {
      throw publishingError('GIT_FAILED', 'Push failed: the remote is unreachable or access was denied.', detail, 'Check the remote URL and credentials, then retry.')
    }
    throw error
  }
}

/**
 * Read a file from a remote branch without a checkout (clone verification):
 * returns the text or null when the path does not exist on that ref.
 */
export function readFileOnRemote({ repositoryRoot, remote = 'origin', branch, relativePath }) {
  try {
    const output = runGit(repositoryRoot, ['show', `${remote}/${branch}:${relativePath}`])
    return String(output.output ?? '')
  } catch { return null }
}

/** Fetch a branch into its remote-tracking ref. */
export function fetchRemote({ repositoryRoot, remote = 'origin', branch }) {
  try {
    runGit(repositoryRoot, ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`])
    return { fetched: true }
  } catch (error) {
    if (/couldn't find remote ref|not our ref|remote ref does not exist/i.test(error?.detail || '')) return { fetched: false, reason: 'branch-not-found' }
    // A new repo/first-push legitimately has no branch on origin yet.
    if (/couldn't find remote ref|fatal: couldn't find remote ref/i.test(error?.detail || '')) return { fetched: false, reason: 'branch-not-found' }
    throw error
  }
}

export function currentBranch(repositoryRoot) {
  try {
    return String(runGit(repositoryRoot, ['branch', '--show-current']).output ?? '').trim()
  } catch { return null }
}

export function stagedFileExists(repositoryRoot, relativePath) {
  try {
    const output = runGit(repositoryRoot, ['ls-files', '--cached', '--', relativePath]).output
    return Boolean(String(output ?? '').trim())
  } catch { return false }
}

export const __test = { runGit }
