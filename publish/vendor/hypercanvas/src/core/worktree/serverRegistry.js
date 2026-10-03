/**
 * Server Registry — tracks running dev servers in .storyboard/servers.json.
 *
 * Each server gets a unique hex ID. The registry is pruned on every read
 * to remove entries whose PIDs are no longer alive.
 */

import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { repoRoot } from './port.js'

/**
 * Absolute path to .storyboard/servers.json.
 */
export function registryPath(cwd) {
  return join(repoRoot(cwd), '.storyboard', 'servers.json')
}

/**
 * Generate a short unique hex ID (6 chars).
 */
export function generateId() {
  return randomBytes(3).toString('hex')
}

/**
 * Check whether a PID is alive.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Read the registry file. Returns an object keyed by server ID.
 */
function readRegistry(cwd) {
  const file = registryPath(cwd)
  if (!existsSync(file)) return {}
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data.servers || {}
  } catch {
    return {}
  }
}

/**
 * Write the registry atomically (write tmp then rename).
 */
function writeRegistry(servers, cwd) {
  const file = registryPath(cwd)
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify({ servers }, null, 2) + '\n')
  renameSync(tmp, file)
}

/**
 * Remove entries whose PIDs are dead.
 * @returns {object} pruned servers map
 */
export function prune(cwd) {
  const servers = readRegistry(cwd)
  const alive = {}
  for (const [id, entry] of Object.entries(servers)) {
    if (isAlive(entry.pid)) {
      alive[id] = entry
    }
  }
  writeRegistry(alive, cwd)
  return alive
}

/**
 * Register a new server entry.
 */
export function register({ id, worktree, pid, port, background = false }, cwd) {
  const servers = prune(cwd)
  servers[id] = { id, worktree, pid, port, background, startedAt: new Date().toISOString() }
  writeRegistry(servers, cwd)
  return servers[id]
}

/**
 * Unregister a server by ID.
 */
export function unregister(id, cwd) {
  const servers = readRegistry(cwd)
  delete servers[id]
  writeRegistry(servers, cwd)
}

/**
 * List all live servers (prunes dead ones first).
 */
export function list(cwd) {
  return Object.values(prune(cwd))
}

/**
 * Find servers running for a given worktree name.
 */
export function findByWorktree(name, cwd) {
  return list(cwd).filter((s) => s.worktree === name)
}

/**
 * Find a server by its unique ID.
 */
export function findById(id, cwd) {
  const servers = prune(cwd)
  return servers[id] || null
}
