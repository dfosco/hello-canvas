/**
 * Autosync Server — automatic commit + push watcher.
 *
 * Dev-server middleware that provides git automation:
 * - List branches (excluding main/master)
 * - Enable/disable autosync per scope (canvas/prototype)
 * - Direct commit + push on the current branch (scoped files only)
 * - Push watcher: every 30s runs enabled scopes in relay sequence
 * - Persists state to .storyboard/autosync.json to survive server restarts
 * - Pauses on branch change, resumes when user returns to target branch
 *
 * Routes (mounted at /_storyboard/autosync/):
 *   GET    /branches — list local git branches (excludes main/master)
 *   GET    /status   — current state (branch, enabled scopes, last sync/errors)
 *   POST   /enable   — enable autosync for a scope on a branch
 *   POST   /disable  — disable autosync for a scope (or all scopes)
 *   POST   /sync     — trigger a single sync cycle manually
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ── Module-level watcher state (singleton, survives page reloads) ──

let schedulerInterval = null
let schedulerTimeout = null
let targetBranch = null
let originalBranch = null
let lastSyncTime = null
let lastError = null
let syncing = false
let syncingScope = null
let pausedOnBranchChange = false
let previousActiveBranch = null

let enabledScopes = { canvas: false, prototype: false }
let lastSyncByScope = { canvas: null, prototype: null }
let lastErrorByScope = { canvas: null, prototype: null }

const SYNC_INTERVAL_MS = 30_000
const PUSH_RETRY_LIMIT = 3
const SCOPE_ORDER = ['canvas', 'prototype']
const AUTOSYNC_SCOPES = new Set(SCOPE_ORDER)

// Branch names must match git ref format — alphanumeric, hyphens, dots, slashes
const BRANCH_NAME_RE = /^[\w][\w.\-/]*$/

// ── Persistence (.storyboard/autosync.json) ──

const PERSIST_DIR = '.storyboard'
const PERSIST_FILE = 'autosync.json'

/**
 * Load persisted autosync state from disk. Returns null on missing/corrupt files.
 */
export function loadPersistedState(root) {
  const filePath = join(root, PERSIST_DIR, PERSIST_FILE)
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    return validatePersistedState(data)
  } catch {
    return null
  }
}

/**
 * Validate loaded state — reject invalid/protected branches and bad types.
 */
function validatePersistedState(data) {
  const result = {}

  if (data.targetBranch && isValidBranch(data.targetBranch) && !isProtectedBranch(data.targetBranch)) {
    result.targetBranch = data.targetBranch
  }
  if (data.originalBranch && isValidBranch(data.originalBranch)) {
    result.originalBranch = data.originalBranch
  }
  if (data.previousActiveBranch && isValidBranch(data.previousActiveBranch)) {
    result.previousActiveBranch = data.previousActiveBranch
  }

  result.pausedOnBranchChange = data.pausedOnBranchChange === true
  result.lastSyncTime = typeof data.lastSyncTime === 'string' ? data.lastSyncTime : null
  result.lastSyncByScope = {
    canvas: typeof data.lastSyncByScope?.canvas === 'string' ? data.lastSyncByScope.canvas : null,
    prototype: typeof data.lastSyncByScope?.prototype === 'string' ? data.lastSyncByScope.prototype : null,
  }

  if (data.enabledScopes && typeof data.enabledScopes === 'object') {
    result.enabledScopes = {
      canvas: data.enabledScopes.canvas === true,
      prototype: data.enabledScopes.prototype === true,
    }
  } else {
    result.enabledScopes = { canvas: false, prototype: false }
  }

  // Must have a targetBranch and at least one enabled scope to be restorable
  if (!result.targetBranch || (!result.enabledScopes.canvas && !result.enabledScopes.prototype)) {
    return null
  }

  return result
}

/**
 * Persist current autosync state to disk (atomic write via tmp + rename).
 */
