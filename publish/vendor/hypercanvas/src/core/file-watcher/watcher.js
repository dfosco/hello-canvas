/**
 * File Watcher (formerly Rename Watcher)
 *
 * Detects file and directory renames under watched directories and updates:
 *   - Canvas embed URLs (prototype and canvas widgets) to stay current.
 *   - File widget `props.path` references when the underlying repo file moves.
 * Auto-commits the changes with a configurable prefix.
 *
 * Uses snapshot-based diffing: on any fs event, re-scans the watched
 * directories and compares old vs new file sets. Only unambiguous renames
 * (1:1 file or directory mappings) are acted on.
 *
 * Configuration is loaded from config.json in this directory.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { materializeFromText } from '../canvas/materializer.js'
import { toCanvasId } from '../canvas/identity.js'

// ─── Logging ─────────────────────────────────────────────────────────

const dim = (s) => `\x1b[2m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

function log(msg) { console.log(dim(`  ◈ file-watcher: ${msg}`)) }
function logSuccess(msg) { console.log(green(`  ✓ file-watcher: ${msg}`)) }
function logWarn(msg) { console.log(yellow(`  ⚠ file-watcher: ${msg}`)) }

// ─── Config ──────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = new URL('./config.json', import.meta.url)
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
}

// ─── File scanning ───────────────────────────────────────────────────

/**
 * Scan a watched directory and return a Set of relative file paths
 * matching the configured extensions and exclusions.
 */
function scanDirectory(root, watchEntry, config) {
  const results = new Set()
  const absDir = path.join(root, watchEntry.path)

  if (!fs.existsSync(absDir)) return results

  const excludeDirs = new Set(config.exclude.directories)
  const excludePrefixes = config.exclude.filePrefixes
  const extensions = watchEntry.extensions

  function walk(dir, rel) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      if (excludeDirs.has(entry.name)) continue
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath)
      } else {
        if (excludePrefixes.some((p) => entry.name.startsWith(p))) continue
        if (extensions.some((ext) => entry.name.endsWith(ext))) {
          results.add(relPath)
        }
      }
    }
  }

  walk(absDir, '')
  return results
}

// ─── Route computation ───────────────────────────────────────────────

/**
 * Compute the route path for a prototype file (relative to src/prototypes/).
 * Mirrors the route regex in src/routes.jsx — strips `.folder/` segments,
 * `drafts/` segments (scratch dirs share the public URL of their non-draft
 * sibling), and trailing file extension.
 */
