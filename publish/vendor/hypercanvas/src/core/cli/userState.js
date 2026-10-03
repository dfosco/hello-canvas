/**
 * userState — Per-user local state for the current repo, stored in
 * `.storyboard/.user.json` (gitignored).
 *
 * This is a free-form key/value bag for things that should persist across
 * runs but never be committed:
 *   - setupVersion   (string) — @dfosco/hypercanvas version setup was last
 *     run against. Compared against the installed version on `npm run dev`
 *     to decide whether scaffolding needs to re-run.
 *   - setupRanAt     (ISO date) — last setup timestamp.
 *   - agents         (object) — per-agent opt-in flags from the
 *     first-run install prompt (copilot/claude/codex booleans).
 *   - … future:        onboarded, username, lastSeenChangelog, etc.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const FILE = '.storyboard/.user.json'

export function userStatePath(cwd = process.cwd()) {
  return resolve(cwd, FILE)
}

export function readUserState(cwd = process.cwd()) {
  const file = userStatePath(cwd)
  if (!existsSync(file)) return {}
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }
}

export function writeUserState(patch, cwd = process.cwd()) {
  const file = userStatePath(cwd)
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const next = { ...readUserState(cwd), ...patch }
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/**
 * Read the installed @dfosco/hypercanvas package version, or null if not
 * resolvable (e.g. running from a worktree without node_modules).
 */
export function getInstalledStoryboardVersion(cwd = process.cwd()) {
  try {
    const pkgPath = resolve(cwd, 'node_modules', '@dfosco', 'storyboard', 'package.json')
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || null
  } catch { return null }
}

/**
 * Decide whether `storyboard setup` should run before `dev`.
 * Returns null when up-to-date, or { reason, ... } otherwise.
 */
export function setupNeeded(cwd = process.cwd()) {
  const state = readUserState(cwd)
  const current = getInstalledStoryboardVersion(cwd)
  if (!state.setupVersion) return { reason: 'first-run', current }
  if (current && state.setupVersion !== current) {
    return { reason: 'version-changed', from: state.setupVersion, to: current }
  }
  return null
}
