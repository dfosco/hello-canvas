/**
 * Docs API — serve README and source files for the docs viewer.
 *
 * Routes (mounted at /_storyboard/docs/):
 *   GET /readme          — project README.md content
 *   GET /source?path=... — single source file (restricted to src/)
 *   GET /files           — tree of component files in src/prototypes/
 *   GET /repo            — repository owner/name (from git remote or config)
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md']
const SOURCE_EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect files matching allowed extensions.
 * @param {string} dir - Absolute directory path
 * @param {string} rootDir - Project root for computing relative paths
 * @returns {Promise<string[]>} Relative file paths from project root
 */
export async function collectFiles(dir, rootDir) {
  /** @type {string[]} */
  const results = []

  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectFiles(full, rootDir)
      results.push(...nested)
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(path.relative(rootDir, full))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Create the docs API route handler.
 * @param {object} ctx
 * @param {string} ctx.root - Project root directory
 * @param {(res: import('http').ServerResponse, status: number, data: unknown) => void} ctx.sendJson
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse, opts: { path: string, method: string }) => Promise<void>}
 */
export function docsHandler({ root, sendJson }) {
  return async (req, res, { path: routePath, method }) => {
    // --- GET /readme ---
    if (routePath === '/readme' && method === 'GET') {
      for (const candidate of README_CANDIDATES) {
        const filePath = path.join(root, candidate)
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8')
          sendJson(res, 200, { content, path: candidate })
          return
        } catch {
          // try next candidate
        }
      }
      sendJson(res, 404, { error: 'README.md not found' })
      return
    }

    // --- GET /source?path=... ---
    if (routePath.startsWith('/source') && method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const filePath = url.searchParams.get('path')

      if (!filePath) {
        sendJson(res, 400, { error: 'Missing "path" query parameter' })
        return
      }

      const resolved = path.resolve(root, filePath)

      // Security: must stay within project root
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        sendJson(res, 403, { error: 'Path traversal not allowed' })
        return
      }

      // Security: only allow files within src/
      const relative = path.relative(root, resolved)
      if (!relative.startsWith('src' + path.sep)) {
        sendJson(res, 403, { error: 'Only files within src/ are accessible' })
        return
      }

      try {
        const content = await fs.promises.readFile(resolved, 'utf-8')
        sendJson(res, 200, { content, path: relative })
      } catch {
        sendJson(res, 404, { error: `File not found: ${relative}` })
      }
      return
    }

    // --- GET /files ---
    if (routePath === '/files' && method === 'GET') {
      const prototypesDir = path.join(root, 'src', 'prototypes')
      const files = await collectFiles(prototypesDir, root)
      sendJson(res, 200, { files: files.sort() })
      return
    }

    // --- GET /repo ---
    if (routePath === '/repo' && method === 'GET') {
      // Try git remote first (most accurate)
      try {
        const remote = execSync('git remote get-url origin', { cwd: root, encoding: 'utf-8' }).trim()
        const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
        if (match) {
          sendJson(res, 200, { owner: match[1], name: match[2] })
          return
        }
      } catch { /* no git or no remote */ }

      // Fall back to storyboard.config.json
      const configPath = path.join(root, 'storyboard.config.json')
      try {
        const raw = await fs.promises.readFile(configPath, 'utf-8')
        const config = JSON.parse(raw)
        if (config.repository?.owner && config.repository?.name) {
          sendJson(res, 200, {
            owner: config.repository.owner,
            name: config.repository.name,
          })
          return
        }
      } catch { /* repository config not available */ }

      sendJson(res, 404, { error: 'Could not determine repository' })
      return
    }

    sendJson(res, 404, { error: `Unknown route: ${method} ${routePath}` })
  }
}
