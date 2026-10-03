/**
 * tree.js — repo file-tree walker for the File Widget server API.
 *
 * Pure module: no HTTP, no side effects, no global state.
 * Exports:
 *   GLOBAL_IGNORE_DIRS  — Set of directory/path segments always excluded
 *   buildFileTree(root, options)  — walk and return nested tree
 *   isPathAllowed(root, absPath, config)  — path validation + allowedRoots check
 */

import fs from 'node:fs'
import path from 'node:path'
import { detectFlavor } from '../../internals/canvas/widgets/FileWidget/fileFlavor.js'

/**
 * Directories (by name) that are always excluded from the file tree,
 * regardless of allowedRoots config. This is the single source of truth
 * used by both tree.js and server.js.
 */
export const GLOBAL_IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.worktrees',
  'worktrees',
  '.storyboard',
  'assets',  // assets/canvas/images is handled by the image API; exclude whole dir
])

/**
 * Repo-relative path prefixes that are always excluded (prefix match).
 * Distinct from GLOBAL_IGNORE_DIRS (which are dir-name based).
 */
const GLOBAL_IGNORE_PREFIXES = [
  'assets/canvas/images',
]

/**
 * Check if a repo-relative POSIX path falls inside a globally ignored prefix.
 */
function isGloballyIgnoredPrefix(relPosix) {
  for (const prefix of GLOBAL_IGNORE_PREFIXES) {
    if (relPosix === prefix || relPosix.startsWith(prefix + '/')) return true
  }
  return false
}

/**
 * Determine whether absPath is allowed given:
 *  - global ignore list (always wins)
 *  - fileWidget.allowedRoots from storyboard.config.json (if set)
 *
 * @param {string} root  — absolute repo root
 * @param {string} absPath  — absolute path to check
 * @param {object} [config]  — parsed storyboard.config.json (optional)
 * @returns {boolean}
 */
export function isPathAllowed(root, absPath, config) {
  const normalRoot = path.resolve(root)
  const normalAbs = path.resolve(absPath)

  // Must be inside the repo root
  if (!normalAbs.startsWith(normalRoot + path.sep) && normalAbs !== normalRoot) return false

  const relPosix = normalAbs.slice(normalRoot.length).replace(/\\/g, '/').replace(/^\//, '')

  // Check global prefix ignores
  if (isGloballyIgnoredPrefix(relPosix)) return false

  // Check each path segment against GLOBAL_IGNORE_DIRS
  const segments = relPosix.split('/')
  for (const seg of segments) {
    if (GLOBAL_IGNORE_DIRS.has(seg)) return false
  }

  // Check allowedRoots if configured
  const allowedRoots = config?.fileWidget?.allowedRoots
  if (Array.isArray(allowedRoots) && allowedRoots.length > 0) {
    const inside = allowedRoots.some((allowed) => {
      const normalAllowed = allowed.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '')
      return relPosix === normalAllowed || relPosix.startsWith(normalAllowed + '/')
    })
    if (!inside) return false
  }

  return true
}

/**
 * Walk the repo from `startDir` (defaults to root) and build a nested tree.
 * Only text files (as determined by detectFlavor) are included.
 *
 * @param {string} root  — absolute repo root
 * @param {object} [options]
 * @param {string} [options.startDir]  — repo-relative dir to start from (default: root)
 * @param {object} [options.config]  — parsed storyboard.config.json
 * @returns {{ name: string, path: string, kind: 'dir'|'file', children?: Array }[]}
 */
export function buildFileTree(root, options = {}) {
  const { startDir, config } = options
  const absStart = startDir ? path.resolve(root, startDir) : path.resolve(root)

  if (!fs.existsSync(absStart)) return []

  function walk(absDir, relBase) {
    let entries
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }) } catch { return [] }

    const children = []

    for (const entry of entries) {
      if (GLOBAL_IGNORE_DIRS.has(entry.name)) continue

      const absPath = path.join(absDir, entry.name)
      const relPosix = relBase ? `${relBase}/${entry.name}` : entry.name

      if (isGloballyIgnoredPrefix(relPosix)) continue

      if (entry.isDirectory()) {
        if (!isPathAllowed(root, absPath, config)) continue
        const subtree = walk(absPath, relPosix)
        // Only include non-empty directories
        if (subtree.length > 0) {
          children.push({ name: entry.name, path: relPosix, kind: 'dir', children: subtree })
        }
      } else if (entry.isFile()) {
        if (!isPathAllowed(root, absPath, config)) continue
        const flavor = detectFlavor(entry.name)
        if (!flavor.isText) continue
        children.push({ name: entry.name, path: relPosix, kind: 'file' })
      }
    }

    // Sort: dirs first, then files; each group alphabetical
    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return children
  }

  // Compute relBase for startDir
  const normalRoot = path.resolve(root)
  const relBase = absStart === normalRoot
    ? ''
    : absStart.slice(normalRoot.length + 1).replace(/\\/g, '/')

  return walk(absStart, relBase)
}
