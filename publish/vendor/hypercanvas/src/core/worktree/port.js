/**
 * Worktree Port Registry
 *
 * Manages a JSON registry (worktrees/ports.json) that maps worktree names
 * to unique dev-server ports. Main always gets 1234; worktrees get 1235+.
 *
 * This module is published as part of @dfosco/hypercanvas so client
 * repos can use port detection without duplicating the logic.
 *
 * Programmatic API:
 *   import { getPort, detectWorktreeName, resolvePort } from '@dfosco/hypercanvas/worktree/port'
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'fs'
import { join, dirname } from 'path'
import { execSync } from 'child_process'
import { findByWorktree } from './serverRegistry.js'

const BASE_PORT = 1234

/**
 * Resolve the path to worktrees/ports.json.
 *
 * Derives the repo root from directory structure so it works whether
 * running from the repo root or from inside worktrees/<name>/ or
 * .worktrees/<name>/ (legacy convention) — even when ports.json
 * does not exist yet.
 *
 * @param {string} [cwd] — override working directory
 * @returns {string} absolute path to ports.json
 */
export function portsFilePath(cwd = process.cwd()) {
  // Fall back to the raw path if cwd was deleted out from under us.
  let realCwd
  try {
    realCwd = realpathSync(cwd)
  } catch {
    realCwd = cwd
  }

  // Check if we're inside worktrees/<name>/ or .worktrees/<name>/
  const worktreeMatch = realCwd.match(/^(.+)[/\\]\.?worktrees[/\\][^/\\]+/)
  if (worktreeMatch) {
    return join(worktreeMatch[1], 'worktrees', 'ports.json')
  }

  // We're at the repo root (or somewhere else) — default location
  return join(realCwd, 'worktrees', 'ports.json')
}

/**
 * Detect the worktree name from the current git context.
 *
 * Returns:
 *   - The worktree name when cwd is inside `worktrees/<name>/` or
 *     `.worktrees/<name>/`.
 *   - The current branch name when on a non-main/master branch.
 *   - `'main'` otherwise.
 */
export function detectWorktreeName() {
  try {
    const topLevel = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
    const realTop = realpathSync(topLevel)

    // Check if we're inside a worktrees/<name> or .worktrees/<name> directory
    const wtMatch = realTop.match(/[/\\]\.?worktrees[/\\]([^/\\]+)$/)
    if (wtMatch) return wtMatch[1]

    // Also check the cwd pattern.
    const realCwd = realpathSync(process.cwd())
    const worktreeMatch = realCwd.match(/\.?worktrees[/\\]([^/\\]+)/)
    if (worktreeMatch) return worktreeMatch[1]

    // Not a worktree — check the current branch name
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
    if (branch && branch !== 'main' && branch !== 'master') return branch

    return 'main'
  } catch {
    return 'main'
  }
}

/**
 * Get or assign a port for the given worktree name.
 *
 * DEPRECATED for new assignments under the single-instance model (ADR-007):
 * one global instance owns the selected proxy port, so per-worktree dev servers
 * no longer start. Main keeps its 1234 assignment as a legacy read; other
 * worktrees reuse an existing assignment when present and otherwise fall
 * back to the base port (Vite rolls forward automatically when occupied).
 * The file backend is retained because client repos import this module.
 *
 * @param {string} worktreeName
 * @returns {number}
 */
export function getPort(worktreeName) {
  const portsFile = portsFilePath()
  const dir = dirname(portsFile)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let ports = { main: BASE_PORT }
  if (existsSync(portsFile)) {
    try {
      ports = JSON.parse(readFileSync(portsFile, 'utf8'))
    } catch {
      // Corrupted file — start fresh
    }
  }

  if (worktreeName === 'main') return ports.main || BASE_PORT
  return ports[worktreeName] || BASE_PORT
}

/**
 * Release a port assignment for a worktree.
 *
 * Removes the entry from ports.json so the port can be reused.
 * Never removes 'main'.
 *
 * @param {string} worktreeName
 */
