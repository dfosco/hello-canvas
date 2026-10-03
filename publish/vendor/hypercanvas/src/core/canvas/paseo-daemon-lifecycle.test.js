import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUNDLED_PASEO_VERSION, startDesktopPaseo } from './paseo-daemon-lifecycle.js'
import { DEFAULT_PASEO_DAEMON_URL } from './paseo-runtime-client.js'

const mocks = vi.hoisted(() => ({ createPaseoConnection: vi.fn() }))
vi.mock('./paseo-runtime-client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createPaseoConnection: mocks.createPaseoConnection }
})

const temporary = []
function stateDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paseo-lifecycle-'))
  temporary.push(root)
  return root
}
afterEach(() => {
  temporary.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }))
  mocks.createPaseoConnection.mockReset()
})

function managedChild() {
  const child = new EventEmitter()
  child.killedWith = []
  child.kill = signal => {
    child.killedWith.push(signal)
    if (signal === 'SIGTERM') setTimeout(() => child.emit('exit', 0), 0)
    return true
  }
  return child
}

function protocolConnection({ version = BUNDLED_PASEO_VERSION, serverId = 'paseo-server' } = {}) {
  return {
    client: { workspaces: { list: vi.fn().mockResolvedValue({ entries: [] }) } },
    daemon: { getLastServerInfoMessage: () => ({ version, serverId }) },
    close: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Core Paseo daemon ownership', () => {
  it('probes and reuses a compatible daemon through the pinned SDK contract', async () => {
    const connection = protocolConnection()
    mocks.createPaseoConnection.mockResolvedValue(connection)
    const launch = vi.fn()

    const runtime = await startDesktopPaseo({ stateDir: stateDirectory(), launch })

    expect(runtime).toMatchObject({ owned: false, serverId: 'paseo-server', child: null })
    expect(mocks.createPaseoConnection).toHaveBeenCalledWith(expect.objectContaining({
      url: DEFAULT_PASEO_DAEMON_URL,
      env: {},
      connectTimeoutMs: 1500,
      reconnect: { enabled: false },
    }))
    expect(connection.client.workspaces.list).toHaveBeenCalledWith({})
    expect(connection.close).toHaveBeenCalledOnce()
    expect(launch).not.toHaveBeenCalled()
  })

  it('reuses the Paseo desktop 0.9 daemon so Sites appear in its workspaces', async () => {
    const connection = protocolConnection({ version: '0.9.2' })
    mocks.createPaseoConnection.mockResolvedValue(connection)
    const launch = vi.fn()

    const runtime = await startDesktopPaseo({ stateDir: stateDirectory(), launch })

    expect(runtime).toMatchObject({ owned: false, serverId: 'paseo-server' })
    expect(connection.client.workspaces.list).toHaveBeenCalledWith({})
    expect(launch).not.toHaveBeenCalled()
  })

  it('reuses the Paseo desktop 0.10 daemon so the Notebook workspace appears in the Paseo app', async () => {
    const connection = protocolConnection({ version: '0.10.2' })
    mocks.createPaseoConnection.mockResolvedValue(connection)
    const launch = vi.fn()

    const runtime = await startDesktopPaseo({ stateDir: stateDirectory(), launch })

    expect(runtime).toMatchObject({ owned: false, serverId: 'paseo-server' })
    expect(launch).not.toHaveBeenCalled()
  })

  it.each(['0.8.0', '0.11.0', '1.0.0'])('does not reject workspace-compatible App version %s because of the bundled version pin', async version => {
    const connection = protocolConnection({ version })
    mocks.createPaseoConnection.mockResolvedValue(connection)
    const launch = vi.fn()
    const runtime = await startDesktopPaseo({ stateDir: stateDirectory(), env: {}, launch })
    expect(runtime).toMatchObject({ owned: false, usePaseoApp: true, serverId: 'paseo-server' })
    expect(launch).not.toHaveBeenCalled()
  })

  it('always launches private when usePaseoApp is false, even with explicit App settings', async () => {
    const child = managedChild()
    const connect = vi.fn().mockResolvedValue('private-server')
    const launch = vi.fn().mockReturnValue(child)
    const runtime = await startDesktopPaseo({
      stateDir: stateDirectory(), usePaseoApp: false,
      env: { PASEO_DAEMON_URL: 'ws://app/ws', PASEO_DAEMON_PASSWORD: 'app-password', PASEO_DAEMON_AUTH_HEADER: 'app-header' },
      connect, launch, selectPort: async () => 45683,
      resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
    })
    expect(runtime).toMatchObject({ owned: true, usePaseoApp: false, reuseProbeFailure: null })
    expect(connect).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith(runtime.url, runtime.connectionOptions.password)
    const daemonEnv = launch.mock.calls[0][2].env
    expect(daemonEnv.PASEO_DAEMON_URL).toBeUndefined()
    expect(daemonEnv.PASEO_DAEMON_PASSWORD).toBeUndefined()
    expect(daemonEnv.PASEO_DAEMON_AUTH_HEADER).toBeUndefined()
    await runtime.stop()
  })

  it('does not switch to the App or reprobe after starting private', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error('App is not running')).mockResolvedValue('private-server')
    const runtime = await startDesktopPaseo({
      stateDir: stateDirectory(), env: {}, connect,
      launch: vi.fn().mockReturnValue(managedChild()), selectPort: async () => 45684,
      resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
    })
    expect(runtime).toMatchObject({ owned: true, usePaseoApp: true, reuseProbeFailure: 'App is not running' })
    expect(connect).toHaveBeenCalledTimes(2)
    await runtime.stop()
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('redacts endpoint data in fallback diagnostics', async () => {
    const url = 'ws://127.0.0.1:6767/ws?token=not-public'
    const connect = vi.fn().mockRejectedValueOnce(new Error(`Could not connect to ${url}`)).mockResolvedValue('private-server')
    const runtime = await startDesktopPaseo({
      stateDir: stateDirectory(), env: {}, defaultUrl: url, connect,
      launch: vi.fn().mockReturnValue(managedChild()), selectPort: async () => 45685,
      resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
    })
    expect(runtime.reuseProbeFailure).toBe('Could not connect to [redacted]')
    await runtime.stop()
  })

  it('does not reuse a daemon when the workspace capability probe fails', async () => {
    const app = protocolConnection({ version: '0.10.2' })
    app.client.workspaces.list.mockRejectedValue(new Error('unsupported workspace request'))
    mocks.createPaseoConnection.mockResolvedValueOnce(app).mockResolvedValueOnce(protocolConnection())
    const runtime = await startDesktopPaseo({
      stateDir: stateDirectory(), env: {}, launch: vi.fn().mockReturnValue(managedChild()),
      selectPort: async () => 45686, resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
    })
    expect(runtime).toMatchObject({ owned: true, reuseProbeFailure: 'unsupported workspace request' })
    expect(app.close).toHaveBeenCalledOnce()
    await runtime.stop()
  })

  it('can deliberately isolate the packaged fallback for qualification', async () => {
    const launch = vi.fn().mockReturnValue(managedChild())
    const connect = vi.fn().mockResolvedValue('owned-server')
    const runtime = await startDesktopPaseo({
      stateDir: stateDirectory(), env: { HYPERCANVAS_PASEO_ISOLATED: '1' }, connect, launch,
      selectPort: async () => 45682, resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
    })
    expect(runtime.owned).toBe(true)
    expect(connect).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith(runtime.url, expect.any(String))
    await runtime.stop()
  })

  it('reuses a compatible default daemon without claiming or stopping it', async () => {
    const connect = vi.fn().mockResolvedValue('external-server')
    const launch = vi.fn()
    const runtime = await startDesktopPaseo({ stateDir: stateDirectory(), connect, launch })

    expect(runtime).toMatchObject({ owned: false, url: DEFAULT_PASEO_DAEMON_URL, serverId: 'external-server', child: null })
    expect(launch).not.toHaveBeenCalled()
    await runtime.stop()
    expect(launch).not.toHaveBeenCalled()
  })

  it('falls back from an incompatible default daemon to the bundled version', async () => {
    const incompatible = protocolConnection({ version: '0.7.0' })
    const bundled = protocolConnection({ serverId: 'bundled-server' })
    mocks.createPaseoConnection
      .mockResolvedValueOnce(incompatible)
      .mockResolvedValueOnce(bundled)
    const child = managedChild()
    const launch = vi.fn().mockReturnValue(child)

    const runtime = await startDesktopPaseo({
      stateDir: stateDirectory(),
      env: {},
      launch,
      selectPort: async () => 45681,
      resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
    })

    expect(runtime).toMatchObject({ owned: true, serverId: 'bundled-server', url: 'ws://127.0.0.1:45681/ws' })
    expect(incompatible.close).toHaveBeenCalledOnce()
    expect(bundled.close).toHaveBeenCalledOnce()
    await runtime.stop()
  })

  it('does not silently replace an explicitly configured daemon after probe failure', async () => {
    const launch = vi.fn()
    await expect(startDesktopPaseo({
      stateDir: stateDirectory(),
      env: { PASEO_DAEMON_URL: 'ws://127.0.0.1:7000/ws', PASEO_DAEMON_PASSWORD: 'configured' },
      connect: vi.fn().mockRejectedValue(new Error('unauthorized')),
      launch,
    })).rejects.toThrow(/configured Paseo daemon/)
    expect(launch).not.toHaveBeenCalled()
  })

  it('rejects an incompatible explicit daemon and closes the probe connection', async () => {
    const connection = protocolConnection({ version: '0.7.0' })
    mocks.createPaseoConnection.mockResolvedValue(connection)
    const launch = vi.fn()

    await expect(startDesktopPaseo({
      stateDir: stateDirectory(),
      env: { PASEO_DAEMON_URL: 'ws://127.0.0.1:7000/ws', PASEO_DAEMON_PASSWORD: 'configured' },
      launch,
    })).rejects.toThrow(/configured Paseo daemon/)

    expect(mocks.createPaseoConnection).toHaveBeenCalledWith(expect.objectContaining({
      url: 'ws://127.0.0.1:7000/ws',
      password: 'configured',
      connectTimeoutMs: 1500,
      reconnect: { enabled: false },
    }))
    expect(connection.client.workspaces.list).toHaveBeenCalledWith({})
    expect(connection.close).toHaveBeenCalledOnce()
    expect(launch).not.toHaveBeenCalled()
  })

  it('starts one owned loopback daemon and stops it idempotently', async () => {
    const child = managedChild()
    const env = { HYPERCANVAS_LAUNCH_TOKEN: 'not-for-PTY-children' }
    const launch = vi.fn().mockReturnValue(child)
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('no default daemon'))
      .mockResolvedValueOnce('owned-server')
    const stateDir = stateDirectory()
    const runtime = await startDesktopPaseo({
      stateDir,
      env,
      connect,
      launch,
      selectPort: async () => 45678,
      defaultUrl: 'ws://127.0.0.1:0/ws',
      resolveSupervisorEntry: () => '/core/node_modules/@getpaseo/server/scripts/supervisor-entrypoint.js',
    })

    expect(runtime).toMatchObject({ owned: true, url: 'ws://127.0.0.1:45678/ws', serverId: 'owned-server', child })
    expect(launch).toHaveBeenCalledWith(expect.any(String), [expect.stringContaining('supervisor-entrypoint.js'), '--no-relay', '--no-web-ui'], expect.objectContaining({
      env: expect.objectContaining({ PASEO_LISTEN: '127.0.0.1:45678', PASEO_HOME: path.join(stateDir, 'paseo') }),
      stdio: 'ignore',
    }))
    const daemonEnv = launch.mock.calls[0][2].env
    expect(daemonEnv.PASEO_PASSWORD).toMatch(/^[a-f0-9]{64}$/)
    expect(daemonEnv.HYPERCANVAS_LAUNCH_TOKEN).toBeUndefined()
    expect(daemonEnv.PASEO_DAEMON_PASSWORD).toBeUndefined()
    expect(fs.statSync(path.join(stateDir, 'paseo')).mode & 0o777).toBe(0o700)
    expect(connect.mock.calls[0][0]).toBe('ws://127.0.0.1:0/ws')
    expect(runtime.connectionOptions).toMatchObject({ url: runtime.url, password: daemonEnv.PASEO_PASSWORD })
    expect(env.PASEO_DAEMON_URL).toBeUndefined()
    expect(env.PASEO_DAEMON_PASSWORD).toBeUndefined()
    await runtime.stop()
    await runtime.stop()
    expect(child.killedWith).toEqual(['SIGTERM'])
  })

  it('stops an owned daemon when readiness never succeeds', async () => {
    const child = managedChild()
    const launch = vi.fn().mockReturnValue(child)
    const connect = vi.fn().mockRejectedValue(new Error('not ready'))
    const env = {}

    await expect(startDesktopPaseo({
      stateDir: stateDirectory(),
      env,
      connect,
      launch,
      selectPort: async () => 45679,
      resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
      timeoutMs: 1,
    })).rejects.toThrow(/Timed out waiting/)

    expect(launch).toHaveBeenCalledOnce()
    expect(child.killedWith).toEqual(['SIGTERM'])
    expect(env.PASEO_DAEMON_URL).toBeUndefined()
    expect(env.PASEO_DAEMON_PASSWORD).toBeUndefined()
  })

  it('fails promptly when the owned supervisor exits during startup', async () => {
    const child = managedChild()
    const launch = vi.fn(() => {
      setTimeout(() => child.emit('exit', 17), 0)
      return child
    })

    await expect(startDesktopPaseo({
      stateDir: stateDirectory(),
      connect: vi.fn().mockRejectedValue(new Error('not ready')),
      launch,
      selectPort: async () => 45680,
      resolveSupervisorEntry: () => '/core/supervisor-entrypoint.js',
      timeoutMs: 1000,
    })).rejects.toThrow(/exited during startup/)

    expect(child.killedWith).toEqual([])
  })
})
