import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/** Resolve durable Notebook-selection state without changing Core app state. */
export function resolveNotebookStateDirectory({ profile, home = os.homedir(), stateDirectory } = {}) {
  const configured = stateDirectory
    || process.env.HYPERCANVAS_NOTEBOOK_STATE_DIR
    || process.env.HYPERCANVAS_APP_STATE_DIR
  if (configured) return path.resolve(configured)

  const selectedProfile = profile
    || process.env.HYPERCANVAS_SCAFFOLD_PROFILE
    || (process.env.HYPERCANVAS_PRODUCTION_BUNDLE === '1' ? 'production' : 'development')
  const suffix = selectedProfile === 'development' ? '-dev' : ''
  return path.join(home, `.hypercanvas${suffix}`)
}
