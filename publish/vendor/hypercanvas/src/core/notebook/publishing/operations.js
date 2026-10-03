/**
 * Publish operations.
 *
 * Every publish flow runs as a recorded operation: structured steps, redacted
 * output tails, actionable pause states, and retry (DOCS/publishing.md —
 * "Recovery"). Git command output is captured for the read-only recovery
 * terminal; publishing does not create a shell or agent session.
 */

import { publishingError, ACTIONABLE_ERROR_CODES } from './errors.js'
import { operationId, readState, writeState, saveBinding, readBinding } from './state.js'
import { AsyncLocalStorage } from 'node:async_hooks'

const MAX_OUTPUT_TAIL = 4000
const MAX_OPERATION_OUTPUT = 20000
const operationOutputStorage = new AsyncLocalStorage()

/** Redact credentials and machine noise from captured output. */
export function redactOutput(text) {
  return String(text ?? '')
    .replace(/gh[aop]_[A-Za-z0-9]{16,}/g, '[redacted]')
    .replace(/github_pat_[A-Za-z0-9_]{16,}/g, '[redacted]')
    .replace(/x-access-token:[^@]+@/g, '[redacted]@')
    .replace(/(https:\/\/)[^/@]+:[^/@]+@/g, '$1[redacted]@')
    .trim()
    .slice(-MAX_OUTPUT_TAIL)
}

function newOperation({ kind, request }) {
  return {
    id: operationId(),
    kind,
    request,
    status: 'running',
    finalStatus: null,
    steps: [],
    output: [],
    warnings: [],
    error: null,
    result: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

function appendOutput(operation, persist, source, value) {
  const text = [source, value].filter(part => String(part ?? '').trim()).join('\n')
  const line = redactOutput(text)
  if (!line) return
  operation.output.push(line)
  let length = operation.output.reduce((total, item) => total + item.length + 1, 0)
  while (operation.output.length > 1 && length > MAX_OPERATION_OUTPUT) {
    length -= operation.output.shift().length + 1
  }
  if (length > MAX_OPERATION_OUTPUT) {
    operation.output[0] = operation.output[0].slice(-MAX_OPERATION_OUTPUT)
  }
  persist()
}

function safeDetail(value) {
  if (value === undefined || value === null) return null
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return redactOutput(text) || null
  } catch {
    return null
  }
}

/** Record redacted process output when called inside a publishing operation. */
export function recordOperationOutput(source, value) {
  operationOutputStorage.getStore()?.(source, value)
}

/**
 * Run a flow as a recorded operation. `run(step)` receives helpers:
 * `step(name, fn)` records each step. Actionable failures pause the operation
 * as `awaiting_retry`; other failures mark it `failed`. All failures keep the
 * recorded request for retry.
 */
export async function runOperation({ state, kind, request, persist = () => {}, run }) {
  const operation = newOperation({ kind, request })
  state.operations[operation.id] = operation
  persist()

  const step = async (name, fn) => {
    const record = { name, status: 'running' }
    operation.steps.push(record)
    persist()
    try {
      const result = await fn()
      record.status = 'succeeded'
      persist()
      return result
    } catch (error) {
      record.status = 'failed'
      record.error = { code: error?.code || 'PUBLISHING_FAILED', message: error?.message || String(error) }
      persist()
      throw error
    }
  }

  await operationOutputStorage.run((source, value) => appendOutput(operation, persist, source, value), async () => {
    try {
      operation.result = await run(step) || null
      operation.status = 'succeeded'
      operation.warnings = Array.isArray(operation.result?.warnings) ? operation.result.warnings : []
      operation.finalStatus = operation.warnings.length ? 'warning' : 'success'
      operation.finishedAt = new Date().toISOString()
      persist()
    } catch (error) {
      // `detail` is diagnostic context (often a filesystem path), not process
      // output. Only explicit output belongs in the recovery terminal; Git
      // commands record their stdout/stderr at the command boundary.
      const output = redactOutput(error?.output)
      const detail = safeDetail(error?.detail)
      operation.error = {
        code: error?.code || 'PUBLISHING_FAILED',
        message: error?.message || 'Publishing failed',
        ...(error?.hint ? { hint: error.hint } : {}),
        ...(detail ? { detail } : {}),
        ...(output ? { output } : {}),
      }
      if (output && !operation.output.join('\n').includes(output)) {
        appendOutput(operation, persist, 'Failure output', output)
      }
      operation.status = error?.actionable || ACTIONABLE_ERROR_CODES.has(error?.code) ? 'awaiting_retry' : 'failed'
      operation.finalStatus = 'error'
      operation.finishedAt = new Date().toISOString()
      persist()
    }
  })
  return operation
}

/** Re-run a paused or failed operation from its recorded request. */
export async function retryOperation({ state, operationId: id, rerun }) {
  const existing = state.operations[id]
  if (!existing) throw publishingError('OPERATION_NOT_FOUND', 'Publish operation was not found.')
  if (existing.status === 'succeeded') throw publishingError('OPERATION_NOT_RETRYABLE', 'This operation already succeeded.')
  const rerunOperation = await rerun({ state, request: existing.request ?? {}, previous: existing })
  rerunOperation.retriedFrom = existing.id
  return rerunOperation
}

export function publicOperation(operation) {
  if (!operation) return null
  const warnings = Array.isArray(operation.warnings)
    ? operation.warnings
    : Array.isArray(operation.result?.warnings) ? operation.result.warnings : []
  const finalStatus = operation.finalStatus ?? (operation.status === 'running'
    ? null
    : operation.status === 'succeeded' ? (warnings.length ? 'warning' : 'success') : 'error')
  return {
    ...operation,
    finalStatus,
    warnings,
    output: Array.isArray(operation.output) ? operation.output.map(redactOutput).filter(Boolean) : [],
  }
}

export { readState, writeState, saveBinding, readBinding }
