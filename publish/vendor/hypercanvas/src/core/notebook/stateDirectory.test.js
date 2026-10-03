import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { resolveNotebookStateDirectory } from './stateDirectory.js'

afterEach(() => vi.unstubAllEnvs())

describe('Notebook state directory', () => {
  it('uses separate profile defaults for development and production', () => {
    vi.stubEnv('HYPERCANVAS_NOTEBOOK_STATE_DIR', '')
    vi.stubEnv('HYPERCANVAS_APP_STATE_DIR', '')
    vi.stubEnv('HYPERCANVAS_SCAFFOLD_PROFILE', '')
    vi.stubEnv('HYPERCANVAS_PRODUCTION_BUNDLE', '')
    const home = path.join(path.sep, 'users', 'test')

    expect(resolveNotebookStateDirectory({ profile: 'development', home })).toBe(path.join(home, '.hypercanvas-dev'))
    expect(resolveNotebookStateDirectory({ profile: 'production', home })).toBe(path.join(home, '.hypercanvas'))
  })

  it('prefers explicit Notebook state, then the shared application state directory', () => {
    const home = path.join(path.sep, 'users', 'test')
    vi.stubEnv('HYPERCANVAS_SCAFFOLD_PROFILE', '')
    vi.stubEnv('HYPERCANVAS_NOTEBOOK_STATE_DIR', '/notebook-state')
    vi.stubEnv('HYPERCANVAS_APP_STATE_DIR', '/app-state')

    expect(resolveNotebookStateDirectory({ profile: 'development', home })).toBe('/notebook-state')
    vi.stubEnv('HYPERCANVAS_NOTEBOOK_STATE_DIR', '')
    expect(resolveNotebookStateDirectory({ profile: 'development', home })).toBe('/app-state')
  })
})
