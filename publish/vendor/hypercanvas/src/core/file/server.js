/**
 * File Widget Server API — read/write/list repo files.
 *
 * Mounted at /_storyboard/file/ by server-plugin.js.
 *
 * Routes:
 *   GET  /tree[?root=...]   — file tree (text files only)
 *   GET  /read?path=...     — read file contents
 *   PUT  /write             — overwrite a file
 *   POST /rename            — rename (same-dir only)
 *   POST /upload            — write into destDir (with collision suffix)
 *   GET  /exists?path=...   — check if path exists
 *   POST /resolve           — resolve absolute file paths (e.g. from VSCode
 *                             Explorer drops) to repo-relative paths,
 *                             copying images into assets/canvas/images
 *                             when not already there
 */

import fs from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { buildFileTree, isPathAllowed, GLOBAL_IGNORE_DIRS } from './tree.js'
import { isTextFile } from '../../internals/canvas/widgets/FileWidget/fileFlavor.js'
import { resolveNotebookPath } from '../notebook/runtime.js'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

/**
 * Read storyboard.config.json lazily (on each request).
 */
function readConfig(root) {
  try {
    const configPath = path.join(root, 'storyboard.config.json')
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return {}
  }
}

/**
 * Validate a repo-relative path string.
 * Returns { ok: true, absPath } or { ok: false, error }
 */
function validateRelPath(root, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { ok: false, error: 'path is required' }
  }
  if (relPath.includes('\0')) {
    return { ok: false, error: 'path contains nul byte' }
  }
  if (relPath.startsWith('/') || relPath.startsWith('\\')) {
    return { ok: false, error: 'path must be repo-relative (no leading slash)' }
  }
  if (/\\/.test(relPath)) {
    return { ok: false, error: 'path must use POSIX separators (no backslash)' }
  }
  if (relPath.split('/').some((seg) => seg === '..')) {
    return { ok: false, error: 'path traversal not allowed' }
  }

  const absPath = path.resolve(root, relPath)
  const normalRoot = path.resolve(root)
  if (!absPath.startsWith(normalRoot + path.sep) && absPath !== normalRoot) {
    return { ok: false, error: 'path resolves outside repo root' }
  }

  return { ok: true, absPath }
}

