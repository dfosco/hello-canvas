import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROBE_OUTPUT_BYTES, DEFAULT_PROBE_TIMEOUT_MS, preflightHostTools, runBoundedProcess } from './preflight.js'

const AGENTS = ['codex', 'claude', 'copilot', 'opencode']

function virtualFs({ directories = [], files = [], links = {} } = {}) {
  const directorySet = new Set(directories)
  const fileSet = new Set(files)
  const resolveLink = (path) => links[path] || path
  return {
    accessSync(path) {
      if (!fileSet.has(resolveLink(path))) throw new Error('ENOENT')
    },
    realpathSync(path) {
      const resolved = resolveLink(path)
      if (!directorySet.has(resolved) && !fileSet.has(resolved)) throw new Error('ENOENT')
      return resolved
    },
    statSync(path) {
      const resolved = resolveLink(path)
      if (!directorySet.has(resolved) && !fileSet.has(resolved)) throw new Error('ENOENT')
      return {
        isDirectory: () => directorySet.has(resolved),
        isFile: () => fileSet.has(resolved),
      }
    },
  }
}

function hostFs(names, options = {}) {
  return virtualFs({
    directories: ['/host/bin'],
    files: names.map((name) => `/host/bin/${name}`),
    ...options,
  })
}

function versionRunner(overrides = {}) {
  const versions = {
    brew: 'Homebrew 4.6.0',
    node: 'v24.7.0',
    npm: '11.5.1',
    codex: 'codex-cli 1.2.3',
    claude: '2.3.4',
    copilot: '1.0.2',
    opencode: 'opencode 0.9.1',
    ...overrides,
  }
  return vi.fn(async (path) => {
    const name = path.split('/').at(-1)
    const value = versions[name]
    if (value instanceof Error) throw value
    if (value && typeof value === 'object') return value
    return value
      ? { ok: true, exitCode: 0, stdout: value, stderr: '' }
      : { ok: false, exitCode: 1, stdout: '', stderr: 'failed' }
  })
}

async function preflight({ fs, runProcess, env = {}, ...options }) {
  return preflightHostTools({
    platform: 'darwin',
    arch: 'arm64',
    env: { HOME: '/Users/test', HYPERCANVAS_HOST_PATH: '/host/bin', ...env },
    fs,
    runProcess,
    home: '/Users/test',
    ...options,
  })
}

