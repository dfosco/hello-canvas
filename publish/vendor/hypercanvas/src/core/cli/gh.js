/**
 * gh — Thin wrappers around the GitHub CLI for storyboard setup.
 *
 * All helpers are best-effort: they return `null` (or a similar empty
 * shape) instead of throwing when `gh` is missing, the user isn't logged
 * in, or the current directory isn't a GitHub repo. Setup uses that to
 * skip gracefully without breaking the flow.
 */

import { execSync } from 'node:child_process'

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Is the `gh` CLI on PATH? */
export function ghInstalled() {
  return tryExec('which gh') !== null
}

/** Is the user logged in to `gh`? */
export function ghAuthed() {
  try {
    execSync('gh auth status', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Detect the current repository via `gh repo view`.
 * Returns `{ owner, name, url, defaultBranch }` or `null` on any failure
 * (no remote, not a GitHub repo, not authed, gh missing, etc.).
 */
export function detectRepo(cwd = process.cwd()) {
  if (!ghInstalled() || !ghAuthed()) return null
  try {
    const raw = execSync('gh repo view --json nameWithOwner,url,defaultBranchRef', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      cwd,
    }).trim()
    const data = JSON.parse(raw)
    const nameWithOwner = String(data.nameWithOwner || '')
    if (!nameWithOwner.includes('/')) return null
    const [owner, name] = nameWithOwner.split('/')
    return {
      owner,
      name,
      url: String(data.url || `https://github.com/${owner}/${name}`),
      defaultBranch: data.defaultBranchRef?.name || 'main',
    }
  } catch {
    return null
  }
}

/**
 * Look up whether GitHub Pages is enabled for the repo, and where it is
 * being served from. Returns `{ url, source }` on success, or `null` on
 * any failure (Pages not enabled, no permission, etc.).
 */
export function getPagesInfo(owner, name) {
  if (!ghInstalled() || !ghAuthed()) return null
  const raw = tryExec(`gh api repos/${owner}/${name}/pages 2>/dev/null`)
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    return {
      url: data.html_url || null,
      source: data.source || null,
      buildType: data.build_type || null,
    }
  } catch {
    return null
  }
}

/**
 * Build the canonical GitHub Pages URL for a project repo.
 * Special-cases user/org Pages repos (`<owner>.github.io`) to omit the
 * trailing repo-name segment, matching GitHub's actual routing.
 */
export function defaultPagesUrl(owner, name) {
  if (!owner || !name) return ''
  const ownerHost = `${owner.toLowerCase()}.github.io`
  if (name.toLowerCase() === ownerHost) {
    return `https://${ownerHost}/`
  }
  return `https://${ownerHost}/${name}/`
}

/** Pages settings URL — where the user enables/configures Pages. */
export function pagesSettingsUrl(owner, name) {
  return `https://github.com/${owner}/${name}/settings/pages`
}
