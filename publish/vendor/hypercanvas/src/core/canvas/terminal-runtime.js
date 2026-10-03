import { createHash } from 'node:crypto'
import { getPaseoTerminalRuntime } from './paseo-terminal-runtime.js'

const runtimeAliases = new Map()
const serviceWriters = new Map()
const lifecycleOperations = new Map()
const startupOperations = new Map()

function runtime() {
  return getPaseoTerminalRuntime()
}

function clientIdFor(sessionId, suffix = 'service') {
  return `storyboard-${createHash('sha256').update(sessionId).digest('hex').slice(0, 16)}-${suffix}`
}

async function ensureServiceWriter(runtimeSessionId) {
  const existing = serviceWriters.get(runtimeSessionId)
  if (existing) return existing

  let subscription
  subscription = runtime().subscribe(runtimeSessionId, {
    clientId: clientIdFor(runtimeSessionId),
    readOnly: false,
    afterSequence: 0,
    onClose: () => {
      if (serviceWriters.get(runtimeSessionId) === subscription) serviceWriters.delete(runtimeSessionId)
    },
  })
  serviceWriters.set(runtimeSessionId, subscription)
  try {
    return await subscription
  } catch (error) {
    if (serviceWriters.get(runtimeSessionId) === subscription) serviceWriters.delete(runtimeSessionId)
    throw error
  }
}

function queueLifecycle(runtimeSessionId, operation) {
  const previous = lifecycleOperations.get(runtimeSessionId) || Promise.resolve()
  const next = previous.catch(() => {}).then(operation)
  lifecycleOperations.set(runtimeSessionId, next)
  next.finally(() => {
    if (lifecycleOperations.get(runtimeSessionId) === next) lifecycleOperations.delete(runtimeSessionId)
  }).catch(() => {})
  return next
}

async function waitForLifecycle(runtimeSessionId) {
  await lifecycleOperations.get(runtimeSessionId)?.catch(() => {})
}

export function registerRuntimeSession(sessionId, runtimeSessionId = sessionId) {
  runtimeAliases.set(sessionId, runtimeSessionId)
  return runtimeSessionId
}

export function unregisterRuntimeSession(sessionId) {
  const runtimeSessionId = runtimeAliases.get(sessionId) || sessionId
  runtimeAliases.delete(sessionId)
  const writer = serviceWriters.get(runtimeSessionId)
  serviceWriters.delete(runtimeSessionId)
  Promise.resolve(writer).then((handle) => handle?.close()).catch(() => {})
}

export function resolveRuntimeSessionId(sessionId) {
  return runtimeAliases.get(sessionId) || sessionId
}

export function withTerminalStartup(key, operation) {
  const previous = startupOperations.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  startupOperations.set(key, current)
  current.finally(() => {
    if (startupOperations.get(key) === current) startupOperations.delete(key)
  }).catch(() => {})
  return current
}

export async function createTerminalSession(sessionId, options) {
  const runtimeSessionId = registerRuntimeSession(sessionId, options.runtimeSessionId || sessionId)
  await waitForLifecycle(runtimeSessionId)
  try {
    return await runtime().create({
      sessionId: runtimeSessionId,
      program: options.program,
      args: options.args || [],
      cwd: options.cwd,
      workspaceId: options.workspaceId,
      env: options.env || {},
      cols: options.cols || 80,
      rows: options.rows || 24,
    })
  } catch (error) {
    if (options.rollbackOnError !== false) {
      await runtime().terminate(runtimeSessionId).catch(() => {})
      unregisterRuntimeSession(sessionId)
    }
    throw error
  }
}

export async function terminalSessionExists(sessionId) {
  const result = await runtime().exists(resolveRuntimeSessionId(sessionId))
  return result.exists === true
}

export function getTerminalSession(sessionId) {
  return runtime().get(resolveRuntimeSessionId(sessionId))
}

export async function listRuntimeSessions() {
  const result = await runtime().list()
  return Array.isArray(result?.sessions) ? result.sessions : []
}

export function snapshotTerminalSession(sessionId) {
  return runtime().snapshot(resolveRuntimeSessionId(sessionId))
}

export async function subscribeTerminalSession(sessionId, options = {}) {
  const runtimeSessionId = resolveRuntimeSessionId(sessionId)
  await waitForLifecycle(runtimeSessionId)
  const readOnly = options.readOnly === true
  const clientId = options.clientId || clientIdFor(sessionId, `observer-${Math.random().toString(36).slice(2, 8)}`)
  if (!readOnly) await ensureServiceWriter(runtimeSessionId)

  const handle = await runtime().subscribe(runtimeSessionId, {
    clientId,
    readOnly: true,
    afterSequence: options.afterSequence || 0,
    restore: options.restore === true,
    onEvent: options.onEvent,
    onOutput: options.onOutput,
    onGap: options.onGap,
    onLifecycle: options.onLifecycle,
    onConflict: options.onConflict,
    onExit: options.onExit,
    onError: options.onError,
    onClose: options.onClose,
  })

  return {
    ...handle,
    clientId,
    runtimeSessionId,
    close() {
      handle.close()
    },
  }
}

