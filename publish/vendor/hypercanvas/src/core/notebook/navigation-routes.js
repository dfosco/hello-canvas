import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { applyNavigationOperation } from './navigation.js'
import { inspectNotebook, NOTEBOOK_MANIFEST_FILE, notebookPaths } from './notebook.js'

const locks = new Map()

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function scopeConflict(message, state = null) {
  return Object.assign(new Error(message), { code: 'NOTEBOOK_SCOPE_CONFLICT', status: 409, state })
}

function revisionConflict(state) {
  return Object.assign(new Error('Notebook manifest changed since this layout was read.'), {
    code: 'STALE_NOTEBOOK_REVISION',
    status: 409,
    state,
  })
}

function manifestRevision(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function currentScope(runtime, request = null) {
  const status = runtime?.status?.()
  const id = status?.notebook?.manifest?.id
  const generation = status?.generation
  if (!status?.active || !status?.root || typeof id !== 'string') throw scopeConflict('There is no active Notebook.')
  if (request && (request.notebookId !== id || request.generation !== generation)) {
    throw scopeConflict('The active Notebook changed; reload its current navigation state.')
  }
  return { root: status.root, notebookId: id, generation }
}

function readState(runtime, request = null) {
  const scope = currentScope(runtime, request)
  const notebook = inspectNotebook(scope.root)
  if (notebook.status !== 'valid' || !notebook.manifest) {
    const error = new Error('The active Notebook catalog is invalid.')
    error.code = 'INVALID_NOTEBOOK'
    error.status = 422
    error.detail = notebook.diagnostics
    throw error
  }
  const manifestPath = notebookPaths(scope.root).manifest
  return {
    ...scope,
    notebook,
    revision: manifestRevision(manifestPath),
  }
}

async function withNotebookLock(key, callback) {
  const previous = locks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  locks.set(key, current)
  await previous.catch(() => {})
  try {
    return await callback()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}

async function readReconciledState(runtime) {
  const first = readState(runtime)
  if (!first.notebook.needsPageRegistration && !first.notebook.needsNavigationRepair) return first
  return withNotebookLock(first.notebookId, () => {
    const current = readState(runtime)
    if (current.notebook.needsPageRegistration || current.notebook.needsNavigationRepair) {
      atomicWriteManifest(current.root, current.notebook.manifest)
      runtime?.refreshNotebook?.()
    }
    return readState(runtime)
  })
}

function atomicWriteManifest(root, manifest) {
  const canonicalRoot = fs.realpathSync.native(root)
  const target = path.join(canonicalRoot, NOTEBOOK_MANIFEST_FILE)
  if (!isInside(canonicalRoot, target)) throw scopeConflict('Notebook manifest path is outside the active Notebook.')
  try {
    if (fs.lstatSync(target).isSymbolicLink() || !isInside(canonicalRoot, fs.realpathSync.native(target))) {
      throw scopeConflict('Notebook manifest path resolves outside the active Notebook.')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = path.join(canonicalRoot, `${NOTEBOOK_MANIFEST_FILE}.${process.pid}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporary, target)
  } finally {
    try { fs.rmSync(temporary, { force: true }) } catch { /* the atomic rename already succeeded */ }
  }
}

function sendFailure(res, sendJson, error) {
  const status = Number.isInteger(error?.status) ? error.status
    : ['INVALID_NAVIGATION_OPERATION', 'INVALID_NOTEBOOK'].includes(error?.code) ? 422 : 500
  return sendJson(res, status, {
    error: { code: error?.code || 'NOTEBOOK_NAVIGATION_FAILED', message: error?.message || 'Notebook navigation failed.' },
    ...(error?.detail ? { diagnostics: error.detail } : {}),
    ...(error?.state ? { current: error.state } : {}),
  })
}

/** Notebook-scoped page catalog and revision-guarded layout routes. */
export function createNotebookNavigationRoutes({ runtime, sendJson, eventSender = () => {} }) {
  return async function notebookNavigationRoutes(_req, res, { body = {}, path: requestPath = '/', method }) {
    try {
      const pathname = requestPath.split('?', 1)[0].replace(/\/$/, '') || '/'
      if (method === 'GET' && pathname === '/pages') {
        const state = await readReconciledState(runtime)
        return sendJson(res, 200, {
          title: state.notebook.manifest.title || 'Notebook',
          notebookId: state.notebookId,
          generation: state.generation,
          revision: state.revision,
          pages: state.notebook.pages,
          diagnostics: state.notebook.diagnostics,
        })
      }
      if (method === 'GET' && pathname === '/navigation') {
        const state = await readReconciledState(runtime)
        return sendJson(res, 200, {
          title: state.notebook.manifest.title || 'Notebook',
          notebookId: state.notebookId,
          generation: state.generation,
          revision: state.revision,
          navigation: state.notebook.manifest.navigation,
          diagnostics: state.notebook.diagnostics,
        })
      }
      if (method === 'POST' && pathname === '/navigation') {
        if (typeof body.notebookId !== 'string' || !Number.isInteger(body.generation)
          || typeof body.expectedRevision !== 'string' || !body.operation) {
          return sendJson(res, 400, { error: { code: 'INVALID_NAVIGATION_REQUEST', message: 'notebookId, generation, expectedRevision, and operation are required.' } })
        }
        const committed = await withNotebookLock(body.notebookId, () => {
          const current = readState(runtime, body)
          if (current.revision !== body.expectedRevision) throw revisionConflict(current)
          const navigation = applyNavigationOperation(current.notebook.manifest.navigation, current.notebook.pages, body.operation)
          const beforeWrite = readState(runtime, body)
          if (beforeWrite.revision !== body.expectedRevision) throw revisionConflict(beforeWrite)
          const nextManifest = { ...beforeWrite.notebook.manifest, navigation }
          atomicWriteManifest(beforeWrite.root, nextManifest)
          const updated = readState(runtime, body)
          runtime?.refreshNotebook?.()
          try {
            eventSender({
              type: 'custom',
              event: 'storyboard:notebook-layout-updated',
              data: { notebookId: updated.notebookId, generation: updated.generation, revision: updated.revision, navigation },
            })
          } catch { /* persistence succeeds even if a connected client cannot be notified */ }
          return updated
        })
        return sendJson(res, 200, {
          notebookId: committed.notebookId,
          generation: committed.generation,
          revision: committed.revision,
          navigation: committed.notebook.manifest.navigation,
        })
      }
      return sendJson(res, 404, { error: { code: 'ROUTE_NOT_FOUND', message: `Unknown Notebook navigation route: ${method} ${pathname}` } })
    } catch (error) {
      return sendFailure(res, sendJson, error)
    }
  }
}

export const __test = { atomicWriteManifest, manifestRevision, withNotebookLock }