export function releasePort(worktreeName) {
  if (worktreeName === 'main') return

  const portsFile = portsFilePath()
  if (!existsSync(portsFile)) return

  try {
    const ports = JSON.parse(readFileSync(portsFile, 'utf8'))
    if (!(worktreeName in ports)) return
    delete ports[worktreeName]
    writeFileSync(portsFile, JSON.stringify(ports, null, 2) + '\n')
  } catch { /* ignore corrupt file */ }
}

/**
 * Resolve the port for a running dev server.
 *
 * Checks the server registry (servers.json) first for a live process,
 * then falls back to ports.json assignment. Use this when connecting
 * to an already-running server — it returns the real bound port even
 * when Vite rebinds to a different port than originally assigned.
 *
 * @param {string} worktreeName
 * @returns {number}
 */
export function resolveRunningPort(worktreeName) {
  try {
    const servers = findByWorktree(worktreeName)
    if (servers.length > 0) {
      const latest = servers.reduce((a, b) =>
        (a.startedAt || '') >= (b.startedAt || '') ? a : b
      )
      return latest.port
    }
  } catch { /* registry unavailable */ }

  return resolvePort(worktreeName)
}

/**
 * Resolve the port for a worktree from worktrees/ports.json
 * without assigning a new one if missing.
 *
 * @param {string} worktreeName
 * @returns {number}
 */
export function resolvePort(worktreeName) {
  const portsFile = portsFilePath()
  if (!existsSync(portsFile)) return BASE_PORT

  try {
    const ports = JSON.parse(readFileSync(portsFile, 'utf8'))
    return ports[worktreeName] ?? BASE_PORT
  } catch {
    return BASE_PORT
  }
}

/**
 * Slugify a branch name for filesystem and subdomain safety.
 *
 * - lowercase
 * - dots, spaces, underscores, non-alphanumeric (except - and /) → hyphens
 * - collapse consecutive hyphens
 * - trim leading/trailing hyphens per segment
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9/-]/g, '-')
    .replace(/-{2,}/g, '-')
    .split('/')
    .map((s) => s.replace(/^-+|-+$/g, ''))
    .join('/')
}

/**
 * Resolve the repo root — the directory that contains `worktrees/`.
 *
 * Works whether cwd is the repo root itself or inside `worktrees/<name>/`
 * or `.worktrees/<name>/` (legacy convention).
 *
 * @param {string} [cwd]
 * @returns {string} absolute path to repo root
 */
export function repoRoot(cwd = process.cwd()) {
  // Fall back to raw cwd if it was deleted out from under us.
  let realCwd
  try {
    realCwd = realpathSync(cwd)
  } catch {
    realCwd = cwd
  }

  const worktreeMatch = realCwd.match(/^(.+)[/\\]\.?worktrees[/\\][^/\\]+/)
  if (worktreeMatch) return worktreeMatch[1]

  return realCwd
}

/**
 * Resolve the full path to a worktree directory.
 *
 * Returns repo root for 'main'. For branches, checks both `worktrees/<name>`
 * and `.worktrees/<name>` (legacy), preferring whichever exists on disk.
 * Falls back to `worktrees/<name>` (current convention) if neither exists.
 *
 * @param {string} name — worktree name
 * @param {string} [cwd]
 * @returns {string} absolute path
 */
export function worktreeDir(name, cwd) {
  const root = repoRoot(cwd)
  if (name === 'main') return root

  const current = join(root, 'worktrees', name)
  const legacy = join(root, '.worktrees', name)

  // Prefer whichever exists; fall back to current convention
  if (existsSync(current)) return current
  if (existsSync(legacy)) return legacy
  return current
}

/**
 * List existing worktree directory names from `worktrees/` and `.worktrees/`.
 *
 * Only returns directories that look like real worktrees (contain a `.git` file).
 * Does not include 'main'. Deduplicates names found in both locations.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function listWorktrees(cwd) {
  const root = repoRoot(cwd)
  const names = new Set()

  for (const dir of ['worktrees', '.worktrees']) {
    const worktreesDir = join(root, dir)
    if (!existsSync(worktreesDir)) continue

    for (const d of readdirSync(worktreesDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(worktreesDir, d.name, '.git'))) {
        names.add(d.name)
      }
    }
  }

  return [...names]
}
