/**
 * Dev Logger — structured JSONL logging for storyboard dev server errors.
 *
 * Writes one JSONL file per day to `.storyboard/logs/{YYYY-MM-DD}.jsonl`.
 * Automatically enriches log entries with context extracted from request URLs
 * (canvas name, prototype, page, etc.).
 *
 * Usage:
 *   import { createDevLogger } from './logger/devLogger.js'
 *   const logger = createDevLogger({ root, devDomain, branch })
 *   logger.logResponse({ status: 404, method: 'GET', url: '/...', route: 'canvas', error: '...' })
 *   logger.logEvent('warn', 'Something happened', { extra: 'context' })
 */

import fs from 'node:fs'
import path from 'node:path'

const LOGS_DIR_NAME = 'logs'
const STORYBOARD_DIR = '.storyboard'
const MAX_AGE_DAYS = 7

/**
 * Format a Date as YYYY-MM-DD.
 */
function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

/**
 * Extract contextual metadata from a request URL.
 * Parses query params and path segments to find canvas, prototype, and page.
 */
function extractContext(url) {
  const ctx = { canvas: null, prototype: null, page: null }
  if (!url) return ctx

  try {
    const parsed = new URL(url, 'http://localhost')
    const params = parsed.searchParams

    // Canvas name from ?name= query param (used by canvas CRUD routes)
    if (params.has('name')) ctx.canvas = params.get('name')

    // Prototype from path: /PrototypeName/... or ?prototype=
    if (params.has('prototype')) ctx.prototype = params.get('prototype')

    // Page from path segments or ?page=
    if (params.has('page')) ctx.page = params.get('page')

    // Infer from path: /_storyboard/canvas/... → canvas route
    const pathname = parsed.pathname
    if (!ctx.canvas && pathname.includes('/canvas/')) {
      const segments = pathname.split('/').filter(Boolean)
      const canvasIdx = segments.indexOf('canvas')
      if (canvasIdx >= 0 && segments[canvasIdx + 1]) {
        const sub = segments[canvasIdx + 1]
        // Skip known sub-routes
        if (!['read', 'list', 'update', 'widget', 'create', 'folders',
              'connector', 'stories', 'create-story', 'github', 'image',
              'images', 'terminal-buffer', 'terminal-snapshot',
              'rename-page', 'reorder-pages', 'page-order',
              'update-folder-meta', 'duplicate', 'image-proxy'].includes(sub)) {
          ctx.canvas = sub
        }
      }
    }
  } catch {
    // URL parsing failed — return empty context
  }

  return ctx
}

/**
 * Prune log files older than MAX_AGE_DAYS.
 */
function pruneOldLogs(logsDir) {
  try {
    const files = fs.readdirSync(logsDir)
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const dateStr = file.replace('.jsonl', '')
      const fileDate = new Date(dateStr + 'T00:00:00Z')
      if (isNaN(fileDate.getTime())) continue
      if (fileDate.getTime() < cutoff) {
        try {
          fs.unlinkSync(path.join(logsDir, file))
        } catch { /* best-effort */ }
      }
    }
  } catch {
    // Directory might not exist yet — that's fine
  }
}

/**
 * Create a dev logger instance.
 *
 * @param {object} opts
 * @param {string} opts.root — project root directory
 * @param {string} [opts.devDomain] — dev domain from config (e.g. "storyboard-core")
 * @param {string} [opts.branch] — current git branch
 * @param {boolean} [opts.verbose] — also log to console (controlled by dev-logs flag)
 * @returns {{ logResponse: Function, logEvent: Function, logsDir: string }}
 */
export function createDevLogger({ root, devDomain = null, branch = null, verbose = false } = {}) {
  const logsDir = path.join(root, STORYBOARD_DIR, LOGS_DIR_NAME)
  let dirEnsured = false

  function ensureDir() {
    if (dirEnsured) return true
    try {
      fs.mkdirSync(logsDir, { recursive: true })
      dirEnsured = true
      return true
    } catch {
      return false
    }
  }

  // Prune old logs on startup (non-blocking, best-effort)
  try { pruneOldLogs(logsDir) } catch { /* ignore */ }

  function writeEntry(entry) {
    if (!ensureDir()) return
    const filename = `${dateStamp()}.jsonl`
    const filepath = path.join(logsDir, filename)
    const line = JSON.stringify(entry) + '\n'

    try {
      fs.appendFileSync(filepath, line, 'utf-8')
    } catch {
      // If we can't write logs, fail silently — never crash the server
    }

    if (verbose) {
      const tag = entry.status ? `[${entry.status}]` : `[${entry.level}]`
      const msg = entry.error || entry.message || ''
      console.warn(`[storyboard-logs] ${tag} ${entry.method || ''} ${entry.url || ''} — ${msg}`)
    }
  }

  /**
   * Log an HTTP error response (4xx/5xx).
   *
   * @param {object} opts
   * @param {number} opts.status — HTTP status code
   * @param {string} opts.method — HTTP method (GET, POST, etc.)
   * @param {string} opts.url — full request URL
   * @param {string} [opts.route] — top-level route prefix (e.g. "canvas", "workshop")
   * @param {string} [opts.subRoute] — sub-route path after prefix
   * @param {string} [opts.error] — error message from the response body
   * @param {object} [opts.context] — additional context (overrides auto-extracted)
   */
  function logResponse({ status, method, url, route = null, subRoute = null, error = null, context = {} }) {
    if (status < 400) return

    const autoContext = extractContext(url)
    const mergedContext = { ...autoContext, ...context }

    // Strip null values from context
    for (const key of Object.keys(mergedContext)) {
      if (mergedContext[key] == null) delete mergedContext[key]
    }

    const entry = {
      ts: new Date().toISOString(),
      level: status >= 500 ? 'error' : 'warn',
      status,
      method: method || 'UNKNOWN',
      url: url || '',
      route: route || null,
      subRoute: subRoute || null,
      error: error || null,
      devDomain: devDomain || null,
      branch: branch || null,
    }

    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext
    }

    writeEntry(entry)
  }

  /**
   * Log a general event (not tied to an HTTP response).
   *
   * @param {'info'|'warn'|'error'} level
   * @param {string} message
   * @param {object} [context] — arbitrary context data
   */
  function logEvent(level, message, context = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      devDomain: devDomain || null,
      branch: branch || null,
    }
    if (Object.keys(context).length > 0) {
      entry.context = context
    }
    writeEntry(entry)
  }

  return { logResponse, logEvent, logsDir, _extractContext: extractContext }
}

// ─── Module-level singleton ───
// Set once by server-plugin.js, then any server-side module can call devLog().

let _instance = null

/**
 * Register the global dev logger instance.
 * Called once during server startup (server-plugin.js configureServer).
 */
export function setDevLogger(logger) {
  _instance = logger
}

/**
 * Get the global dev logger. Returns a no-op logger if not yet initialized.
 * Safe to call from any server-side module without constructor plumbing.
 */
export function devLog() {
  return _instance || _noop
}

const _noop = {
  logResponse() {},
  logEvent() {},
}

export { extractContext, pruneOldLogs, dateStamp }