describe('host tools preflight', () => {
  it('reports a valid Node/npm baseline and installed verified agents', async () => {
    const names = ['brew', 'node', 'npm', ...AGENTS]
    const runProcess = versionRunner()
    const result = await preflight({
      fs: hostFs(names),
      runProcess,
      env: {
        PASEO_DAEMON_URL: 'ws://127.0.0.1:45678/ws',
        PASEO_DAEMON_PASSWORD: 'daemon-password',
        PASEO_DAEMON_AUTH_HEADER: 'daemon-auth',
        PASEO_PASSWORD: 'server-password',
        HYPERCANVAS_LAUNCH_TOKEN: 'browser-token',
      },
    })

    expect(result.status).toBe('supported')
    expect(result.homebrew).toEqual({ status: 'valid', path: '/host/bin/brew', version: '4.6.0' })
    expect(result.baseline).toMatchObject({
      status: 'valid',
      node: { status: 'valid', path: '/host/bin/node', version: '24.7.0' },
      npm: { status: 'valid', path: '/host/bin/npm', version: '11.5.1', runtimeNodePath: '/host/bin/node' },
    })
    expect(Object.values(result.agents).map(({ status }) => status)).toEqual(AGENTS.map(() => 'installed'))
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.baseline.node)).toBe(true)
    expect(runProcess).toHaveBeenCalledTimes(7)
    for (const [path, args, options] of runProcess.mock.calls) {
      expect(path).toMatch(/^\/host\/bin\//)
      expect(args).toEqual(['--version'])
      expect(options).toMatchObject({
        shell: false,
        timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
        maxOutputBytes: DEFAULT_PROBE_OUTPUT_BYTES,
      })
    }
    for (const [, , options] of runProcess.mock.calls) {
      expect(options.env).not.toHaveProperty('PASEO_DAEMON_URL')
      expect(options.env).not.toHaveProperty('PASEO_DAEMON_PASSWORD')
      expect(options.env).not.toHaveProperty('PASEO_DAEMON_AUTH_HEADER')
      expect(options.env).not.toHaveProperty('PASEO_PASSWORD')
      expect(options.env).not.toHaveProperty('HYPERCANVAS_LAUNCH_TOKEN')
    }
    const npmCall = runProcess.mock.calls.find(([path]) => path.endsWith('/npm'))
    expect(npmCall[2].env.PATH.split(':')[0]).toBe('/host/bin')
  })

  it('reports missing when neither Node nor npm exists without running probes', async () => {
    const runProcess = versionRunner()
    const result = await preflight({ fs: hostFs([]), runProcess })

    expect(result.baseline.status).toBe('missing')
    expect(result.baseline.node.status).toBe('missing')
    expect(result.baseline.npm.status).toBe('missing')
    expect(result.homebrew.status).toBe('missing')
    expect(Object.values(result.agents).map(({ status }) => status)).toEqual(AGENTS.map(() => 'missing'))
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('reports an outdated baseline while preserving the detected Node and npm', async () => {
    const result = await preflight({
      fs: hostFs(['node', 'npm']),
      runProcess: versionRunner({ node: 'v20.19.0' }),
    })

    expect(result.baseline.status).toBe('outdated')
    expect(result.baseline.node.version).toBe('20.19.0')
    expect(result.baseline.npm.status).toBe('valid')
  })

  it.each([
    ['npm is missing', ['node'], {}, 'missing'],
    ['npm cannot be verified', ['node', 'npm'], { npm: { ok: false, exitCode: 2, stdout: '', stderr: 'broken' } }, 'failed_verification'],
    ['Node is missing but npm exists', ['npm'], {}, 'valid'],
  ])('reports partial when %s', async (_label, names, overrides, npmStatus) => {
    const result = await preflight({ fs: hostFs(names), runProcess: versionRunner(overrides) })

    expect(result.baseline.status).toBe('partial')
    expect(result.baseline.npm.status).toBe(npmStatus)
  })

  it('distinguishes an installed agent that fails live verification', async () => {
    const result = await preflight({
      fs: hostFs(['node', 'npm', 'claude']),
      runProcess: versionRunner({ claude: { ok: true, exitCode: 0, stdout: 'unknown', stderr: '' } }),
    })

    expect(result.agents.claude).toEqual({
      status: 'failed_verification',
      path: '/host/bin/claude',
      version: null,
      reason: 'invalid_version',
    })
  })

  it('never promotes contaminated bundle or node_modules executables', async () => {
    const fs = virtualFs({
      directories: ['/bundle', '/bundle/bin', '/project/node_modules/.bin'],
      files: ['/bundle/bin/node', '/bundle/bin/npm', '/project/node_modules/.bin/claude'],
    })
    const runProcess = versionRunner()
    const result = await preflight({
      fs,
      runProcess,
      env: {
        HYPERCANVAS_HOST_PATH: '/bundle/bin:/project/node_modules/.bin',
        HYPERCANVAS_BUNDLE_ROOT: '/bundle',
      },
    })

    expect(result.environment.entries).toEqual([])
    expect(result.baseline.status).toBe('missing')
    expect(result.agents.claude.status).toBe('missing')
    expect(runProcess).not.toHaveBeenCalled()
  })

  it.each([
    ['linux', 'arm64'],
    ['darwin', 'x64'],
  ])('fails closed on unsupported %s/%s without touching fs or processes', async (platform, arch) => {
    const fs = new Proxy({}, { get: () => { throw new Error('fs touched') } })
    const runProcess = vi.fn(() => { throw new Error('runner touched') })
    const result = await preflightHostTools({ platform, arch, env: {}, fs, runProcess })

    expect(result).toMatchObject({
      status: 'unsupported',
      support: { status: 'unsupported', platform, arch },
      baseline: { status: 'unsupported' },
    })
    expect(runProcess).not.toHaveBeenCalled()
  })
})

describe('bounded process runner', () => {
  it('spawns an absolute command without a shell and captures bounded output', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    const spawn = vi.fn(() => child)
    const resultPromise = runBoundedProcess('/host/bin/node', ['--version'], {
      env: { PATH: '/host/bin' },
      spawn,
      timeoutMs: 100,
      maxOutputBytes: 32,
    })
    child.stdout.emit('data', Buffer.from('v24.7.0\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toMatchObject({ ok: true, exitCode: 0, stdout: 'v24.7.0' })
    expect(spawn).toHaveBeenCalledWith('/host/bin/node', ['--version'], {
      env: { PATH: '/host/bin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  })

  it('kills probes that exceed the output bound', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    const resultPromise = runBoundedProcess('/host/bin/node', ['--version'], {
      spawn: () => child,
      timeoutMs: 100,
      maxOutputBytes: 4,
    })
    child.stdout.emit('data', Buffer.from('too much'))

    await expect(resultPromise).resolves.toMatchObject({ ok: false, error: 'output_limit' })
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('kills probes that exceed the time bound', async () => {
    vi.useFakeTimers()
    try {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn()
      const resultPromise = runBoundedProcess('/host/bin/node', ['--version'], {
        spawn: () => child,
        timeoutMs: 10,
      })

      await vi.advanceTimersByTimeAsync(10)
      await expect(resultPromise).resolves.toMatchObject({ ok: false, timedOut: true, error: 'timeout' })
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})