function prototypeRoute(relPath) {
  let route = relPath
    .replace(/[^/]*\.folder\//g, '')
    .split('/')
    .filter((seg) => seg !== 'drafts')
    .join('/')
    .replace(/\.(jsx|tsx|mdx)$/, '')
    .replace(/\/index$/, '')

  if (!route.startsWith('/')) route = '/' + route
  return route || '/'
}

/**
 * Compute the route path for a canvas file (relative to src/canvas/).
 * Uses toCanvasId() for proper folder handling, then strips `drafts/`
 * segments so moves in/out of `drafts/` are no-ops.
 */
function canvasRoute(relPath) {
  // relPath is relative to src/canvas/, prepend prefix for toCanvasId()
  const canvasId = toCanvasId('src/canvas/' + relPath)
  const stripped = canvasId.split('/').filter((seg) => seg !== 'drafts').join('/')
  return '/canvas/' + stripped
}

function computeRoute(relPath, watchEntry) {
  if (watchEntry.type === 'prototype') return prototypeRoute(relPath)
  if (watchEntry.type === 'canvas') return canvasRoute(relPath)
  // For file-ref, return the repo-relative path by joining the watch entry's
  // base dir with the scan-relative path (path.posix.join normalises '.' → '').
  if (watchEntry.type === 'file-ref') return path.posix.join(watchEntry.path, relPath)
  return null
}

// ─── Drafts-flip detection (canvas only) ─────────────────────────────

/**
 * Returns true if any path segment is exactly `drafts`.
 */
function isDraftRelPath(relPath) {
  return relPath.split('/').some((seg) => seg === 'drafts')
}

/**
 * Strip `drafts` segments from a canvas-relative path's directory portion
 * to derive a stable "identity" that survives in/out-of-drafts moves.
 *
 * e.g. `foo.canvas.jsonl` and `drafts/foo.canvas.jsonl` both → `foo.canvas.jsonl`.
 */
function stripDraftsFromRelPath(relPath) {
  return relPath.split('/').filter((seg) => seg !== 'drafts').join('/')
}

/**
 * Detect canvas files that crossed the `drafts/` boundary. A flip is an
 * unambiguous 1:1 pair of (removed, added) `.canvas.jsonl` files whose
 * paths agree after stripping `drafts` segments but differ in draft status.
 *
 * This complements detectRenames(), which intentionally ignores in/out-of-drafts
 * moves because the public route (canvasRoute) strips `drafts` segments and so
 * sees both sides as the same route.
 *
 * Returns an array of `{ oldPath, newPath, oldDraft, newDraft }`.
 */
function detectDraftsFlips(oldSnapshot, newSnapshot) {
  const removed = [...oldSnapshot].filter((f) => !newSnapshot.has(f))
  const added = [...newSnapshot].filter((f) => !oldSnapshot.has(f))
  if (removed.length === 0 || added.length === 0) return []

  const removedByIdentity = new Map()
  for (const f of removed) {
    if (!f.endsWith('.canvas.jsonl')) continue
    const key = stripDraftsFromRelPath(f)
    if (!removedByIdentity.has(key)) removedByIdentity.set(key, [])
    removedByIdentity.get(key).push(f)
  }
  const addedByIdentity = new Map()
  for (const f of added) {
    if (!f.endsWith('.canvas.jsonl')) continue
    const key = stripDraftsFromRelPath(f)
    if (!addedByIdentity.has(key)) addedByIdentity.set(key, [])
    addedByIdentity.get(key).push(f)
  }

  const flips = []
  for (const [key, removedList] of removedByIdentity) {
    const addedList = addedByIdentity.get(key) || []
    // Skip ambiguous cases (multiple files with the same drafts-stripped path)
    if (removedList.length !== 1 || addedList.length !== 1) continue
    const oldPath = removedList[0]
    const newPath = addedList[0]
    const oldDraft = isDraftRelPath(oldPath)
    const newDraft = isDraftRelPath(newPath)
    if (oldDraft === newDraft) continue
    flips.push({ oldPath, newPath, oldDraft, newDraft })
  }
  return flips
}

// ─── Rename detection ────────────────────────────────────────────────

/**
 * Get compound extension (e.g. '.canvas.jsonl' not just '.jsonl').
 */
function getCompoundExt(filePath) {
  const base = path.basename(filePath)
  const parts = base.split('.')
  if (parts.length >= 3) return '.' + parts.slice(-2).join('.')
  return path.extname(filePath)
}

function groupByDir(paths) {
  const groups = new Map()
  for (const p of paths) {
    const dir = path.dirname(p)
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push(p)
  }
  return groups
}

/**
 * Find the longest common directory prefix of an array of paths.
 */
function commonDirPrefix(paths) {
  if (paths.length === 0) return ''
  if (paths.length === 1) {
    const dir = path.dirname(paths[0])
    return dir === '.' ? '' : dir + '/'
  }

  const sorted = [...paths].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  let i = 0
  while (i < first.length && i < last.length && first[i] === last[i]) i++

  const prefix = first.slice(0, i)
  const lastSlash = prefix.lastIndexOf('/')
  return lastSlash >= 0 ? prefix.slice(0, lastSlash + 1) : ''
}

/**
 * Detect renames by diffing old and new file snapshots.
 * Only returns unambiguous renames to avoid false positives.
 *
 * Phase 1 — File renames: same directory, same extension, exactly 1 removed + 1 added.
 * Phase 2 — Directory renames: a single directory-prefix swap explains all remaining changes.
 */
function detectRenames(oldSnapshot, newSnapshot, watchEntry) {
  const removed = [...oldSnapshot].filter((f) => !newSnapshot.has(f))
  const added = [...newSnapshot].filter((f) => !oldSnapshot.has(f))

  if (removed.length === 0 || added.length === 0) return []

  const renames = []
  const matchedRemoved = new Set()
  const matchedAdded = new Set()

  // Phase 1: File-level renames
  const removedByDir = groupByDir(removed)
  const addedByDir = groupByDir(added)

  for (const [dir, dirRemoved] of removedByDir) {
    const dirAdded = addedByDir.get(dir) || []
    if (dirRemoved.length !== 1 || dirAdded.length !== 1) continue
    if (getCompoundExt(dirRemoved[0]) !== getCompoundExt(dirAdded[0])) continue

    const oldRoute = computeRoute(dirRemoved[0], watchEntry)
    const newRoute = computeRoute(dirAdded[0], watchEntry)

    if (oldRoute === newRoute) continue

    renames.push({ oldPath: dirRemoved[0], newPath: dirAdded[0], oldRoute, newRoute })
    matchedRemoved.add(dirRemoved[0])
    matchedAdded.add(dirAdded[0])
  }

  // Phase 2: Directory-level renames
  const unmatchedRemoved = removed.filter((f) => !matchedRemoved.has(f))
  const unmatchedAdded = added.filter((f) => !matchedAdded.has(f))

  if (unmatchedRemoved.length > 0 && unmatchedRemoved.length === unmatchedAdded.length) {
    const oldPrefix = commonDirPrefix(unmatchedRemoved)
    const newPrefix = commonDirPrefix(unmatchedAdded)

    if (oldPrefix && newPrefix && oldPrefix !== newPrefix) {
      const expectedAdded = new Set(
        unmatchedRemoved.map((f) => newPrefix + f.slice(oldPrefix.length)),
      )
      const allMatch = unmatchedAdded.every((f) => expectedAdded.has(f))

      if (allMatch) {
        for (const oldFile of unmatchedRemoved) {
          const newFile = newPrefix + oldFile.slice(oldPrefix.length)
          const oldRoute = computeRoute(oldFile, watchEntry)
          const newRoute = computeRoute(newFile, watchEntry)
          if (oldRoute !== newRoute) {
            renames.push({ oldPath: oldFile, newPath: newFile, oldRoute, newRoute })
          }
        }
      }
    }
  }

  return renames
}

// ─── Canvas embed updating ───────────────────────────────────────────

/**
 * Find all .canvas.jsonl files in the project.
 */
function findAllCanvasFiles(root) {
  const results = []
  const ignore = new Set(['node_modules', 'dist', '.git', '.worktrees', 'worktrees'])

  function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(fullPath)
      else if (entry.name.endsWith('.canvas.jsonl')) results.push(fullPath)
    }
  }

  walk(root)
  return results
}