export function validateNotebookPath(root, relPath) {
  try {
    return { ok: true, absPath: resolveNotebookPath(root, relPath) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function pathIsAllowed(root, absPath, config, validatePath) {
  return validatePath === validateNotebookPath || isPathAllowed(root, absPath, config)
}

/**
 * Emit a Vite WS event signalling a file change.
 */
function emitFileChanged(viteWs, relPath) {
  if (!viteWs) return
  viteWs.send({ type: 'custom', event: 'storyboard:file-changed', data: { path: relPath } })
}

/**
 * If `filename` already exists in `dir`, append --N before the extension.
 * Returns a safe filename that does not collide.
 */
function uniqueFilename(dir, filename) {
  if (!fs.existsSync(path.join(dir, filename))) return filename
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let n = 1
  while (true) {
    const candidate = `${base}--${n}${ext}`
    if (!fs.existsSync(path.join(dir, candidate))) return candidate
    n++
  }
}

/**
 * Walk the repo (respecting the global ignore list + size cap) and look for
 * a file whose contents are byte-identical to `contentBuf`. Returns the
 * repo-relative POSIX path of the first match, or null.
 *
 * Used by /upload to avoid creating duplicate copies when the dropped file
 * is already in the repo — e.g. dragging `src/prototypes/Foo/index.jsx`
 * back onto the canvas should re-use that exact path, not write a copy to
 * the default upload dir.
 *
 * Strategy: hash the incoming bytes once, then walk the repo lazily. For
 * each candidate file (size match → hash match), return the first hit.
 * Bails out after MAX_FILES_SCANNED so a huge repo can't hang the upload.
 */
const MAX_FILES_SCANNED = 5000
function findIdenticalFile(root, contentBuf, hintBasename, config) {
  const targetSize = contentBuf.length
  const targetHash = createHash('sha1').update(contentBuf).digest('hex')

  let scanned = 0

  function walk(absDir, relBase) {
    if (scanned > MAX_FILES_SCANNED) return null
    let entries
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }) } catch { return null }

    // Prioritize same-basename matches first (massively faster for the
    // common drag-the-original-back case).
    if (hintBasename) {
      entries.sort((a, b) => {
        if (a.name === hintBasename && b.name !== hintBasename) return -1
        if (b.name === hintBasename && a.name !== hintBasename) return 1
        return 0
      })
    }

    for (const entry of entries) {
      if (GLOBAL_IGNORE_DIRS.has(entry.name)) continue
      const absPath = path.join(absDir, entry.name)
      const relPosix = relBase ? `${relBase}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        if (!isPathAllowed(root, absPath, config)) continue
        const hit = walk(absPath, relPosix)
        if (hit) return hit
      } else if (entry.isFile()) {
        if (!isPathAllowed(root, absPath, config)) continue
        try {
          const stat = fs.statSync(absPath)
          if (stat.size !== targetSize) continue
          scanned++
          const fileBuf = fs.readFileSync(absPath)
          const fileHash = createHash('sha1').update(fileBuf).digest('hex')
          if (fileHash === targetHash) return relPosix
        } catch { /* unreadable — skip */ }
        if (scanned > MAX_FILES_SCANNED) return null
      }
    }
    return null
  }

  return walk(path.resolve(root), '')
}

export function createFileHandler({ root, sendJson, validatePath = validateRelPath }) {
  return async function fileHandler(req, res, { body, path: routePath, method, __viteWs }) {
    const config = readConfig(root)

    // Strip query string for route matching — the middleware passes the full
    // path including `?...` so strict equality on `'/read'` would never match.
    const qIdx = routePath.indexOf('?')
    const matchPath = qIdx === -1 ? routePath : routePath.slice(0, qIdx)

    // ── GET /tree ───────────────────────────────────────────────────────────
    if (method === 'GET' && matchPath === '/tree') {
      const url = new URL(req.url, 'http://localhost')
      const startDir = url.searchParams.get('root') || undefined

      if (startDir) {
        const validation = validatePath(root, startDir)
        if (!validation.ok) {
          sendJson(res, 400, { error: validation.error })
          return
        }
        if (!pathIsAllowed(root, validation.absPath, config, validatePath)) {
          sendJson(res, 400, { error: 'root path not allowed' })
          return
        }
      }

      const tree = buildFileTree(root, { startDir, config })
      sendJson(res, 200, { tree })
      return
    }

    // ── GET /read?path=... ──────────────────────────────────────────────────
    if (method === 'GET' && matchPath === '/read') {
      const url = new URL(req.url, 'http://localhost')
      const relPath = url.searchParams.get('path')

      const validation = validatePath(root, relPath)
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error })
        return
      }

      if (!pathIsAllowed(root, validation.absPath, config, validatePath)) {
        sendJson(res, 400, { error: 'path not allowed' })
        return
      }

      if (!fs.existsSync(validation.absPath)) {
        sendJson(res, 404, { error: 'File not found' })
        return
      }

      const stat = fs.statSync(validation.absPath)
      if (stat.isDirectory()) {
        sendJson(res, 400, { error: 'path is a directory' })
        return
      }

      const content = fs.readFileSync(validation.absPath, 'utf-8')
      sendJson(res, 200, {
        path: relPath,
        content,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      })
      return
    }

    // ── PUT /write ──────────────────────────────────────────────────────────
    if (method === 'PUT' && matchPath === '/write') {
      const { path: relPath, content } = body || {}

      if (typeof content !== 'string') {
        sendJson(res, 400, { error: 'body.content must be a string' })
        return
      }

      const validation = validatePath(root, relPath)
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error })
        return
      }

      if (!pathIsAllowed(root, validation.absPath, config, validatePath)) {
        sendJson(res, 400, { error: 'path not allowed' })
        return
      }

      const parentDir = path.dirname(validation.absPath)
      if (!fs.existsSync(parentDir)) {
        sendJson(res, 404, { error: 'Parent directory does not exist' })
        return
      }

      fs.writeFileSync(validation.absPath, content, 'utf-8')
      const stat = fs.statSync(validation.absPath)
      emitFileChanged(__viteWs, relPath)

      sendJson(res, 200, {
        success: true,
        path: relPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      })
      return
    }

    // ── POST /rename ────────────────────────────────────────────────────────
    if (method === 'POST' && matchPath === '/rename') {
      const { from, to } = body || {}

      const fromValidation = validatePath(root, from)
      if (!fromValidation.ok) {
        sendJson(res, 400, { error: `from: ${fromValidation.error}` })
        return
      }

      const toValidation = validatePath(root, to)
      if (!toValidation.ok) {
        sendJson(res, 400, { error: `to: ${toValidation.error}` })
        return
      }

      // Same-dir-only constraint
      if (path.dirname(fromValidation.absPath) !== path.dirname(toValidation.absPath)) {
        sendJson(res, 400, { error: 'rename target must be in the same directory as the source' })
        return
      }

      if (!pathIsAllowed(root, fromValidation.absPath, config, validatePath)) {
        sendJson(res, 400, { error: 'from path not allowed' })
        return
      }

      if (!pathIsAllowed(root, toValidation.absPath, config, validatePath)) {
        sendJson(res, 400, { error: 'to path not allowed' })
        return
      }

      if (!fs.existsSync(fromValidation.absPath)) {
        sendJson(res, 404, { error: 'Source file not found' })
        return
      }

      fs.renameSync(fromValidation.absPath, toValidation.absPath)
      emitFileChanged(__viteWs, from)
      emitFileChanged(__viteWs, to)

      sendJson(res, 200, { success: true, from, to })
      return
    }

    // ── POST /upload ────────────────────────────────────────────────────────
    if (method === 'POST' && matchPath === '/upload') {
      const {
        filename,
        content,
        encoding,
        destDir: destDirRel,
        searchIdenticalFiles = true,
      } = body || {}

      if (typeof filename !== 'string' || filename.length === 0) {
        sendJson(res, 400, { error: 'body.filename is required' })
        return
      }

      if (typeof content !== 'string') {
        sendJson(res, 400, { error: 'body.content must be a string' })
        return
      }
      if (typeof searchIdenticalFiles !== 'boolean') {
        sendJson(res, 400, { error: 'body.searchIdenticalFiles must be a boolean' })
        return
      }

      // Sanitize filename — no path separators
      if (filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
        sendJson(res, 400, { error: 'filename must not contain path separators' })
        return
      }

      const defaultUploadDir = config?.fileWidget?.defaultUploadDir
        || (validatePath === validateNotebookPath ? 'assets/files' : 'src/canvas/files')
      const targetRelDir = destDirRel || defaultUploadDir

      const targetDirValidation = validatePath(root, targetRelDir)
      if (!targetDirValidation.ok) {
        sendJson(res, 400, { error: `destDir: ${targetDirValidation.error}` })
        return
      }

      if (!pathIsAllowed(root, targetDirValidation.absPath, config, validatePath)) {
        sendJson(res, 400, { error: 'destDir not allowed' })
        return
      }

      // Create destDir if it doesn't exist
      fs.mkdirSync(targetDirValidation.absPath, { recursive: true })

      const fileContent = encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : content
      const incomingBuf = Buffer.isBuffer(fileContent) ? fileContent : Buffer.from(fileContent, 'utf-8')

      // Pass 1: same-dir collision with identical contents → reuse.
      const desiredAbs = path.join(targetDirValidation.absPath, filename)
      if (fs.existsSync(desiredAbs)) {
        try {
          const existing = fs.readFileSync(desiredAbs)
          if (existing.equals(incomingBuf)) {
            const reusedRel = path.posix.join(targetRelDir, filename)
            sendJson(res, 200, { success: true, path: reusedRel, reused: true })
            return
          }
        } catch { /* fall through */ }
      }

      // Pass 2: scan the whole repo for a byte-identical file (size +
      // sha1 match). Project-tree imports opt out so each relative path
      // remains in the copied project even when its bytes exist elsewhere.
      if (searchIdenticalFiles) {
        try {
          const match = findIdenticalFile(root, incomingBuf, filename, config)
          if (match) {
            sendJson(res, 200, { success: true, path: match, reused: true })
            return
          }
        } catch { /* fall through to write */ }
      }

      // Pass 3: no match anywhere → write as a new file, suffixing on
      // basename collision in the destination dir.
      const safeFilename = uniqueFilename(targetDirValidation.absPath, filename)
      const absTarget = path.join(targetDirValidation.absPath, safeFilename)
      const relTarget = path.posix.join(targetRelDir, safeFilename)

      fs.writeFileSync(absTarget, fileContent)
      emitFileChanged(__viteWs, relTarget)

      sendJson(res, 200, { success: true, path: relTarget })
      return
    }

    // ── GET /exists?path=... ────────────────────────────────────────────────
    if (method === 'GET' && matchPath === '/exists') {
      const url = new URL(req.url, 'http://localhost')
      const relPath = url.searchParams.get('path')

      const validation = validatePath(root, relPath)
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error })
        return
      }

      if (!pathIsAllowed(root, validation.absPath, config, validatePath)) {
        sendJson(res, 200, { exists: false })
        return
      }

      sendJson(res, 200, { exists: fs.existsSync(validation.absPath) })
      return
    }

    // ── POST /resolve ───────────────────────────────────────────────────────
    // Resolve a list of absolute filesystem paths (e.g. file:// URIs from
    // VSCode Explorer drag-and-drop) into widget-creatable references.
    //
    // For each input path the response item is one of:
    //   { ok: true, kind: 'image', src: 'foo.png' }
    //     — image written to assets/canvas/images (or reused if already there)
    //   { ok: true, kind: 'file',  path: 'src/...' }
    //     — text file inside the repo, point file widget at the rel path
    //   { ok: false, reason: 'outside_repo' | 'not_found' | 'unsupported'
    //                  | 'invalid' | 'not_file', absPath }
    if (method === 'POST' && matchPath === '/resolve') {
      const { paths } = body || {}
      if (!Array.isArray(paths) || paths.length === 0) {
        sendJson(res, 400, { error: 'body.paths must be a non-empty array' })
        return
      }

      const normalRoot = (() => {
        const r = path.resolve(root)
        try { return fs.realpathSync(r) } catch { return r }
      })()
      const imagesDir = path.join(normalRoot, 'assets', 'canvas', 'images')

      const results = paths.map((p) => {
        if (typeof p !== 'string' || p.length === 0) {
          return { ok: false, reason: 'invalid', absPath: p }
        }
        if (!path.isAbsolute(p)) {
          return { ok: false, reason: 'invalid', absPath: p }
        }
        if (p.includes('\0')) {
          return { ok: false, reason: 'invalid', absPath: p }
        }

        // Resolve symlinks before the containment check so e.g. a symlink
        // inside the repo pointing OUTSIDE is correctly rejected.
        let realAbs
        try {
          realAbs = fs.realpathSync(p)
        } catch {
          return { ok: false, reason: 'not_found', absPath: p }
        }

        let stat
        try {
          stat = fs.statSync(realAbs)
        } catch {
          return { ok: false, reason: 'not_found', absPath: p }
        }
        if (!stat.isFile()) {
          return { ok: false, reason: 'not_file', absPath: p }
        }

        if (realAbs !== normalRoot && !realAbs.startsWith(normalRoot + path.sep)) {
          return { ok: false, reason: 'outside_repo', absPath: p }
        }

        const relPosix = path.relative(normalRoot, realAbs).split(path.sep).join('/')
        const base = path.basename(realAbs)
        const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''

        // Image branch — copy into assets/canvas/images unless already there.
        if (IMAGE_EXTENSIONS.has(ext)) {
          // Already inside images dir → just return the basename.
          if (realAbs === path.join(imagesDir, base) || realAbs.startsWith(imagesDir + path.sep)) {
            const sub = path.relative(imagesDir, realAbs).split(path.sep).join('/')
            return { ok: true, kind: 'image', src: sub }
          }
          try {
            fs.mkdirSync(imagesDir, { recursive: true })
            const incomingBuf = fs.readFileSync(realAbs)
            // Same-name + identical contents in imagesDir → reuse.
            const desiredAbs = path.join(imagesDir, base)
            if (fs.existsSync(desiredAbs)) {
              try {
                const existing = fs.readFileSync(desiredAbs)
                if (existing.equals(incomingBuf)) {
                  return { ok: true, kind: 'image', src: base, reused: true }
                }
              } catch { /* fall through to suffix */ }
            }
            const safeName = uniqueFilename(imagesDir, base)
            fs.writeFileSync(path.join(imagesDir, safeName), incomingBuf)
            emitFileChanged(__viteWs, `assets/canvas/images/${safeName}`)
            return { ok: true, kind: 'image', src: safeName, copied: true }
          } catch (err) {
            return { ok: false, reason: 'copy_failed', absPath: p, error: err?.message }
          }
        }

        // File widget branch — must be a flavor the widget can render and
        // must pass the same isPathAllowed gate the file tree uses (so we
        // never expose node_modules / assets / etc.).
        if (!isTextFile(base)) {
          return { ok: false, reason: 'unsupported', absPath: p, ext }
        }
        if (!isPathAllowed(normalRoot, realAbs, config)) {
          return { ok: false, reason: 'unsupported', absPath: p }
        }
        return { ok: true, kind: 'file', path: relPosix }
      })

      sendJson(res, 200, { results, repoName: path.basename(normalRoot) })
      return
    }

    sendJson(res, 404, { error: `Unknown file route: ${method} ${routePath}` })
  }
}
