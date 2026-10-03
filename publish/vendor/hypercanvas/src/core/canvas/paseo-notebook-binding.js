/**
 * Verified Notebook→Paseo binding.
 *
 * Session features (agent chat, terminal PTY, managed Sites) must only report
 * "ready" once the active Notebook is bound to a confirmed Paseo server AND a
 * workspace on that server. A binding is confirmed when:
 *
 *   1. the shared connection reports a daemon `serverId` (identity of the
 *      Paseo host the user's sessions will live in), and
 *   2. `ensurePaseoWorkspaceForRoot` resolved a workspace ID for the Notebook
 *      root on that daemon.
 *
 * Registration failures are recorded — never silently swallowed — and exposed
 * through `getNotebookPaseoBinding()` so diagnostics can surface actionable
 * guidance. When the daemon identity changes (Core fell back to a private
 * daemon, or the reused daemon restarted as a different server), the cached
 * workspace ID is discarded and re-resolved so an ID from one Paseo server is
 * never reused against another.
 */

import { ensurePaseoWorkspaceForRoot, getPaseoConnection, getPaseoConnectionDiagnostics, resetPaseoConnectionForTests } from './paseo-runtime-client.js'

export const BINDING_STATES = Object.freeze(['idle', 'pending', 'confirmed', 'stale', 'failed'])

const READ_ENV = () => globalThis.process?.env || {}

/** Daemon ownership reported by Core's daemon lifecycle: reused | owned | unknown. */
export function paseoDaemonOwnership(env = READ_ENV()) {
  const value = env.HYPERCANVAS_PASEO_DAEMON_OWNED
  if (value === '1') return 'owned'
  if (value === '0') return 'reused'
  return 'unknown'
}

let binding = null
let lastError = null
let pending = null
let pendingRoot = null
const revalidationHookedDaemons = new WeakSet()

/**
 * Watch daemon reconnects so a connection that comes back as a *different*
 * Paseo server invalidates the binding immediately — a workspace ID resolved
 * on one server must never be reused against another.
 */
function hookDaemonRevalidation(connection) {
  const daemon = connection?.daemon
  if (!daemon || typeof daemon.subscribeConnectionStatus !== 'function') return
  if (revalidationHookedDaemons.has(daemon)) return
  revalidationHookedDaemons.add(daemon)
  daemon.subscribeConnectionStatus((state) => {
    if (state?.status !== 'connected') return
    const serverId = daemon.getLastServerInfoMessage?.()?.serverId || null
    if (binding && serverId && serverId !== binding.serverId) invalidateNotebookPaseoBinding()
  })
}

function snapshotState(connectionState = null) {
  if (pending) return 'pending'
  if (lastError) return 'failed'
  if (binding) {
    return connectionState?.status === 'connected' ? 'confirmed' : 'stale'
  }
  return 'idle'
}

function bindingSnapshot(connectionState = null) {
  const ownership = paseoDaemonOwnership()
  return {
    state: snapshotState(connectionState),
    ...(binding ? {
      root: binding.root,
      serverId: binding.serverId,
      workspaceId: binding.workspaceId,
      workspaceDirectory: binding.workspaceDirectory || null,
      ownership,
      registeredAt: binding.registeredAt,
      revalidatedAt: binding.revalidatedAt || null,
    } : {}),
    ...(lastError ? { lastError } : { lastError: null }),
  }
}

function confirmedSnapshot(bindingRecord, connectionState = null) {
  const ownership = paseoDaemonOwnership()
  return {
    state: connectionState?.status === 'connected' ? 'confirmed' : 'stale',
    root: bindingRecord.root,
    serverId: bindingRecord.serverId,
    workspaceId: bindingRecord.workspaceId,
    workspaceDirectory: bindingRecord.workspaceDirectory || null,
    ownership,
    registeredAt: bindingRecord.registeredAt,
    revalidatedAt: bindingRecord.revalidatedAt || null,
    lastError: null,
  }
}

function recordFailure(error) {
  lastError = {
    message: error?.message || String(error),
    code: typeof error?.code === 'string' ? error.code : null,
    at: new Date().toISOString(),
  }
}

/**
 * Confirm (or revalidate) the binding for a Notebook root. Idempotent for an
 * unchanged daemon; re-resolves the workspace when the daemon identity or the
 * root changes. Concurrent calls for the same root share one confirmation.
 */
export async function confirmNotebookPaseoBinding(root, options = {}) {
  const directory = String(root || '')
  if (!directory) throw new Error('Confirming a Paseo binding requires a Notebook root')

  const connectionState = getPaseoConnectionDiagnostics()
  const reportedServerId = connectionState.server?.serverId || null
  if (
    binding
    && binding.root === directory
    && connectionState.state?.status === 'connected'
    && reportedServerId === binding.serverId
  ) {
    // Fast path: the same confirmed daemon still answers, keep the binding.
    binding.revalidatedAt = new Date().toISOString()
    return confirmedSnapshot(binding, connectionState.state)
  }

  if (pending && pendingRoot === directory) return pending
  if (pending) await Promise.resolve(pending).catch(() => {})

  const confirm = (async () => {
    const connection = await getPaseoConnection(options.connectionOptions || {})
    hookDaemonRevalidation(connection)
    const diagnostics = connection.getDiagnostics()
    const serverId = diagnostics.server?.serverId || null
    if (!serverId) throw new Error('The Paseo daemon did not report its server identity')
    if (binding && binding.serverId !== serverId) {
      // A different Paseo server is now behind this connection. Workspace IDs
      // are daemon-scoped, so the cached one must never be reused.
      invalidateNotebookPaseoBinding()
    }
    const workspaceId = await ensurePaseoWorkspaceForRoot(connection.client, directory)
    if (!binding || binding.root !== directory || binding.workspaceId !== workspaceId) {
      binding = {
        root: directory,
        serverId,
        workspaceId,
        ...(diagnostics.server?.version ? { daemonVersion: diagnostics.server.version } : {}),
        registeredAt: new Date().toISOString(),
      }
    } else {
      binding.serverId = serverId
      binding.revalidatedAt = new Date().toISOString()
    }
    lastError = null
    return confirmedSnapshot(binding, connection.getDiagnostics().state)
  })()

  pending = confirm
  pendingRoot = directory
  try {
    return await confirm
  } catch (error) {
    recordFailure(error)
    throw error
  } finally {
    if (pending === confirm) {
      pending = null
      pendingRoot = null
    }
  }
}

/** Snapshot of the current binding for diagnostics. Never throws. */
export function getNotebookPaseoBinding() {
  return bindingSnapshot(getPaseoConnectionDiagnostics().state)
}

/** Clear the binding so the next confirmation re-resolves from scratch. */
export function invalidateNotebookPaseoBinding() {
  binding = null
  pending = null
  pendingRoot = null
}

export async function resetNotebookPaseoBindingForTests() {
  invalidateNotebookPaseoBinding()
  lastError = null
  await resetPaseoConnectionForTests()
}