/**
 * Rewrite a URL's pathname if it matches a renamed route.
 * Uses segment-boundary matching to avoid partial matches (e.g. /Signup vs /Signup2).
 */
function rewriteUrl(src, renames) {
  const hashIdx = src.indexOf('#')
  const queryIdx = src.indexOf('?')

  let pathname, suffix
  if (hashIdx >= 0 && (queryIdx < 0 || hashIdx < queryIdx)) {
    pathname = src.slice(0, hashIdx)
    suffix = src.slice(hashIdx)
  } else if (queryIdx >= 0) {
    pathname = src.slice(0, queryIdx)
    suffix = src.slice(queryIdx)
  } else {
    pathname = src
    suffix = ''
  }

  for (const { oldRoute, newRoute } of renames) {
    if (!oldRoute || !newRoute) continue

    // Exact match
    if (pathname === oldRoute) return newRoute + suffix
    // Segment-boundary prefix match
    if (pathname.startsWith(oldRoute + '/')) {
      return newRoute + pathname.slice(oldRoute.length) + suffix
    }
  }

  return src
}

/**
 * Rewrite a repo-relative file path if it matches a renamed file or directory.
 * Checks exact matches first, then directory-prefix matches. Prefix matching
 * only fires for directory renames (where the file's parent dir changed), not
 * for in-directory file renames — this prevents false positives when two files
 * share the same parent directory but only one was renamed.
 */