export function persistState(root) {
  const dirPath = join(root, PERSIST_DIR)
  const filePath = join(dirPath, PERSIST_FILE)
  const tmpPath = filePath + '.tmp'
  try {
    const currentBranch = getCurrentBranch(root)
    const data = {
      enabledScopes: { ...enabledScopes },
      targetBranch,
      originalBranch,
      previousActiveBranch,
      currentBranch,
      pausedOnBranchChange,
      lastSyncTime,
      lastSyncByScope: { ...lastSyncByScope },
    }
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, filePath)
  } catch {
    // Best-effort persistence — don't break autosync if disk write fails
  }
}

/**
 * Remove persisted state file (on explicit full disable).
 */
export function clearPersistedState(root) {
  const filePath = join(root, PERSIST_DIR, PERSIST_FILE)
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch { /* ignore — file may already be gone */ }
}

/**
 * Restore module-level state from a validated persisted snapshot.
 */
function applyPersistedState(data) {
  enabledScopes = { ...data.enabledScopes }
  targetBranch = data.targetBranch
  originalBranch = data.originalBranch || data.targetBranch
  previousActiveBranch = data.previousActiveBranch || null
  pausedOnBranchChange = data.pausedOnBranchChange || false
  lastSyncTime = data.lastSyncTime || null
  lastSyncByScope = { ...data.lastSyncByScope }
}

// ── Branch reconciliation ──

/**
 * Reconcile branch state — pause on drift, resume on return.
 * Called at server startup and on each scheduler tick.
 * Returns true if autosync is active (not paused), false if paused.
 */
export function reconcileBranch(root) {
  if (!targetBranch || !hasAnyScopeEnabled()) return true

  let current
  try {
    current = getCurrentBranch(root)
  } catch {
    return false // can't determine branch — don't sync
  }

  if (current === targetBranch) {
    // Back on the target branch — resume if we were paused
    if (pausedOnBranchChange) {
      pausedOnBranchChange = false
      previousActiveBranch = null
      persistState(root)
    }
    return true
  }

  // Branch drift — pause if not already paused
  if (!pausedOnBranchChange) {
    pausedOnBranchChange = true
    previousActiveBranch = targetBranch
    persistState(root)
  }
  return false
}

function isProtectedBranch(name) {
  const normalized = String(name || '').toLowerCase()
  return normalized === 'main' || normalized === 'master'
}

// ── Git helpers (argv-based, no shell) ──

function git(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 30_000 }).trim()
}

function getCurrentBranch(root) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], root)
}

function getUsername(root) {
  try {
    return git(['config', 'user.name'], root)
  } catch {
    return 'autosync'
  }
}

function getBranches(root) {
  const raw = git(['branch', '--list', '--format=%(refname:short)'], root)
  return raw
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && b.toLowerCase() !== 'main' && b.toLowerCase() !== 'master')
}

function getGitDir(root) {
  return resolve(root, git(['rev-parse', '--git-dir'], root))
}

function hasScopedStagedChanges(root, files) {
  if (!files || files.length === 0) return false
  const changed = git(['diff', '--cached', '--name-only', '--', ...files], root)
  return changed.length > 0
}

function listChangedFiles(root) {
  const tracked = git(['diff', '--name-only'], root)
  const untracked = git(['ls-files', '--others', '--exclude-standard'], root)
  return [tracked, untracked]
    .flatMap((raw) => raw.split('\n'))
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file, idx, arr) => arr.indexOf(file) === idx)
}

// ── Repo-busy guards ──

/**
 * Check if the repo is in a state where autosync should defer.
 * Returns { busy: true, reason } if unsafe, { busy: false } otherwise.
 */
export function isRepoBusy(root) {
  const gitDir = getGitDir(root)

  if (existsSync(join(gitDir, 'index.lock'))) {
    return { busy: true, reason: 'index.lock exists — another git process is active' }
  }
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) {
    return { busy: true, reason: 'rebase in progress' }
  }
  if (existsSync(join(gitDir, 'MERGE_HEAD'))) {
    return { busy: true, reason: 'merge in progress' }
  }
  if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return { busy: true, reason: 'cherry-pick in progress' }
  }

  if (targetBranch && getCurrentBranch(root) !== targetBranch) {
    return { busy: true, reason: `branch drift: expected ${targetBranch}, on ${getCurrentBranch(root)}` }
  }

  return { busy: false }
}

