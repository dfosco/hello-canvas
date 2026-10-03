import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_PASEO_DAEMON_URL = 'ws://127.0.0.1:6767/ws'

let connection = null
let connectionPromise = null
let lastConnectionError = null
const workspacePromises = new WeakMap()

async function loadPaseoSdk() {
  const [clientModule, daemonModule] = await Promise.all([
    import(/* @vite-ignore */ '@getpaseo/client').catch(() => null),
    import(/* @vite-ignore */ '@getpaseo/client/internal/daemon-client').catch(() => null),
  ])
  if (!clientModule?.createPaseoApi || !daemonModule?.DaemonClient) {
    throw new Error('The Paseo SDK is unavailable. Install @getpaseo/client@0.8.0-beta.1.')
  }
  return {
    createPaseoApi: clientModule.createPaseoApi,
    DaemonClient: daemonModule.DaemonClient,
  }
}

export function paseoConnectionConfig(options = {}) {
  const env = options.env || process.env
  return {
    url: options.url || env.PASEO_DAEMON_URL || DEFAULT_PASEO_DAEMON_URL,
    clientId: options.clientId || `hypercanvas-${randomUUID()}`,
    clientType: 'cli',
    appVersion: options.appVersion || 'hypercanvas',
    ...(options.password || env.PASEO_DAEMON_PASSWORD
      ? { password: options.password || env.PASEO_DAEMON_PASSWORD }
      : {}),
    ...(options.authHeader || env.PASEO_DAEMON_AUTH_HEADER
      ? { authHeader: options.authHeader || env.PASEO_DAEMON_AUTH_HEADER }
      : {}),
    reconnect: options.reconnect || { enabled: true },
    ...(options.connectTimeoutMs ? { connectTimeoutMs: options.connectTimeoutMs } : {}),
  }
}

function redactDiagnosticText(value, secrets = []) {
  if (typeof value !== 'string' || !value) return null
  let message = value
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) message = message.replaceAll(secret, '[redacted]')
  }
  return message.slice(0, 500)
}

function connectionDiagnostics(daemon, config) {
  const secrets = [config.password, config.authHeader, config.url]
  const rawState = daemon.getConnectionState?.() || { status: 'idle' }
  const state = {
    ...rawState,
    ...(rawState.reason ? { reason: redactDiagnosticText(rawState.reason, secrets) } : {}),
  }
  const serverInfo = daemon.getLastServerInfoMessage?.()
  return {
    status: state.status || 'unknown',
    connected: state.status === 'connected',
    state,
    lastError: redactDiagnosticText(daemon.lastError || rawState.reason || '', secrets),
    server: serverInfo?.serverId || serverInfo?.version
      ? { serverId: serverInfo.serverId || null, version: serverInfo.version || null }
      : null,
    reconnect: {
      enabled: config.reconnect?.enabled !== false,
      attempt: Number.isFinite(state.attempt) ? state.attempt : 0,
    },
    lastLivenessRttMs: daemon.getLastLivenessRttMs?.() ?? null,
  }
}

function idleConnectionDiagnostics(status = 'idle', lastError = null) {
  const state = { status, ...(lastError ? { reason: lastError } : {}), ...(status === 'connecting' ? { attempt: 1 } : {}) }
  return {
    status,
    connected: false,
    state,
    lastError,
    server: null,
    reconnect: { enabled: true, attempt: state.attempt || 0 },
    lastLivenessRttMs: null,
  }
}

export async function createPaseoConnection(options = {}) {
  const config = paseoConnectionConfig(options)
  const sdk = options.daemon && options.client
    ? null
    : await loadPaseoSdk()
  const daemon = options.daemon || new sdk.DaemonClient(config)
  try {
    await daemon.connect()
  } catch (error) {
    await daemon.close().catch(() => {})
    throw error
  }
  const client = options.client || sdk.createPaseoApi(daemon)
  return {
    client,
    daemon,
    getConnectionState: () => connectionDiagnostics(daemon, config).state,
    getDiagnostics: () => connectionDiagnostics(daemon, config),
    close: () => daemon.close(),
  }
}

export async function getPaseoConnection(options = {}) {
  if (connection) {
    if (connection.getConnectionState()?.status !== 'disposed') return connection
    connection = null
  }
  if (connectionPromise) return connectionPromise
  const pending = createPaseoConnection(options)
  connectionPromise = pending
  try {
    connection = await pending
    lastConnectionError = null
    return connection
  } catch (error) {
    const config = paseoConnectionConfig(options)
    lastConnectionError = redactDiagnosticText(error?.message || String(error), [config.password, config.authHeader, config.url])
    throw error
  } finally {
    if (connectionPromise === pending) connectionPromise = null
  }
}

/** Resolve the canonical Paseo workspace for a project root, opening it idempotently if needed. */
export async function ensurePaseoWorkspaceForRoot(client, root) {
  const directory = fs.realpathSync.native(path.resolve(root))
  if (!fs.statSync(directory).isDirectory()) {
    const error = new Error(`Paseo workspace root is not a directory: ${directory}`)
    error.code = 'WORKSPACE_ROOT_NOT_DIRECTORY'
    throw error
  }
  let pending = workspacePromises.get(client)
  if (!pending) { pending = new Map(); workspacePromises.set(client, pending) }
  if (pending.has(directory)) return pending.get(directory)
  const promise = (async () => {
    // open() idempotently registers the existing Notebook/Site directory. create()
    // creates a fresh workspace identity and must not be used for path binding.
    const workspace = await client.workspaces.open({ cwd: directory })
    if (!workspace?.id) throw new Error('Paseo did not return a workspace ID')
    const returnedDirectory = workspace.workspaceDirectory || workspace.directory
    if (returnedDirectory) {
      let canonicalReturnedDirectory
      try { canonicalReturnedDirectory = fs.realpathSync.native(path.resolve(returnedDirectory)) } catch { /* a non-existent path cannot match the requested root */ }
      if (canonicalReturnedDirectory !== directory) {
        throw new Error('Paseo returned a workspace outside the requested Notebook directory')
      }
    }
    return workspace.id
  })()
  pending.set(directory, promise)
  try { return await promise } finally { pending.delete(directory) }
}


export function getPaseoConnectionState() {
  return connection?.getConnectionState() || idleConnectionDiagnostics(connectionPromise ? 'connecting' : lastConnectionError ? 'disconnected' : 'idle', lastConnectionError).state
}

export function getPaseoConnectionDiagnostics() {
  return connection?.getDiagnostics()
    || idleConnectionDiagnostics(connectionPromise ? 'connecting' : lastConnectionError ? 'disconnected' : 'idle', lastConnectionError)
}

export function classifyPaseoRecoveryState(state) {
  switch (state?.status) {
    case 'connected': return 'ready'
    case 'connecting': return 'reconnecting'
    case 'disconnected': return 'disconnected'
    case 'disposed': return 'stopped'
    case 'idle': return 'idle'
    default: return 'unknown'
  }
}

export async function resetPaseoConnectionForTests() {
  const active = connection
  connection = null
  connectionPromise = null
  lastConnectionError = null
  await active?.close().catch(() => {})
}
