/**
 * configureRepository — Detect the current GitHub repo via `gh`, compare
 * to `storyboard.config.json`, and offer to update mismatching fields.
 * Optionally commits + pushes the change and prints the GH Pages enable
 * URL.
 *
 * Called from `storyboard setup` after the gh-auth step. Designed to be
 * fully idempotent and safe to skip (e.g. when offline, not authed, or
 * the repo identity already matches).
 */

import * as p from '@clack/prompts'
import { execSync } from 'node:child_process'
import { dim, yellow, green, bold, cyan } from './intro.js'
import { detectRepo, getPagesInfo, defaultPagesUrl, pagesSettingsUrl, ghAuthed, ghInstalled } from './gh.js'
import { readRepoConfig, diffRepoIdentity, writeRepoConfig } from './repoConfig.js'

function exec(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', ...opts }).trim()
}

function tryExec(cmd, opts) {
  try { return exec(cmd, opts) } catch { return null }
}

/** Has the current working tree any uncommitted changes (staged or unstaged)? */
function isDirty(cwd) {
  const out = tryExec('git status --porcelain', { cwd })
  return !!(out && out.length > 0)
}

/** Is `<file>` the only modified path in the working tree? */
function onlyChangedFile(cwd, file) {
  const out = tryExec('git status --porcelain', { cwd })
  if (!out) return false
  const lines = out.split('\n').filter(Boolean)
  return lines.length === 1 && lines[0].slice(3).trim() === file
}

/** Current branch name, or `null` if detached / not a repo. */
function currentBranch(cwd) {
  const out = tryExec('git rev-parse --abbrev-ref HEAD', { cwd })
  return out && out !== 'HEAD' ? out : null
}

/**
 * Run the repo-configuration flow. Returns silently on any non-fatal
 * skip condition.
 *
 * @param {{ cwd?: string, nonInteractive?: boolean }} [opts]
 */
export async function configureRepository(opts = {}) {
  const cwd = opts.cwd || process.cwd()
  const nonInteractive = !!opts.nonInteractive

  if (!ghInstalled()) {
    p.log.info(dim('Skipping repo config — gh CLI not installed'))
    return
  }
  if (!ghAuthed()) {
    p.log.info(dim('Skipping repo config — gh not authenticated'))
    return
  }

  const repo = detectRepo(cwd)
  if (!repo) {
    p.log.info(dim('Skipping repo config — no GitHub remote detected'))
    return
  }

  const { exists, config } = readRepoConfig(cwd)
  if (!exists) {
    p.log.info(dim('Skipping repo config — storyboard.config.json not found'))
    return
  }

  // Compute desired prodDomain: prefer the actual Pages URL when Pages
  // is already enabled; otherwise predict where it will live once the
  // user turns it on.
  const pages = getPagesInfo(repo.owner, repo.name)
  const desiredProd = pages?.url || defaultPagesUrl(repo.owner, repo.name)

  const desired = { owner: repo.owner, name: repo.name, prodDomain: desiredProd }
  const updates = diffRepoIdentity(config, desired)

  if (updates.length === 0) {
    p.log.success(`Repository configured: ${cyan(`${repo.owner}/${repo.name}`)}`)
  } else {
    // Show a summary of what will change.
    const lines = updates
      .map((u) => `  ${dim(u.label)}: ${u.from ? dim(u.from) + ' → ' : ''}${green(u.value)}`)
      .join('\n')
    p.log.info(`Detected repository ${bold(`${repo.owner}/${repo.name}`)} — proposed updates:\n${lines}`)

    let proceed = true
    if (!nonInteractive) {
      const ans = await p.confirm({
        message: 'Update storyboard.config.json with these values?',
        initialValue: true,
      })
      if (p.isCancel(ans)) proceed = false
      else proceed = !!ans
    }

    if (proceed) {
      try {
        writeRepoConfig(cwd, updates)
        p.log.success('Updated storyboard.config.json')
      } catch (err) {
        p.log.warning(`Failed to update storyboard.config.json: ${err.message}`)
        return
      }

      // Offer to commit + push the config change. Only do so when the
      // ONLY working-tree change is the config we just wrote, so we
      // don't accidentally push unrelated work.
      const branch = currentBranch(cwd)
      const onlyConfigChanged = onlyChangedFile(cwd, 'storyboard.config.json')
      const dirty = isDirty(cwd)

      if (!branch) {
        p.log.info(dim('Detached HEAD — skipping commit/push of config'))
      } else if (!onlyConfigChanged && dirty) {
        p.log.info(dim('Working tree has unrelated changes — commit storyboard.config.json yourself when ready'))
      } else if (!dirty) {
        // writeRepoConfig already wrote — if git sees no diff (unlikely),
        // there's nothing to commit.
        p.log.info(dim('No file changes detected — config was already in sync'))
      } else if (!nonInteractive) {
        const confirmPush = await p.confirm({
          message: `Commit + push storyboard.config.json to ${bold(branch)}?`,
          initialValue: true,
        })
        if (!p.isCancel(confirmPush) && confirmPush) {
          try {
            execSync('git add storyboard.config.json', { stdio: 'ignore', cwd })
            execSync('git commit -m "chore: set repository info via storyboard setup"', { stdio: 'ignore', cwd })
            p.log.success('Committed storyboard.config.json')
            try {
              execSync(`git push origin ${branch}`, { stdio: 'ignore', cwd })
              p.log.success(`Pushed to origin/${branch}`)
            } catch {
              p.log.warning(`Could not push to origin/${branch} — push manually with ${yellow(`git push origin ${branch}`)}`)
            }
          } catch (err) {
            p.log.warning(`Commit failed: ${err.message}`)
          }
        }
      }
    }
  }

  // Always surface the Pages enable link — even when nothing changed —
  // so users always know where to flip the switch.
  if (!pages) {
    const settings = pagesSettingsUrl(repo.owner, repo.name)
    p.log.info('GitHub Pages is not enabled yet for this repo.')
    p.log.info(`  Enable it → ${cyan(settings)}`)
    p.log.info(`  Source: ${bold('Deploy from a branch')} · Branch: ${bold('gh-pages')} · Folder: ${bold('/ (root)')}`)
    p.log.info(`  After the first push, the site lives at ${cyan(desiredProd)}`)
  } else {
    p.log.success(`GitHub Pages enabled → ${cyan(pages.url)}`)
  }
}
