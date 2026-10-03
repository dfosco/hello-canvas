import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { globSync } from 'glob'

const VIRTUAL_ID = 'virtual:hypercanvas-notebook-routes'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

function routeFiles(root, pattern) {
  return globSync(pattern, {
    cwd: root,
    absolute: true,
    ignore: ['**/_*.{jsx,tsx,mdx}'],
  }).filter((file) => fs.statSync(file).isFile())
}

function moduleMap(root, pattern) {
  const modalOnly = pattern === 'modals'
  return routeFiles(root, 'prototypes/**/*.{jsx,tsx,mdx}').filter((file) => {
    const name = path.basename(file)
    return modalOnly ? name.startsWith('+') : !name.startsWith('+')
  }).flatMap((file) => {
    const relative = path.relative(root, file).replaceAll(path.sep, '/')
    const keys = path.basename(file).startsWith('index.') ? declaredRouteKeys(path.dirname(file), relative) : [`/src/${relative}`]
    return keys.map(key => `${JSON.stringify(key)}: () => import(${JSON.stringify(file)})`)
  }).join(',\n')
}

function declaredRouteKeys(directory, relative) {
  const flowFiles = globSync('*.flow.json', { cwd: directory, absolute: true })
  const routes = flowFiles.map(file => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).route } catch { return null }
  }).filter(route => typeof route === 'string' && route.trim())
  if (routes.length === 0) return [`/src/${relative}`]
  return [...new Set(routes.map(route => `/src/prototypes/${route.replace(/^\/+/, '').replace(/\/+$/, '')}/index.jsx`))]
}

/**
 * Build the source of the notebook prototype route map for a given root.
 *
 * Shared by `notebookRoutesPlugin` (which owns `virtual:hypercanvas-notebook-routes`
 * for the canvas SPA) and the storyboard data plugin (which serves the same map
 * under `virtual:storyboard-notebook-prototype-routes` so the library's isolated
 * iframe entry — `prototypes.html` — can route to Notebook prototypes too; the
 * data plugin is registered by every consumer config, the routes plugin only by
 * notebook-runtime ones).
 */
export function notebookPrototypeRouteSource(root) {
  const notebookRoot = root && fs.existsSync(path.join(root, 'prototypes')) ? root : null
  return `export const PROTOTYPE_ROUTES = {${notebookRoot ? `\n${moduleMap(notebookRoot, 'routes')}` : ''}\n}\nexport const PROTOTYPE_MODALS = {${notebookRoot ? `\n${moduleMap(notebookRoot, 'modals')}` : ''}\n}`
}

export default function notebookRoutesPlugin({ runtime = null } = {}) {
  let server

  const activeRoot = () => runtime?.status().root
    || (process.env.HYPERCANVAS_NOTEBOOK_ROOT ? path.resolve(process.env.HYPERCANVAS_NOTEBOOK_ROOT) : null)

  function invalidate() {
    const module = server?.moduleGraph.getModuleById(RESOLVED_ID)
    if (module) server.moduleGraph.invalidateModule(module)
    server?.ws.send({ type: 'full-reload' })
  }
  return {
    name: 'hypercanvas-notebook-routes',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      return notebookPrototypeRouteSource(activeRoot())
    },
    configureServer(nextServer) {
      server = nextServer
      // The runtime plugin calls this when the active Notebook changes. A
      // watcher event is not emitted for an environment-root switch, so the
      // virtual route index must be invalidated explicitly.
      nextServer.__hypercanvasNotebookRoutesReload = invalidate
      const update = (file = '') => {
        const root = activeRoot()
        if (!root || !file.startsWith(root)) return
        if (file.includes(`${path.sep}prototypes${path.sep}`)) invalidate()
      }
      nextServer.watcher.on('add', update)
      nextServer.watcher.on('change', update)
      nextServer.watcher.on('unlink', update)
    },
  }
}