function rewriteFilePath(oldPath, fileRenames) {
  if (!fileRenames || fileRenames.size === 0) return oldPath

  // Exact match
  if (fileRenames.has(oldPath)) return fileRenames.get(oldPath)

  // Prefix match — only for directory renames (old and new file in different dirs)
  for (const [oldFile, newFile] of fileRenames) {
    const oldSep = oldFile.lastIndexOf('/')
    if (oldSep < 0) continue  // top-level file rename — no directory prefix to apply
    const oldDir = oldFile.slice(0, oldSep + 1)
    const newDir = newFile.slice(0, newFile.lastIndexOf('/') + 1)
    if (oldDir === newDir) continue  // same directory — file rename, not dir rename
    if (oldPath.startsWith(oldDir)) {
      return newDir + oldPath.slice(oldDir.length)
    }
  }

  return oldPath
}

/**
 * Update widget embed refs for detected renames.
 * Returns the updated widgets array if any changed, null if unchanged.
 */
function updateWidgetRefs(widgets, renames, fileRenames) {
  let changed = false

  const updated = widgets.map((widget) => {
    // Embed widgets (prototype / canvas) — rewrite props.src via route renames
    if (widget.type === 'prototype' || widget.type === 'canvas') {
      const src = widget.props?.src
      if (!src || typeof src !== 'string') return widget

      const newSrc = rewriteUrl(src, renames)
      if (newSrc === src) return widget

      changed = true
      return { ...widget, props: { ...widget.props, src: newSrc } }
    }

    // File widgets — rewrite props.path via file-ref renames
    if (widget.type === 'file') {
      const p = widget.props?.path
      if (!p || typeof p !== 'string') return widget

      const newP = rewriteFilePath(p, fileRenames)
      if (newP === p) return widget

      changed = true
      return { ...widget, props: { ...widget.props, path: newP } }
    }

    return widget
  })

  return changed ? updated : null
}

// ─── Drafts-flip processing ──────────────────────────────────────────

/**
 * Parse an image widget src into its `drafts/` segment and basename.
 *   "foo.png"          → { hasDrafts: false, basename: "foo.png" }
 *   "drafts/foo.png"   → { hasDrafts: true,  basename: "foo.png" }
 *   anything else      → null
 */
function parseImageSrc(src) {
  if (!src || typeof src !== 'string') return null
  if (src.includes('..') || src.includes('\\')) return null
  const segments = src.split('/')
  if (segments.length === 1 && segments[0]) return { hasDrafts: false, basename: segments[0] }
  if (segments.length === 2 && segments[0] === 'drafts' && segments[1]) {
    return { hasDrafts: true, basename: segments[1] }
  }
  return null
}

/**
 * Count how many references each image src has across the given canvas
 * files, optionally excluding one absolute canvas path. Used to detect
 * shared images before moving them.
 */
function collectImageRefs(canvasFiles, excludeAbsPath) {
  const refs = new Map()
  for (const file of canvasFiles) {
    if (file === excludeAbsPath) continue
    try {
      const text = fs.readFileSync(file, 'utf-8')
      const state = materializeFromText(text)
      for (const w of state.widgets || []) {
        if (w.type !== 'image') continue
        const s = w.props?.src
        if (!s || typeof s !== 'string') continue
        refs.set(s, (refs.get(s) || 0) + 1)
      }
    } catch { /* skip unreadable files */ }
  }
  return refs
}

