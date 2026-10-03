import { createNotebookRuntime } from './runtime.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createFilesystemGrants } from '../system/filesystem-grants.js'
import { resolveNotebookStateDirectory } from './stateDirectory.js'

const VIRTUAL_NOTEBOOK = 'virtual:hypercanvas-notebook'
const RESOLVED_VIRTUAL_NOTEBOOK = `\0${VIRTUAL_NOTEBOOK}`
const RESOLVED_DATA_INDEX = '\0virtual:storyboard-data-index'

function devlog(message, details = {}) {
  console.debug('[devlog][notebook-runtime-plugin]', message, details)
}

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

export function shouldReloadNotebookFile(file, watchedPaths) {
  if (String(file).endsWith('.canvas.jsonl')) return false

  const separator = process.platform === 'win32' ? '\\' : '/'
  return watchedPaths.some(watchedPath => file === watchedPath || file.startsWith(`${watchedPath}${separator}`))
}

async function readBody(request) {
  let content = ''
  for await (const chunk of request) content += chunk
  return content ? JSON.parse(content) : {}
}

/**
 * Detect the active Notebook folder disappearing (deleted, moved, or renamed)
 * while the runtime keeps serving. When the folder vanishes, scan the old
 * parent directory once for a sibling folder whose manifest carries the same
 * stable notebook id — that recovers renames/moves within the same parent so
 * the client can offer to reopen it in place. Anything else is reported as
 * removed-or-renamed.
 */
export function createAvailabilityTracker() {
  let missing = null
  return function availability(status) {
    if (!status.active) return { available: false, reason: 'no-notebook' }
    let exists = false
    try { exists = fs.statSync(status.root).isDirectory() } catch { exists = false }
    if (exists) {
      if (missing?.root === status.root) missing = null
      return { available: true }
    }
    if (!missing || missing.root !== status.root) {
      missing = { root: status.root, reason: 'missing', movedTo: null }
      const id = status.notebook?.manifest?.id
      const parent = path.dirname(status.root)
      if (id) {
        try {
          for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === path.basename(status.root)) continue
            try {
              const manifest = JSON.parse(fs.readFileSync(path.join(parent, entry.name, 'hypercanvas.notebook.json'), 'utf8'))
              if (manifest?.id === id) {
                missing = { root: status.root, reason: 'moved', movedTo: path.join(parent, entry.name) }
                break
              }
            } catch { /* not a Notebook manifest */ }
          }
        } catch { /* the parent directory is gone too */ }
      }
    }
    return missing.movedTo
      ? { available: false, reason: 'moved', movedTo: missing.movedTo }
      : { available: false, reason: 'missing' }
  }
}

/**
 * Make one external content-only Notebook available to a stable Vite runtime.
 * The process itself never changes root, avoiding stale watchers and module
 * graphs caused by swapping a project-root symlink.
 */