export async function writeTerminalBytes(sessionId, bytes) {
  const runtimeSessionId = resolveRuntimeSessionId(sessionId)
  return queueLifecycle(runtimeSessionId, async () => {
    await ensureServiceWriter(runtimeSessionId)
    return runtime().writeBytes(runtimeSessionId, bytes, clientIdFor(runtimeSessionId))
  })
}

export function writeTerminalText(sessionId, text, { submit = false } = {}) {
  const suffix = submit ? '\r' : ''
  return writeTerminalBytes(sessionId, Buffer.from(`${text}${suffix}`, 'utf8'))
}

export class TerminalSubmissionError extends Error {
  constructor(message, { code, statusCode = 400 } = {}) {
    super(message)
    this.name = 'TerminalSubmissionError'
    this.code = code || 'INVALID_TERMINAL_INPUT'
    this.statusCode = statusCode
  }
}

/**
 * Submit text to a live terminal session. `accepted` means the PTY runtime
 * accepted the bytes; it does not mean the foreground program processed them.
 */
export async function submitTerminalText(sessionId, text, { submit = false, paste = false, canWrite = () => true } = {}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new TerminalSubmissionError('A terminal sessionId is required', { code: 'INVALID_SESSION_ID' })
  }
  if (typeof text !== 'string') {
    throw new TerminalSubmissionError('Terminal input text must be a string', { code: 'INVALID_TERMINAL_TEXT' })
  }
  if (typeof submit !== 'boolean') {
    throw new TerminalSubmissionError('Terminal submit must be a boolean', { code: 'INVALID_SUBMIT_OPTION' })
  }

  if (typeof paste !== 'boolean') throw new TerminalSubmissionError('Terminal paste must be a boolean', { code: 'INVALID_PASTE_OPTION' })
  const runtimeSessionId = resolveRuntimeSessionId(sessionId)
  const state = await runtime().exists(runtimeSessionId)
  if (state?.exists !== true) {
    throw new TerminalSubmissionError(`Terminal session ${sessionId} is not running`, {
      code: 'TERMINAL_NOT_RUNNING',
      statusCode: 410,
    })
  }

  // Keep the text and Enter in one serialized operation, but separate their
  // bursts. TUIs otherwise interpret Enter as part of a large paste and leave
  // the text unsubmitted in the editor.
  const written = await queueLifecycle(runtimeSessionId, async () => {
    await ensureServiceWriter(runtimeSessionId)
    let bytes = 0
    const checkManagedProcess = () => {
      if (!canWrite()) throw new TerminalSubmissionError('Managed agent stopped before context submission', { code: 'AGENT_NOT_READY', statusCode: 409 })
    }
    checkManagedProcess()
    if (text) {
      const payload = paste ? `\x1b[200~${text}\x1b[201~` : text
      const result = await runtime().writeBytes(runtimeSessionId, Buffer.from(payload, 'utf8'), clientIdFor(runtimeSessionId))
      bytes += result?.written ?? Buffer.byteLength(payload, 'utf8')
    }
    if (submit) {
      if (text) await new Promise(resolve => setTimeout(resolve, 200))
      checkManagedProcess()
      const result = await runtime().writeBytes(runtimeSessionId, Buffer.from('\r'), clientIdFor(runtimeSessionId))
      bytes += result?.written ?? 1
    }
    return bytes
  })
  return {
    accepted: true,
    written,
    submitted: submit,
  }
}

export async function resizeTerminalSession(sessionId, cols, rows) {
  const runtimeSessionId = resolveRuntimeSessionId(sessionId)
  return queueLifecycle(runtimeSessionId, async () => {
    await ensureServiceWriter(runtimeSessionId)
    return runtime().resize(runtimeSessionId, cols, rows, clientIdFor(runtimeSessionId))
  })
}

export async function detachTerminalSession(sessionId, expiresAtMs = null) {
  const runtimeSessionId = resolveRuntimeSessionId(sessionId)
  return queueLifecycle(runtimeSessionId, async () => {
    const writer = serviceWriters.get(runtimeSessionId)
    serviceWriters.delete(runtimeSessionId)
    const handle = await writer
    handle?.close()
    return runtime().detach(runtimeSessionId, expiresAtMs)
  })
}

export async function terminateTerminalSession(sessionId) {
  const runtimeSessionId = resolveRuntimeSessionId(sessionId)
  const result = await queueLifecycle(runtimeSessionId, () => runtime().terminate(runtimeSessionId))
  unregisterRuntimeSession(sessionId)
  return result
}

export function cleanupRuntimeSessions(statuses = []) {
  return runtime().cleanup(statuses)
}

export function resetTerminalRuntimeForTests() {
  runtimeAliases.clear()
  for (const writer of serviceWriters.values()) {
    Promise.resolve(writer).then((handle) => handle?.close()).catch(() => {})
  }
  serviceWriters.clear()
  lifecycleOperations.clear()
  startupOperations.clear()
}