/**
 * Pick a unique basename in `targetDir` by appending `-2`, `-3`, … before
 * the extension. Used when moving an image into a directory that already
 * has a file with the same name.
 */
function uniqueBasename(targetDir, basename) {
  if (!fs.existsSync(path.join(targetDir, basename))) return basename
  const ext = path.extname(basename)
  const stem = basename.slice(0, basename.length - ext.length)
  let i = 2
  while (true) {
    const candidate = `${stem}-${i}${ext}`
    if (!fs.existsSync(path.join(targetDir, candidate))) return candidate
    i++
  }
}

/**
 * Move image files referenced by a canvas that crossed the drafts boundary,
 * and produce the rewritten widget array.
 *
 * Strategy per image widget:
 *   - parse `props.src`; compute oldDir/newDir from old/new draft status
 *   - if file not present on disk → just rewrite src
 *   - if target collides → pick a unique basename
 *   - if image is shared with another canvas → COPY (preserve source)
 *   - otherwise → RENAME (atomic move)
 *
 * Returns { widgets, fileOps } where fileOps is the list of disk changes
 * for the autocommit pass to surface to git.
 */
function processDraftsFlipImages(root, flip, canvasFiles) {
  const newAbsPath = path.join(root, 'src/canvas', flip.newPath)
  let state
  try {
    const text = fs.readFileSync(newAbsPath, 'utf-8')
    state = materializeFromText(text)
  } catch (err) {
    logWarn(`Could not read ${flip.newPath}: ${err.message}`)
    return null
  }
  if (!state.widgets || state.widgets.length === 0) return null

  const imagesDir = path.join(root, 'assets', 'canvas', 'images')
  const draftsDir = path.join(imagesDir, 'drafts')
  const sharedRefs = collectImageRefs(canvasFiles, newAbsPath)

  const fileOps = []
  let changed = false

  const updated = state.widgets.map((widget) => {
    if (widget.type !== 'image') return widget
    const parsed = parseImageSrc(widget.props?.src)
    if (!parsed) return widget

    // The "old" src is whatever the widget currently stores; the "new"
    // src should reflect the canvas's new draft status.
    const oldDir = parsed.hasDrafts ? draftsDir : imagesDir
    const newDir = flip.newDraft ? draftsDir : imagesDir
    if (oldDir === newDir) return widget // already in correct dir

    const oldAbs = path.join(oldDir, parsed.basename)
    let finalBasename = parsed.basename
    let finalAbs = path.join(newDir, finalBasename)

    if (!fs.existsSync(oldAbs)) {
      // Source missing — file may already have been moved or never existed.
      // Still rewrite src to match the canvas's draft status if the target
      // exists; otherwise skip.
      if (fs.existsSync(finalAbs)) {
        const newSrc = flip.newDraft ? `drafts/${finalBasename}` : finalBasename
        changed = true
        return { ...widget, props: { ...widget.props, src: newSrc } }
      }
      return widget
    }

    // Collision in target dir → pick a unique name
    if (fs.existsSync(finalAbs)) {
      finalBasename = uniqueBasename(newDir, parsed.basename)
      finalAbs = path.join(newDir, finalBasename)
    }

    const oldSrc = widget.props.src
    const sharedCount = sharedRefs.get(oldSrc) || 0

    fs.mkdirSync(newDir, { recursive: true })
    if (sharedCount > 0) {
      // Another canvas still references the source file — copy, don't move.
      fs.copyFileSync(oldAbs, finalAbs)
      // Track the target for git if it's a public file (draft→public copy)
      if (!flip.newDraft) fileOps.push({ type: 'add', path: finalAbs })
    } else {
      fs.renameSync(oldAbs, finalAbs)
      if (!flip.newDraft) {
        // draft→public: new public file should be tracked
        fileOps.push({ type: 'add', path: finalAbs })
      } else {
        // public→draft: old public file is now gone; stage its deletion
        fileOps.push({ type: 'rm', path: oldAbs })
      }
    }

    const newSrc = flip.newDraft ? `drafts/${finalBasename}` : finalBasename
    changed = true
    return { ...widget, props: { ...widget.props, src: newSrc } }
  })

  return changed ? { widgets: updated, fileOps } : null
}

