import { Buffer } from 'node:buffer'

export const DEFAULT_OPERATION_OUTPUT_BYTES = 64 * 1024

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const SECRET_PATTERN = /((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*)([^\s]+)/gi
const BEARER_PATTERN = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS_PATTERN = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi

function timestamp(now) {
  const value = now()
  return new Date(value instanceof Date ? value.getTime() : value).toISOString()
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

function truncateUtf8(value, maxBytes) {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character)
    if (bytes + size > maxBytes) break
    result += character
    bytes += size
  }
  return result
}

export function redactOperationOutput(value) {
  return String(value || '')
    .replace(BEARER_PATTERN, '$1[REDACTED]')
    .replace(SECRET_PATTERN, '$1[REDACTED]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[REDACTED]@')
}

export function createOperationStore({
  now = Date.now,
  maxOutputBytes = DEFAULT_OPERATION_OUTPUT_BYTES,
} = {}) {
  const operations = new Map()
  let activeId = null

  function requireOperation(id) {
    const operation = operations.get(id)
    if (!operation) throw Object.assign(new Error('Installation operation was not found'), { code: 'OPERATION_NOT_FOUND' })
    return operation
  }

  function touch(operation) {
    operation.updatedAt = timestamp(now)
  }

  function snapshot(operation) {
    return freeze(clone(operation))
  }

  function phase(operation, phaseId) {
    const value = operation.phases.find(({ id }) => id === phaseId)
    if (!value) throw Object.assign(new Error(`Unknown operation phase: ${phaseId}`), { code: 'PHASE_NOT_FOUND' })
    return value
  }

  function settle(operation, status, details = {}) {
    if (TERMINAL_STATUSES.has(operation.status)) return snapshot(operation)
    const at = timestamp(now)
    operation.status = status
    operation.phase = null
    operation.completedAt = at
    operation.updatedAt = at
    operation.cancellation.available = false
    operation.cancellation.state = status === 'cancelled' ? 'cancelled' : 'settled'
    Object.assign(operation, clone(details))
    if (activeId === operation.id) activeId = null
    return snapshot(operation)
  }

  return Object.freeze({
    create({ id, planId, selectedAgentIds, steps }) {
      if (activeId) throw Object.assign(new Error('Another installation operation is active'), { code: 'OPERATION_ACTIVE' })
      if (operations.has(id)) throw Object.assign(new Error('Operation ID already exists'), { code: 'OPERATION_EXISTS' })
      const at = timestamp(now)
      const operation = {
        id,
        planId,
        selectedAgentIds: [...selectedAgentIds],
        status: 'queued',
        phase: null,
        phases: steps.map(({ id: phaseId, action }) => ({
          id: phaseId,
          plannedAction: action,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          detail: null,
        })),
        cancellation: { requested: false, available: false, state: 'not_started' },
        output: [],
        outputBytes: 0,
        outputTruncated: false,
        result: null,
        error: null,
        createdAt: at,
        startedAt: null,
        updatedAt: at,
        completedAt: null,
      }
      operations.set(id, operation)
      activeId = id
      return snapshot(operation)
    },

    get(id) {
      const operation = operations.get(id)
      return operation ? snapshot(operation) : null
    },

    getActive() {
      return activeId ? snapshot(requireOperation(activeId)) : null
    },

    start(id) {
      const operation = requireOperation(id)
      if (operation.status !== 'queued') return snapshot(operation)
      const at = timestamp(now)
      operation.status = 'running'
      operation.startedAt = at
      operation.updatedAt = at
      return snapshot(operation)
    },

    startPhase(id, phaseId, { cancellable = false, cancellationState = cancellable ? 'available' : 'not_available' } = {}) {
      const operation = requireOperation(id)
      const current = phase(operation, phaseId)
      const at = timestamp(now)
      operation.phase = phaseId
      current.status = 'running'
      current.startedAt = at
      current.completedAt = null
      operation.cancellation.available = cancellable
      operation.cancellation.state = cancellationState
      operation.updatedAt = at
      return snapshot(operation)
    },

    completePhase(id, phaseId, detail = null) {
      const operation = requireOperation(id)
      const current = phase(operation, phaseId)
      current.status = 'succeeded'
      current.detail = clone(detail)
      current.completedAt = timestamp(now)
      operation.phase = null
      operation.cancellation.available = false
      operation.cancellation.state = operation.cancellation.requested ? 'requested' : 'between_phases'
      touch(operation)
      return snapshot(operation)
    },

    skipPhase(id, phaseId, detail = null) {
      const operation = requireOperation(id)
      const current = phase(operation, phaseId)
      const at = timestamp(now)
      current.status = 'skipped'
      current.detail = clone(detail)
      current.startedAt ||= at
      current.completedAt = at
      operation.phase = null
      touch(operation)
      return snapshot(operation)
    },

    failPhase(id, phaseId, error) {
      const operation = requireOperation(id)
      const current = phase(operation, phaseId)
      current.status = 'failed'
      current.detail = clone(error)
      current.completedAt = timestamp(now)
      touch(operation)
      return snapshot(operation)
    },

    setCancellation(id, { available, state }) {
      const operation = requireOperation(id)
      operation.cancellation.available = Boolean(available)
      operation.cancellation.state = state
      touch(operation)
      return snapshot(operation)
    },

    requestCancellation(id) {
      const operation = requireOperation(id)
      if (TERMINAL_STATUSES.has(operation.status)) return { accepted: false, snapshot: snapshot(operation) }
      operation.cancellation.requested = true
      if (operation.cancellation.available) operation.cancellation.state = 'requested'
      touch(operation)
      return { accepted: operation.cancellation.available, snapshot: snapshot(operation) }
    },

    appendOutput(id, { phase: phaseId, stream = 'system', text }) {
      const operation = requireOperation(id)
      if (operation.outputTruncated) return snapshot(operation)
      const redacted = redactOperationOutput(text).trim()
      if (!redacted) return snapshot(operation)
      const truncationLabel = '\n[output truncated]'
      const remaining = Math.max(0, maxOutputBytes - operation.outputBytes)
      const bytes = Buffer.from(redacted)
      const truncated = bytes.length > remaining
      const label = truncated ? truncateUtf8(truncationLabel, remaining) : ''
      const contentLimit = truncated ? Math.max(0, remaining - Buffer.byteLength(label)) : remaining
      let stored = truncateUtf8(redacted, contentLimit)
      if (bytes.length > remaining) {
        stored = `${stored}${label}`.trim()
        operation.outputTruncated = true
      }
      operation.outputBytes += Buffer.byteLength(stored)
      if (stored) operation.output.push({ at: timestamp(now), phase: phaseId, stream, text: stored })
      touch(operation)
      return snapshot(operation)
    },

    succeed(id, result) {
      return settle(requireOperation(id), 'succeeded', { result, error: null })
    },

    fail(id, error, result = null) {
      return settle(requireOperation(id), 'failed', { error: clone(error), result: clone(result) })
    },

    cancel(id, result = null) {
      return settle(requireOperation(id), 'cancelled', { result: clone(result), error: null })
    },
  })
}
