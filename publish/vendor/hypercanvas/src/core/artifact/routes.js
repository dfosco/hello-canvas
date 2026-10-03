/**
 * Artifact HTTP routes — REST API for artifact CRUD.
 *
 * Mounted at /_storyboard/artifact/ by server-plugin.js.
 *
 * Routes:
 *   POST   /           — Create artifact
 *   PATCH  /           — Edit artifact metadata
 *   DELETE /           — Delete artifact
 *   GET    /list       — List artifacts by type
 *   GET    /schema     — Get JSON Schema for a type
 */

import { createArtifact, editArtifact, deleteArtifact, listArtifacts } from './operations.js'
import { VALID_TYPES, loadSchema } from './validate.js'
import path from 'node:path'

function notifyArtifactChange(root, files, eventType) {
  const hook = globalThis.__STORYBOARD_NOTIFY_ARTIFACT_CHANGE__
  if (typeof hook !== 'function' || !Array.isArray(files)) return
  for (const rel of files) {
    try { hook(path.resolve(root, rel), eventType) } catch { /* best-effort */ }
  }
}

export function createArtifactRoutes({ root, sendJson, deleteSite }) {
  return async function artifactHandler(req, res, ctx) {
    const { method } = ctx
    const routePath = '/' + (ctx.subpath || ctx.path || '').replace(/^\//, '')

    // GET /list?type=X
    if (method === 'GET' && routePath.startsWith('/list')) {
      const url = new URL(req.url, 'http://localhost')
      const type = url.searchParams.get('type')
      const folder = url.searchParams.get('folder')

      if (type && !VALID_TYPES.includes(type)) {
        sendJson(res, 400, { error: `Invalid type: "${type}". Valid: ${VALID_TYPES.join(', ')}` })
        return
      }

      if (type) {
        const result = listArtifacts(type, { folder }, root)
        sendJson(res, 200, result)
      } else {
        // List all types
        const results = {}
        for (const t of VALID_TYPES) {
          results[t] = listArtifacts(t, { folder }, root).items
        }
        sendJson(res, 200, { items: results })
      }
      return
    }

    // GET /schema?type=X
    if (method === 'GET' && routePath.startsWith('/schema')) {
      const url = new URL(req.url, 'http://localhost')
      const type = url.searchParams.get('type')

      if (!type || !VALID_TYPES.includes(type)) {
        sendJson(res, 400, { error: `type query param required. Valid: ${VALID_TYPES.join(', ')}` })
        return
      }

      const schema = loadSchema(type)
      if (!schema) {
        sendJson(res, 404, { error: `Schema not found for type: ${type}` })
        return
      }

      sendJson(res, 200, schema)
      return
    }

    // POST / — Create
    if (method === 'POST' && (routePath === '/' || routePath === '')) {
      const body = ctx.body
      if (!body || !body.type) {
        sendJson(res, 400, { error: 'Request body must include "type"' })
        return
      }

      const { type, ...values } = body
      const result = createArtifact(type, values, root)

      if (result.success) {
        // Force-invalidate the data index synchronously so the client's
        // immediate post-create navigation doesn't race chokidar and 404.
        notifyArtifactChange(root, result.files, 'add')
        sendJson(res, 201, result)
      } else {
        const status = result.errors?.some(e => e.message?.includes('already exists')) ? 409 : 400
        sendJson(res, status, { error: result.errors?.[0]?.message || 'Validation failed', errors: result.errors })
      }
      return
    }

    // PATCH / — Edit
    if (method === 'PATCH' && (routePath === '/' || routePath === '')) {
      const body = ctx.body
      if (!body || !body.type || !body.name) {
        sendJson(res, 400, { error: 'Request body must include "type" and "name"' })
        return
      }

      const { type, name, ...updates } = body
      const result = editArtifact(type, name, updates, root)

      if (result.success) {
        notifyArtifactChange(root, result.files, 'change')
        sendJson(res, 200, result)
      } else {
        sendJson(res, result.error?.includes('not found') ? 404 : 400, { error: result.error })
      }
      return
    }

    // DELETE / — Delete
    if (method === 'DELETE' && (routePath === '/' || routePath === '')) {
      const body = ctx.body
      if (!body || !body.type || !body.name) {
        sendJson(res, 400, { error: 'Request body must include "type" and "name"' })
        return
      }

      const { type, name, ...options } = body
      const result = type === 'site' && deleteSite
        ? await deleteSite(name, options)
        : deleteArtifact(type, name, options, root)

      if (result.success) {
        notifyArtifactChange(root, result.files, 'unlink')
        sendJson(res, 200, result)
      } else {
        const status = result.code === 'CONFIRMATION_REQUIRED' ? 409
          : result.error?.includes('not found') ? 404
            : result.code === 'UNSUPPORTED_CANVAS_LOCATION' ? 409 : 400
        sendJson(res, status, {
          error: result.error,
          ...(result.code ? { code: result.code } : {}),
          ...(result.affectedFiles ? { affectedFiles: result.affectedFiles } : {}),
          ...(result.preservedProjectRoot ? { preservedProjectRoot: result.preservedProjectRoot } : {}),
        })
      }
      return
    }

    sendJson(res, 404, { error: `Unknown artifact route: ${method} ${routePath}` })
  }
}