// ─── Auto-commit ─────────────────────────────────────────────────────

// Lock file placed in .git/ during commit. Both the rename watcher and
// autosync share the same working tree and git index, so this file
// lets autosync's isRepoBusy() (or any future tool) detect that the
// rename watcher is mid-commit and defer its own cycle.
const LOCK_FILENAME = 'storyboard-autofix.lock'

/**
 * Resolve the .git directory, handling both regular repos and worktrees.
 * In a worktree, `.git` is a file pointing to the real git dir.
 */
function resolveGitDir(root) {
  const dotGit = path.join(root, '.git')
  try {
    const stat = fs.statSync(dotGit)
    if (stat.isDirectory()) return dotGit
    // Worktree: .git is a file like "gitdir: /path/to/.git/worktrees/name"
    const content = fs.readFileSync(dotGit, 'utf-8').trim()
    const match = content.match(/^gitdir:\s*(.+)$/)
    if (match) return path.resolve(root, match[1])
  } catch { /* fallback */ }
  return dotGit
}

/**
 * Check if the repo is in a busy state that would conflict with a commit.
 *
 * Mirrors autosync's isRepoBusy() guards so both systems respect the same
 * signals: index.lock, rebase, merge, cherry-pick, and the autofix lock file.
 * Since both autosync and the rename watcher commit directly on the current
 * branch (same working tree, same index), index.lock is the primary mutex.
 */
function isRepoBusy(root) {
  const gitDir = resolveGitDir(root)

  if (fs.existsSync(path.join(gitDir, 'index.lock'))) {
    logWarn('Auto-commit deferred: index.lock present')
    return true
  }
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
    logWarn('Auto-commit deferred: merge in progress')
    return true
  }
  if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
    logWarn('Auto-commit deferred: cherry-pick in progress')
    return true
  }
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
    logWarn('Auto-commit deferred: rebase in progress')
    return true
  }

  // Check for our own stale lock (crash recovery)
  const lockPath = path.join(gitDir, LOCK_FILENAME)
  if (fs.existsSync(lockPath)) {
    try {
      const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs
      if (lockAge < 10_000) {
        logWarn('Auto-commit deferred: previous autofix still in progress')
        return true
      }
      // Stale lock (>10s) — remove it
      fs.unlinkSync(lockPath)
    } catch { /* race — fine */ }
  }

  return false
}

/**
 * Auto-commit modified canvas files using git commit --only to isolate
 * from any other staged or unstaged user work.
 *
 * Coordinates with autosync (which shares the same working tree + index) via:
 * - Lock file (.git/storyboard-autofix.lock) to signal mid-commit
 * - Same repo-busy guards autosync checks (index.lock, merge, rebase, cherry-pick)
 * - git commit --only uses a temporary index, so it won't interfere with
 *   files autosync may have staged independently
 *
 * `fileOps` is the list of image-file moves from drafts flips. We pass each
 * op's path to `git add -A` (which stages adds, modifications, and deletions
 * uniformly) and only stage paths git can actually track — we never try to
 * `git add` a file inside a gitignored directory.
 *
 * If the commit is deferred (busy repo), the canvas JSONL update and image
 * moves stay on disk — autosync's next cycle will pick them up naturally.
 */
