import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  verifyDevServer,
  verifyProductionBuild,
  verifyWorkflowReadiness,
} from './readiness.js'

function childThatEmits(event) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => queueMicrotask(() => child.emit('exit', 0)))
  queueMicrotask(() => {
    child.stdout.emit('data', `${JSON.stringify({ source: 'storyboard-dev', ...event })}\n`)
  })
  return child
}

describe('workflow readiness', () => {
  it('fails the production build on a non-zero exit', () => {
    expect(() => verifyProductionBuild('/repo', {
      run: () => ({ status: 2 }),
    })).toThrow('Production build failed with exit code 2')
  })

  it('requires a dev-server ready event', async () => {
    const child = childThatEmits({ event: 'ready', url: 'http://127.0.0.1:4123/' })
    const start = vi.fn(() => child)
    await expect(verifyDevServer('/repo', { start, timeoutMs: 100 })).resolves.toBeUndefined()
    expect(start.mock.calls[0][2].env.HYPERCANVAS_PROXY_PORT).toBe('0')
    expect(start.mock.calls[0][2].env.HYPERCANVAS_PASEO_ISOLATED).toBe('1')
    expect(start.mock.calls[0][2].env.HYPERCANVAS_APP_STATE_DIR).toMatch(/hypercanvas-readiness-/)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('rejects a dev-server error event', async () => {
    const child = childThatEmits({ event: 'error', message: 'Vite failed' })
    await expect(verifyDevServer('/repo', { start: () => child, timeoutMs: 100 })).rejects.toThrow('Vite failed')
  })

  it('does not start the dev server when the build fails', async () => {
    const devServer = vi.fn()
    await expect(verifyWorkflowReadiness('/repo', {
      build: () => { throw new Error('build failed') },
      devServer,
    })).rejects.toThrow('build failed')
    expect(devServer).not.toHaveBeenCalled()
  })

  it('does not report readiness when dev-server startup fails', async () => {
    const build = vi.fn()
    await expect(verifyWorkflowReadiness('/repo', {
      build,
      devServer: () => Promise.reject(new Error('server failed')),
    })).rejects.toThrow('server failed')
    expect(build).toHaveBeenCalledWith('/repo')
  })
})
