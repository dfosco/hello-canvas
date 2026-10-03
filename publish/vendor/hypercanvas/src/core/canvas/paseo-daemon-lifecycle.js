import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createPaseoConnection, DEFAULT_PASEO_DAEMON_URL } from './paseo-runtime-client.js'
import { selectEphemeralPort } from '../cli/devContract.js'

export const BUNDLED_PASEO_VERSION = '0.8.0-beta.1'

async function probe(url, password, authHeader) {
  // Use only this endpoint's credentials. A private probe must never inherit
  // the parent's App auth header through the runtime client's env fallback.
  const connection = await createPaseoConnection({ env: {}, url, password, authHeader, connectTimeoutMs: 1500, reconnect: { enabled: false } })
  let timer
  try {
    await Promise.race([
      connection.client.workspaces.list({}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Paseo workspace probe timed out')), 1500) }),
    ])
    const info = connection.daemon.getLastServerInfoMessage()
    // Require the workspace-era protocol, but do not reject newer App releases
    // just because the private fallback is pinned to an older package version.
    // The SDK handshake and workspace call above are the live contract probe.
    const version = /^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(info?.version || '')
    const supported = info?.version === BUNDLED_PASEO_VERSION
      || (version && (Number(version[1]) > 0 || (Number(version[2]) >= 8 && !info.version.includes('-'))))
    if (!info?.serverId || !supported) {
      throw new Error('The local Paseo daemon is incompatible with this Hypercanvas release')
    }
    return info.serverId
  } finally {
    clearTimeout(timer)
    await connection.close()
  }
}

/** Select once per Core launch. Never migrate to a different daemon mid-run. */
export async function startDesktopPaseo({
  stateDir,
  env = process.env,
  usePaseoApp = true,
  connect = probe,
  launch = spawn,
  defaultUrl = DEFAULT_PASEO_DAEMON_URL,
  selectPort = selectEphemeralPort,
  resolveSupervisorEntry = () => {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve('@getpaseo/server')), '../../scripts/supervisor-entrypoint.js')
  },
  timeoutMs = 25_000,
} = {}) {
  if (!stateDir) throw new Error('Core Paseo startup requires an application state directory')
  if (typeof usePaseoApp !== 'boolean') throw new Error('usePaseoApp must be a boolean')
  const preferApp = usePaseoApp && env.HYPERCANVAS_PASEO_ISOLATED !== '1'
  const requestedUrl = env.PASEO_DAEMON_URL || defaultUrl
  let reuseProbeFailure = null
  if (preferApp) {
    try {
      const serverId = await connect(requestedUrl, env.PASEO_DAEMON_PASSWORD, env.PASEO_DAEMON_AUTH_HEADER)
      return {
        owned: false,
        usePaseoApp: preferApp,
        url: requestedUrl,
        serverId,
        connectionOptions: {
          url: requestedUrl,
          ...(env.PASEO_DAEMON_PASSWORD ? { password: env.PASEO_DAEMON_PASSWORD } : {}),
          ...(env.PASEO_DAEMON_AUTH_HEADER ? { authHeader: env.PASEO_DAEMON_AUTH_HEADER } : {}),
        },
        child: null,
        stop: async () => {},
      }
    } catch (probeError) {
      if (env.PASEO_DAEMON_URL || env.PASEO_DAEMON_PASSWORD || env.PASEO_DAEMON_AUTH_HEADER) {
        throw new Error('Could not connect to the configured Paseo daemon; check its compatibility and authentication')
      }
      // Falling back to a private daemon must be explainable: the reason is
      // reported on the owned handle and in the paseo-ready desktop event.
      reuseProbeFailure = probeError?.message || String(probeError)
      for (const secret of [requestedUrl, env.PASEO_DAEMON_PASSWORD, env.PASEO_DAEMON_AUTH_HEADER]) {
        if (secret) reuseProbeFailure = reuseProbeFailure.replaceAll(secret, '[redacted]')
      }
      reuseProbeFailure = reuseProbeFailure.slice(0, 500)
    }
  }

  const port = await selectPort('127.0.0.1')
  const url = `ws://127.0.0.1:${port}/ws`
  const password = randomBytes(32).toString('hex')
  const home = join(stateDir, 'paseo')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(home, 0o700)
  const entry = resolveSupervisorEntry()
  const daemonEnv = {
    ...env,
    PASEO_HOME: home,
    PASEO_LISTEN: `127.0.0.1:${port}`,
    PASEO_PASSWORD: password,
  }
  // Browser/SDK session tokens must not flow into Paseo's PTY/provider children.
  delete daemonEnv.HYPERCANVAS_LAUNCH_TOKEN
  delete daemonEnv.PASEO_DAEMON_URL
  delete daemonEnv.PASEO_DAEMON_PASSWORD
  delete daemonEnv.PASEO_DAEMON_AUTH_HEADER
  const child = launch(process.execPath, [entry, '--no-relay', '--no-web-ui'], {
    env: daemonEnv,
    stdio: 'ignore',
    detached: false,
  })
  let exited = false
  let launchError = false
  child.once('exit', () => { exited = true })
  child.once('error', () => { launchError = true })
  let stopping
  const stop = () => stopping ||= (async () => {
    if (exited || launchError) return
    child.kill('SIGTERM')
    const deadline = Date.now() + 3000
    while (!exited && Date.now() < deadline) await delay(50)
    if (!exited) child.kill('SIGKILL')
  })()
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (exited || launchError) throw new Error('The bundled Paseo daemon exited during startup')
      try {
        const serverId = await connect(url, password)
        return {
          owned: true,
          usePaseoApp: preferApp,
          url,
          serverId,
          reuseProbeFailure,
          connectionOptions: { url, password },
          child,
          stop,
        }
      } catch {
        await delay(150)
      }
    }
    throw new Error('Timed out waiting for the bundled Paseo daemon handshake')
  } catch (error) {
    await stop()
    throw error
  }
}