function autocommit(root, modifiedFiles, renames, draftsFlips, fileOps, config) {
  if (!config.autocommit.enabled) return
  if (modifiedFiles.length === 0 && fileOps.length === 0) return

  const trackedPaths = new Set()
  for (const f of modifiedFiles) trackedPaths.add(path.relative(root, f))
  // Only image file ops whose path lives outside gitignored dirs are added
  // to the index. `processDraftsFlipImages` already filters: it only emits
  // ops for public-side paths (draft→public adds the new public file;
  // public→draft removes the old public file — both safe to stage).
  for (const op of fileOps) trackedPaths.add(path.relative(root, op.path))

  if (trackedPaths.size === 0) return
  if (isRepoBusy(root)) return

  const gitDir = resolveGitDir(root)
  const lockPath = path.join(gitDir, LOCK_FILENAME)

  try {
    fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`, 'utf-8')

    const relPaths = [...trackedPaths]
    // -A stages add/modify/delete uniformly so we can mix new image files
    // and deleted public image files in a single pass.
    execFileSync('git', ['add', '-A', '--', ...relPaths], { cwd: root, stdio: 'pipe' })

    const summaryParts = []
    const renameSummary = [...new Set(
      renames
        .filter((r) => r.oldRoute && r.newRoute)
        .map((r) => `${r.oldRoute} → ${r.newRoute}`),
    )].join(', ')
    if (renameSummary) summaryParts.push(`Update embed URLs: ${renameSummary}`)

    if (draftsFlips.length > 0) {
      const flipSummary = draftsFlips
        .map((f) => `${f.oldPath} → ${f.newPath}`)
        .join(', ')
      summaryParts.push(`Drafts move: ${flipSummary}`)
    }

    const message = `${config.autocommit.prefix} ${summaryParts.join(' | ')}`

    execFileSync('git', ['commit', '--only', '--', ...relPaths, '-m', message], {
      cwd: root,
      stdio: 'pipe',
    })

    logSuccess(`Auto-committed: ${summaryParts.join(' | ')}`)
  } catch (err) {
    logWarn(`Auto-commit skipped: ${(err.message || '').split('\n')[0]}`)
  } finally {
    try { fs.unlinkSync(lockPath) } catch { /* already gone */ }
  }
}

// ─── Main ────────────────────────────────────────────────────────────

/**
 * Process a detected change — rescan, detect renames + drafts flips, update
 * embeds, move drafts-flip image files, commit.
 */
function processChange(root, snapshots, config) {
  const allRenames = []
  const allFileRefRenames = []
  const allDraftsFlips = []

  for (const entry of config.watch) {
    const oldSnapshot = snapshots.get(entry.path)
    const newSnapshot = scanDirectory(root, entry, config)
    const renames = detectRenames(oldSnapshot, newSnapshot, entry)
    if (entry.type === 'file-ref') {
      if (renames.length > 0) allFileRefRenames.push(...renames)
    } else {
      if (renames.length > 0) allRenames.push(...renames)
    }
    if (entry.type === 'canvas') {
      const flips = detectDraftsFlips(oldSnapshot, newSnapshot)
      if (flips.length > 0) allDraftsFlips.push(...flips)
    }
    snapshots.set(entry.path, newSnapshot)
  }

  if (allRenames.length === 0 && allDraftsFlips.length === 0 && allFileRefRenames.length === 0) return

  // Deduplicate route renames by route pair
  const uniqueRenames = []
  const seen = new Set()
  for (const r of allRenames) {
    const key = `${r.oldRoute}→${r.newRoute}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueRenames.push(r)
      log(`Detected: ${r.oldRoute} → ${r.newRoute}`)
    }
  }

  // Build file-ref renames map (old repo-relative path → new repo-relative path)
  const fileRenames = new Map()
  for (const r of allFileRefRenames) {
    if (r.oldRoute && r.newRoute && r.oldRoute !== r.newRoute) {
      if (!fileRenames.has(r.oldRoute)) {
        fileRenames.set(r.oldRoute, r.newRoute)
        log(`Detected file-ref: ${r.oldRoute} → ${r.newRoute}`)
      }
    }
  }

  for (const f of allDraftsFlips) {
    log(`Detected drafts ${f.oldDraft ? 'out' : 'in'}: ${f.oldPath} → ${f.newPath}`)
  }

  const canvasFiles = findAllCanvasFiles(root)
  const modifiedFiles = []
  const allFileOps = []

  // 1. Rewrite embed URLs in all canvases for route renames, and
  //    file widget paths for file-ref renames.
  if (uniqueRenames.length > 0 || fileRenames.size > 0) {
    for (const canvasFile of canvasFiles) {
      try {
        const text = fs.readFileSync(canvasFile, 'utf-8')
        const state = materializeFromText(text)

        if (!state.widgets || state.widgets.length === 0) continue

        const updatedWidgets = updateWidgetRefs(state.widgets, uniqueRenames, fileRenames)
        if (updatedWidgets) {
          const event = {
            event: 'widgets_replaced',
            timestamp: new Date().toISOString(),
            widgets: updatedWidgets,
          }
          fs.appendFileSync(canvasFile, JSON.stringify(event) + '\n', 'utf-8')
          modifiedFiles.push(canvasFile)
          log(`Updated embeds in ${path.relative(root, canvasFile)}`)
        }
      } catch (err) {
        logWarn(`Failed to update ${path.basename(canvasFile)}: ${err.message}`)
      }
    }
  }

  // 2. For each canvas that crossed the drafts boundary, move its image
  //    files between assets/canvas/images/ and assets/canvas/images/drafts/
  //    and append a widgets_replaced event with rewritten props.src.
  for (const flip of allDraftsFlips) {
    try {
      const result = processDraftsFlipImages(root, flip, canvasFiles)
      if (!result) continue
      const newAbsPath = path.join(root, 'src/canvas', flip.newPath)
      const event = {
        event: 'widgets_replaced',
        timestamp: new Date().toISOString(),
        widgets: result.widgets,
      }
      fs.appendFileSync(newAbsPath, JSON.stringify(event) + '\n', 'utf-8')
      if (!modifiedFiles.includes(newAbsPath)) modifiedFiles.push(newAbsPath)
      allFileOps.push(...result.fileOps)
      const dir = flip.newDraft ? 'into drafts' : 'out of drafts'
      log(`Moved ${result.fileOps.length} image(s) ${dir} for ${flip.newPath}`)
    } catch (err) {
      logWarn(`Failed to process drafts flip ${flip.newPath}: ${err.message}`)
    }
  }

  autocommit(root, modifiedFiles, uniqueRenames, allDraftsFlips, allFileOps, config)
}

