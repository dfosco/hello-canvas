import fs from 'node:fs'
import path from 'node:path'

export function resolveNotebookRoot(explicitRoot = null) {
  const candidate = explicitRoot
    || process.env.STORYBOARD_PROJECT_ROOT
    || process.env.HYPERCANVAS_NOTEBOOK_ROOT
    || process.cwd()
  const root = path.resolve(candidate)
  if (!fs.existsSync(path.join(root, 'hypercanvas.notebook.json'))) {
    const error = new Error('No active Notebook is available for this operation.')
    error.code = 'NO_ACTIVE_NOTEBOOK'
    throw error
  }
  return fs.realpathSync.native(root)
}

export function resolveApplicationRoot() {
  return path.resolve(process.env.HYPERCANVAS_APPLICATION_ROOT || process.cwd())
}
