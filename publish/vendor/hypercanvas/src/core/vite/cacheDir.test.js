// @vitest-environment node
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import configFactory from '../../../../../vite.config.js'

const envKey = 'STORYBOARD_VITE_CACHE_DIR'
const callConfig = () => configFactory({ command: 'serve', mode: 'development' })

afterEach(() => {
  delete process.env[envKey]
})

describe('vite cacheDir wiring', () => {
  it('resolves cacheDir from STORYBOARD_VITE_CACHE_DIR when set', () => {
    process.env[envKey] = '/tmp/hypercanvas-cache-probe'
    expect(callConfig().cacheDir).toBe(path.resolve('/tmp/hypercanvas-cache-probe'))
  })

  it('leaves cacheDir undefined so vite keeps its default when unset', () => {
    delete process.env[envKey]
    expect(callConfig().cacheDir).toBeUndefined()
  })
})

describe('external Notebook config', () => {
  it('loads Vite config when the Notebook has no application-level storyboard config', () => {
    const root = path.resolve('fixtures/notebooks/empty-notebook')
    expect(() => execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import(${JSON.stringify(new URL('../../../../../vite.config.js', import.meta.url).href)} + '?external-notebook-test')`,
    ], {
      cwd: path.resolve('.'),
      env: { ...process.env, HYPERCANVAS_NOTEBOOK_ROOT: root },
      stdio: 'pipe',
    })).not.toThrow()
  })
})