export function normalizeAutosyncScope(scope) {
  return AUTOSYNC_SCOPES.has(scope) ? scope : 'canvas'
}

export function matchesAutosyncScope(scope, filePath) {
  const normalizedScope = normalizeAutosyncScope(scope)
  const file = String(filePath || '').replaceAll('\\', '/').replace(/^\.\//, '')
  if (!file) return false

  if (normalizedScope === 'prototype') {
    return file === 'src/prototypes' || file.startsWith('src/prototypes/')
  }

  // canvas scope — includes canvas data, canvas assets, and public storyboard assets
  return (
    file === 'src/canvas' ||
    file.startsWith('src/canvas/') ||
    file.endsWith('.canvas.jsonl') ||
    file.startsWith('assets/canvas/') ||
    file.startsWith('assets/.storyboard-public/')
  )
}

export function filterFilesForAutosyncScope(scope, files) {
  return (files || []).filter((file) => matchesAutosyncScope(scope, file))
}

function listScopedChangedFiles(root, scope) {
  return filterFilesForAutosyncScope(scope, listChangedFiles(root))
}

function isValidBranch(name) {
  return typeof name === 'string' && BRANCH_NAME_RE.test(name) && name.length < 256
}

function formatTime() {
  return new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function isRetryablePushError(message) {
  const normalized = String(message || '').toLowerCase()
  return (
    normalized.includes('failed to push some refs') ||
    normalized.includes('non-fast-forward') ||
    normalized.includes('updates were rejected') ||
    normalized.includes('tip of your current branch is behind') ||
    normalized.includes('fetch first') ||
    normalized.includes('[rejected]')
  )
}

function hasAnyScopeEnabled() {
  return enabledScopes.canvas || enabledScopes.prototype
}

function getEnabledScopesInOrder() {
  return SCOPE_ORDER.filter((scope) => enabledScopes[scope])
}

function stopScheduler() {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout)
    schedulerTimeout = null
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

function getAlignedDelay() {
  const remainder = Date.now() % SYNC_INTERVAL_MS
  return remainder === 0 ? SYNC_INTERVAL_MS : SYNC_INTERVAL_MS - remainder
}

function resetRuntimeState({ clearBranch = true } = {}) {
  enabledScopes = { canvas: false, prototype: false }
  syncing = false
  syncingScope = null
  pausedOnBranchChange = false
  previousActiveBranch = null
  if (clearBranch) {
    targetBranch = null
    originalBranch = null
  }
}

/** Undo a commit that was never pushed, leaving files staged then unstaged. */
function rollbackUnpushedCommit(root, scopedFiles) {
  try {
    git(['reset', '--soft', 'HEAD~1'], root)
    git(['reset', '--', ...scopedFiles], root)
  } catch {
    // Best-effort rollback; if this fails the user's tree is still valid.
  }
}

function buildStatusPayload(root) {
  const singleScope = enabledScopes.canvas === enabledScopes.prototype
    ? null
    : (enabledScopes.canvas ? 'canvas' : 'prototype')

  return {
    enabled: hasAnyScopeEnabled(),
    enabledScopes: { ...enabledScopes },
    scope: singleScope, // legacy field for older clients
    branch: getCurrentBranch(root),
    targetBranch,
    originalBranch,
    availableScopes: [...AUTOSYNC_SCOPES],
    lastSyncTime,
    lastSyncByScope: { ...lastSyncByScope },
    lastError,
    lastErrorByScope: { ...lastErrorByScope },
    syncing,
    syncingScope,
    pausedOnBranchChange,
    previousActiveBranch,
  }
}

function stopAutosync(root, { clearBranch = true, clearErrors = false } = {}) {
  stopScheduler()
  resetRuntimeState({ clearBranch })
  if (clearErrors) {
    lastError = null
    lastErrorByScope = { canvas: null, prototype: null }
  }
}

// ── Sync cycle ──

/** Run one scoped sync — stage, commit, and push scoped files directly. */
function runSyncCycle(root, scope) {
  if (syncing) return false
  syncing = true
  syncingScope = scope
  let cycleSucceeded = false
  let committed = false
  let scopedFiles = []

  try {
    if (!targetBranch) {
      throw new Error('Autosync branch is not configured')
    }

    // Guard: skip if repo is busy (index lock, rebase, merge, branch drift)
    const busy = isRepoBusy(root)
    if (busy.busy) {
      cycleSucceeded = true // defer, not failure
      return true
    }

    scopedFiles = listScopedChangedFiles(root, scope)
    if (scopedFiles.length === 0) {
      cycleSucceeded = true
      return true
    }

    // Guard: skip if scoped files already have user-staged changes
    if (hasScopedStagedChanges(root, scopedFiles)) {
      cycleSucceeded = true // defer, not failure
      return true
    }

    git(['add', '-A', '--', ...scopedFiles], root)

    if (!hasScopedStagedChanges(root, scopedFiles)) {
      cycleSucceeded = true
      return true
    }

    const username = getUsername(root)
    const time = formatTime()
    git(
      ['commit', '-m', `[auto:${scope}] ${username} update at ${time}`, '--', ...scopedFiles],
      root,
    )
    committed = true

    for (let attempt = 1; attempt <= PUSH_RETRY_LIMIT; attempt += 1) {
      // Re-check guards before push/rebase
      const pushBusy = isRepoBusy(root)
      if (pushBusy.busy) {
        rollbackUnpushedCommit(root, scopedFiles)
        committed = false
        cycleSucceeded = true // defer
        return true
      }

      try {
        git(['push', 'origin', `HEAD:refs/heads/${targetBranch}`], root)
        cycleSucceeded = true
        break
      } catch (pushErr) {
        if (!isRetryablePushError(pushErr?.message) || attempt === PUSH_RETRY_LIMIT) {
          throw pushErr
        }

        // Fetch and rebase with autostash to handle non-fast-forward
        try {
          git(['fetch', 'origin', targetBranch], root)
          git(['rebase', '--autostash', 'FETCH_HEAD'], root)
        } catch {
          // Rebase failed — abort and defer
          try { git(['rebase', '--abort'], root) } catch { /* no rebase in progress */ }
          rollbackUnpushedCommit(root, scopedFiles)
          committed = false
          cycleSucceeded = true // defer, try again next cycle
          return true
        }
      }
    }
  } catch (err) {
    lastError = err.message || 'Sync failed'
    lastErrorByScope[scope] = lastError

    // Rollback the commit if we made one but never pushed
    if (committed) {
      rollbackUnpushedCommit(root, scopedFiles)
    }
  } finally {
    if (cycleSucceeded) {
      const nowIso = new Date().toISOString()
      lastSyncTime = nowIso
      lastSyncByScope[scope] = nowIso
      lastErrorByScope[scope] = null
      lastError = null
      // Persist state after actual commit+push (committed is still true only if push succeeded)
      if (committed) persistState(root)
    }
    syncing = false
    syncingScope = null
  }

  return cycleSucceeded
}

function runRelayCycle(root, scopes = getEnabledScopesInOrder()) {
  if (syncing || scopes.length === 0) return true

  // Reconcile branch state — pause on drift, resume on return
  if (!reconcileBranch(root)) return true // paused — skip sync

  let ok = true
  let firstRelaySyncTime = null

  for (const scope of scopes) {
    if (!runSyncCycle(root, scope)) {
      ok = false
      break
    }

    if (!firstRelaySyncTime && lastSyncByScope[scope]) {
      firstRelaySyncTime = lastSyncByScope[scope]
    }
  }

  // Keep a single "last sync" timestamp for relay cycles — the first synced scope.
  if (firstRelaySyncTime) {
    lastSyncTime = firstRelaySyncTime
  }

  return ok
}

function startScheduler(root) {
  if (schedulerInterval || schedulerTimeout) return
  schedulerTimeout = setTimeout(() => {
    schedulerTimeout = null
    runRelayCycle(root)
    schedulerInterval = setInterval(() => runRelayCycle(root), SYNC_INTERVAL_MS)
  }, getAlignedDelay())
}

// ── Route handler ──

export function createAutosyncHandler({ root, sendJson }) {
  // ── Restore persisted state on server startup ──
  const persisted = loadPersistedState(root)
  if (persisted) {
    applyPersistedState(persisted)
    reconcileBranch(root)

    // Start scheduler if any scope is enabled — reconcileBranch handles
    // pause/resume on each tick, so the scheduler runs even when paused
    if (hasAnyScopeEnabled()) {
      startScheduler(root)
    }
  }

  return async (req, res, { body, path: routePath, method }) => {
    // GET /branches — list local branches
    if (routePath === '/branches' && method === 'GET') {
      try {
        const branches = getBranches(root)
        const current = getCurrentBranch(root)
        sendJson(res, 200, { branches, current })
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // GET /status — current autosync state
    if (routePath === '/status' && method === 'GET') {
      try {
        sendJson(res, 200, buildStatusPayload(root))
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // POST /enable — enable autosync for a scope
    if (routePath === '/enable' && method === 'POST') {
      try {
        const { branch, scope } = body || {}
        if (!branch) {
          sendJson(res, 400, { error: 'branch is required' })
          return
        }
        if (!isValidBranch(branch)) {
          sendJson(res, 400, { error: 'Invalid branch name' })
          return
        }
        if (branch.toLowerCase() === 'main' || branch.toLowerCase() === 'master') {
          sendJson(res, 400, { error: 'Cannot autosync to main/master' })
          return
        }

        const currentBranch = getCurrentBranch(root)
        if (branch !== currentBranch) {
          sendJson(res, 400, {
            error: `Autosync requires you to be on the target branch. Current: ${currentBranch}, requested: ${branch}`,
          })
          return
        }

        const normalizedScope = normalizeAutosyncScope(scope)
        const hadEnabledScopes = hasAnyScopeEnabled()

        // Allow retargeting when paused on a different branch
        if (hadEnabledScopes && targetBranch !== branch) {
          if (pausedOnBranchChange) {
            // Clear pause and retarget to the new branch
            pausedOnBranchChange = false
            previousActiveBranch = null
            targetBranch = branch
            originalBranch = currentBranch
          } else {
            sendJson(res, 409, { error: `Autosync is active on ${targetBranch}. Disable all scopes before switching branch.` })
            return
          }
        }

        if (!hadEnabledScopes) {
          originalBranch = currentBranch
          targetBranch = branch
        }

        enabledScopes[normalizedScope] = true
        lastErrorByScope[normalizedScope] = null
        pausedOnBranchChange = false
        previousActiveBranch = null
        persistState(root)
        startScheduler(root)

        // Immediate first sync for the enabled scope.
        runSyncCycle(root, normalizedScope)
        sendJson(res, 200, buildStatusPayload(root))
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // POST /disable — disable one scope or all scopes
    if (routePath === '/disable' && method === 'POST') {
      try {
        const requestedScope = body?.scope
        if (requestedScope) {
          const normalizedScope = normalizeAutosyncScope(requestedScope)
          enabledScopes[normalizedScope] = false
        } else {
          enabledScopes = { canvas: false, prototype: false }
        }

        if (!hasAnyScopeEnabled()) {
          // Explicit full disable — clear persisted state entirely
          stopAutosync(root, { clearBranch: true, clearErrors: true })
          clearPersistedState(root)
        } else {
          // Partial disable — persist the remaining state
          persistState(root)
        }

        sendJson(res, 200, buildStatusPayload(root))
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    // POST /sync — manual single relay cycle
    if (routePath === '/sync' && method === 'POST') {
      try {
        if (syncing) {
          sendJson(res, 409, { error: 'Autosync is already running' })
          return
        }

        let ok = true
        if (body?.scope) {
          const scope = normalizeAutosyncScope(body.scope)
          ok = runSyncCycle(root, scope)
        } else {
          ok = runRelayCycle(root)
        }

        sendJson(res, ok ? 200 : 500, {
          ok,
          ...buildStatusPayload(root),
        })
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
      return
    }

    sendJson(res, 404, { error: `Unknown autosync route: ${method} ${routePath}` })
  }
}
