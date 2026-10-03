/**
 * Resolve the dev server URL for the current worktree.
 *
 * Service URL is injected by the Hypercanvas app or terminal/agent session.
 * CLI commands never infer a service from a worktree name or raw port.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
export function getServerUrl() {
  const serviceUrl = process.env.HYPERCANVAS_SERVER_URL || process.env.STORYBOARD_SERVER_URL
  if (!serviceUrl) {
    const error = new Error('Hypercanvas service URL is not configured. Set HYPERCANVAS_SERVER_URL or run this command from a Hypercanvas-managed session.')
    error.code = 'HYPERCANVAS_SERVICE_URL_REQUIRED'
    throw error
  }
  return serviceUrl.replace(/\/$/, '')
}

/**
 * Resolve the Vite base path used to serve the app. Priority:
 *   1. `VITE_BASE_PATH` env var (matches vite.config.js convention)
 *   2. `basePath` key in storyboard.config.json
 *   3. `/` (Vite default)
 *
 * Always returns a path starting and ending with `/`.
 */
export function resolveBasePath(cwd = process.cwd()) {
  let base = process.env.VITE_BASE_PATH || null
  if (!base) {
    try {
      const cfg = JSON.parse(readFileSync(resolve(cwd, 'storyboard.config.json'), 'utf8'))
      if (typeof cfg.basePath === 'string' && cfg.basePath) base = cfg.basePath
    } catch { /* empty */ }
  }
  base = base || '/'
  if (!base.startsWith('/')) base = '/' + base
  if (!base.endsWith('/')) base = base + '/'
  return base
}