/**
 * Start the file watcher.
 * @param {string} root — project root directory
 * @returns {{ close: () => void }}
 */
export function startFileWatcher(root) {
  const config = loadConfig()
  const watchers = []
  const snapshots = new Map()

  for (const entry of config.watch) {
    snapshots.set(entry.path, scanDirectory(root, entry, config))
  }

  let debounceTimer = null

  function handleChange() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      try {
        processChange(root, snapshots, config)
      } catch (err) {
        logWarn(`Error: ${err.message}`)
      }
    }, config.debounceMs)
  }

  for (const entry of config.watch) {
    const absDir = path.join(root, entry.path)
    if (!fs.existsSync(absDir)) {
      logWarn(`Skipping ${entry.path} (not found)`)
      continue
    }

    try {
      const watcher = fs.watch(absDir, { recursive: true }, handleChange)
      watcher.on('error', (err) => logWarn(`${entry.path}: ${err.message}`))
      watchers.push(watcher)
    } catch (err) {
      logWarn(`Could not watch ${entry.path}: ${err.message}`)
    }
  }

  return {
    close() {
      if (debounceTimer) clearTimeout(debounceTimer)
      for (const w of watchers) w.close()
    },
  }
}

// ─── Test-only exports ───────────────────────────────────────────────
// Exposed for unit tests in `watcher.test.js`; not part of the public API.
export const __test = {
  detectDraftsFlips,
  processDraftsFlipImages,
  processChange,
  scanDirectory,
  loadConfig,
  rewriteFilePath,
  updateWidgetRefs,
}