export default function notebookRuntimePlugin({
  initialRoot = process.env.HYPERCANVAS_NOTEBOOK_ROOT,
  runtime = createNotebookRuntime({ stateDirectory: resolveNotebookStateDirectory() }),
  filesystemGrants: suppliedFilesystemGrants = null,
} = {}) {
  let initialError = null
  let server
  let filesystemGrants = suppliedFilesystemGrants
  let restartPending = false
  let restartScheduled = false
  const restartAttempts = []
  const MAX_RESTARTS = 3
  const RESTART_WINDOW_MS = 30_000
  let watchedPaths = []
  let allowedNotebookRoot = null
  const availability = createAvailabilityTracker()

  function updateNotebookWatcher() {
    if (!server?.watcher) return
    if (watchedPaths.length > 0) server.watcher.unwatch(watchedPaths)
    watchedPaths = runtime.watchPaths()
    if (watchedPaths.length > 0) server.watcher.add(watchedPaths)
  }

  function allowActiveNotebook() {
    const root = runtime.status().root
    const allowed = server?.config?.server?.fs?.allow
    if (!Array.isArray(allowed)) return
    if (allowedNotebookRoot) {
      const index = allowed.indexOf(allowedNotebookRoot)
      if (index >= 0) allowed.splice(index, 1)
    }
    allowedNotebookRoot = root
    if (root && !allowed.includes(root)) allowed.push(root)
  }

  if (initialRoot && !runtime.status().active) {
    try {
      runtime.open(initialRoot)
    } catch (error) {
      // The persistent runtime must still start so its open/restart controls
      // can recover from a missing, moved, or malformed initial Notebook.
      initialError = { code: error.code || 'NOTEBOOK_RUNTIME_ERROR', message: error.message }
    }
  }

  function reload() {
    const module = server?.moduleGraph.getModuleById(RESOLVED_VIRTUAL_NOTEBOOK)
    if (module) server.moduleGraph.invalidateModule(module)
    // The data index re-resolves HYPERCANVAS_NOTEBOOK_ROOT in load(), but
    // Vite serves its cached transform until the module is invalidated.
    const dataIndexModule = server?.moduleGraph.getModuleById(RESOLVED_DATA_INDEX)
    if (dataIndexModule) server.moduleGraph.invalidateModule(dataIndexModule)
    // Same treatment for the data-plugin-hosted notebook prototype route map
    // used by the isolated prototypes.html iframe entry.
    const prototypeRoutesModule = server?.moduleGraph.getModuleById('virtual:storyboard-notebook-prototype-routes')
    if (prototypeRoutesModule) server.moduleGraph.invalidateModule(prototypeRoutesModule)
    // A root switch is an explicit user action: the reload guard (which drops
    // full-reloads for guarded clients) must not swallow it.
    server.__hypercanvasNotebookSwitching = true
    try {
      server?.__hypercanvasNotebookRoutesReload?.()
      server?.ws.send({ type: 'full-reload' })
    } finally {
      server.__hypercanvasNotebookSwitching = false
    }
  }

  async function restart({ manual = false } = {}) {
    if (restartPending || !server) return
    const now = Date.now()
    while (restartAttempts[0] < now - RESTART_WINDOW_MS) restartAttempts.shift()
    if (manual) restartAttempts.length = 0
    if (restartAttempts.length >= MAX_RESTARTS) return false
    restartAttempts.push(now)
    restartPending = true
    devlog('Vite restart started', { manual, attempt: restartAttempts.length })
    try {
      await server.restart()
      devlog('Vite restart completed', { manual })
      return true
    } catch (error) {
      initialError = { code: 'NOTEBOOK_RUNTIME_RESTART_FAILED', message: error.message }
      const delay = [100, 500, 2000][restartAttempts.length] || 2000
      devlog('Vite restart failed', { manual, delay, message: error.message })
      setTimeout(() => { void restart() }, delay).unref?.()
      return false
    } finally {
      restartPending = false
    }
  }

  return {
    name: 'hypercanvas-notebook-runtime',
    resolveId(id) {
      if (id === VIRTUAL_NOTEBOOK) return RESOLVED_VIRTUAL_NOTEBOOK
      const prefix = `${VIRTUAL_NOTEBOOK}/`
      if (id.startsWith(prefix)) return runtime.resolve(id.slice(prefix.length))
      return null
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_NOTEBOOK) return null
      return `export default ${JSON.stringify(runtime.status())}`
    },
    configureServer(nextServer) {
      server = nextServer
      filesystemGrants ||= nextServer.__hypercanvasFilesystemGrants || createFilesystemGrants()
      allowActiveNotebook()
      updateNotebookWatcher()
      const reloadNotebook = (file = '') => {
        // Canvas state is updated in place by the data plugin's custom HMR
        // event. A competing full reload can arrive first and serve stale
        // catalog metadata, so reserve runtime reloads for Notebook structure
        // and configuration changes. Site project folders are external and
        // are not part of the Notebook watcher.
        if (shouldReloadNotebookFile(file, watchedPaths)) reload()
      }
      nextServer.watcher.on('add', reloadNotebook)
      nextServer.watcher.on('change', reloadNotebook)
      nextServer.watcher.on('unlink', reloadNotebook)
      // The api-router (registered by the earlier storyboardServer plugin)
      // proxies every unknown /_storyboard/ prefix to a standalone server that
      // does not exist, which would 502 these routes before they get here.
      // Expose the handler so the api-router can delegate notebook-runtime
      // requests after its desktop origin guard.
      const notebookMiddleware = async (request, response, next) => {
        try {
          if (request.method === 'GET' && request.url === '/status') {
            const currentStatus = runtime.status()
            sendJson(response, 200, {
              ...currentStatus,
              restarting: restartScheduled || restartPending,
              error: initialError,
              notice: currentStatus.active ? null : process.env.HYPERCANVAS_NOTEBOOK_NOTICE || null,
              availability: availability(currentStatus),
            })
            return
          }
          if (request.method === 'GET' && request.url === '/recent') {
            sendJson(response, 200, { notebooks: runtime.recent() })
            return
          }
          if (request.method === 'POST' && request.url === '/open') {
            const { root } = await readBody(request)
            devlog('API open request', { root })
            const existingRoots = [
              runtime.status().root,
              ...runtime.recent().filter(entry => entry.available).map(entry => entry.root),
            ].filter(Boolean)
            const grantedRoot = filesystemGrants.resolveDirectory(request, root, {
              purpose: 'notebook',
              allowedRoots: existingRoots,
            })
            const nextStatus = runtime.open(grantedRoot)
            initialError = null
            process.env.HYPERCANVAS_NOTEBOOK_NOTICE = ''
            process.env.HYPERCANVAS_NOTEBOOK_ROOT = nextStatus.root
            allowActiveNotebook()
            updateNotebookWatcher()
            const base = server?.config?.base || '/'
            restartScheduled = true
            sendJson(response, 200, { ...nextStatus, redirect: base, restarting: true })
            // Stateful services capture Notebook-local stores and execution
            // roots at startup. The client waits for this restart before it
            // requests lazy workspace modules from the new Vite graph.
            setTimeout(async () => {
              try {
                await restart({ manual: true })
              } finally {
                restartScheduled = false
              }
            }, 0).unref?.()
            devlog('API open response', { root: nextStatus.root })
            return
          }
          if (request.method === 'POST' && request.url === '/create') {
            const { root, title, id } = await readBody(request)
            const grantedRoot = filesystemGrants.resolveDirectory(request, root, { purpose: 'notebook' })
            const nextStatus = runtime.create(grantedRoot, { title, id })
            process.env.HYPERCANVAS_NOTEBOOK_ROOT = nextStatus.root
            initialError = null
            allowActiveNotebook()
            updateNotebookWatcher()
            restartScheduled = true
            sendJson(response, 200, { ...nextStatus, redirect: server?.config?.base || '/', restarting: true })
            setTimeout(async () => {
              try { await restart({ manual: true }) } finally { restartScheduled = false }
            }, 0).unref?.()
            return
          }
          if (request.method === 'POST' && request.url === '/close') {
            const nextStatus = runtime.close()
            process.env.HYPERCANVAS_NOTEBOOK_ROOT = ''
            updateNotebookWatcher()
            allowActiveNotebook()
            restartScheduled = true
            sendJson(response, 200, { ...nextStatus, restarting: true })
            setTimeout(async () => {
              try { await restart({ manual: true }) } finally { restartScheduled = false }
            }, 0).unref?.()
            return
          }
          if (request.method === 'POST' && request.url === '/restart') {
            // Vite owns its dependency optimizer and watcher state, so use its
            // supported restart rather than trying to recreate either in place.
             void restart({ manual: true })
            sendJson(response, 202, { restarting: true })
            return
          }
        } catch (error) {
          const status = ['FILESYSTEM_ORIGIN_NOT_ALLOWED', 'FILESYSTEM_GRANT_REQUIRED', 'FILESYSTEM_GRANT_ORIGIN_MISMATCH'].includes(error.code) ? 403 : 422
          sendJson(response, status, { error: { code: error.code || 'NOTEBOOK_RUNTIME_ERROR', message: error.message } })
          return
        }
        next()
      }
      nextServer.__hypercanvasNotebookRuntime = notebookMiddleware
      nextServer.middlewares.use('/_storyboard/notebook-runtime', notebookMiddleware)

      // A server-level error can leave Vite's watcher or optimizer unusable.
      // One serialized restart gives the persistent desktop runtime a recovery
      // path without turning ordinary request failures into restart loops.
      nextServer.httpServer?.once('error', () => {
        const delay = [100, 500, 2000][restartAttempts.length] || 2000
        setTimeout(() => { void restart() }, delay).unref?.()
      })
    },
    transformIndexHtml() {
      if (process.env.HYPERCANVAS_ENABLE_DEV_CONTROLS !== '1') return []
      return [{
        tag: 'script',
        injectTo: 'body',
        children: `(() => {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = 'Restart Vite';
          button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 12px;background:#24292f;color:#fff;border:1px solid #57606a;border-radius:6px;cursor:pointer';
          button.onclick = async () => { button.disabled = true; button.textContent = 'Restarting…'; await fetch('/_storyboard/notebook-runtime/restart', { method: 'POST' }); };
          document.body.append(button);
        })();`,
      }]
    },
  }
}
